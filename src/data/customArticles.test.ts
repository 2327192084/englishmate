/**
 * 自定义文章解析与存储的单元测试。
 *
 * 重点覆盖四类边界：
 *  - 三种输入格式（双语对照 / 只有英文 / JSON）各自能不能正确成句；
 *  - GBK 文件被当 UTF-8 读出来时有没有被拦住；
 *  - 句子太少、解析不出句子时有没有明确报错；
 *  - 超长句的截断与提示。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, clearAllData, type CustomArticle } from '@/db';
import {
  ARTICLE_LEVELS,
  ArticleImportError,
  MAX_SENTENCE_CHARS,
  decodeArticleBytes,
  deleteCustomArticle,
  listCustomArticles,
  makeCustomArticleId,
  normalizeLevel,
  parseArticleText,
  parseArticleTextDetailed,
  readArticleFile,
  saveCustomArticle,
  splitEnglishSentences,
  titleFromFilename,
  truncateSentence,
} from './customArticles';
import type { Article } from '@/types';

/* ---------- 构造测试数据的小工具 ---------- */

/** 三段双语对照，最普通的输入 */
const BILINGUAL = [
  'The quick brown fox jumps over the lazy dog.',
  '敏捷的棕色狐狸跳过了懒狗。',
  '',
  'It was a bright cold day in April.',
  '四月里一个明亮寒冷的日子。',
  '',
  'The clocks were striking thirteen.',
  '时钟正敲十三下。',
].join('\n');

/**
 * 极简 GBK 编码表：只收测试要用到的汉字。
 *
 * 不引图标库（也不引 iconv-lite），手写几个字节更省事——测试要的是
 * 「一段真实的 GBK 字节」，不是通用转码器。
 */
const GBK_BYTES: Record<string, number[]> = {
  敏: [0xc3, 0xf4],
  捷: [0xbd, 0xdd],
  的: [0xb5, 0xc4],
  棕: [0xd7, 0xd8],
  色: [0xc9, 0xab],
  狐: [0xba, 0xfc],
  狸: [0xc0, 0xea],
  跳: [0xcc, 0xf8],
  过: [0xb9, 0xfd],
  懒: [0xc0, 0xc1],
  狗: [0xb9, 0xb7],
  '。': [0xa1, 0xa3],
};

/** 把字符串编成 GBK 字节（表里没有的字符按 ASCII 处理） */
function encodeGbk(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const bytes = GBK_BYTES[ch];
    if (bytes) out.push(...bytes);
    else out.push(ch.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** 一段 GBK 文件：英文是 ASCII（任何编码下都一样），译文是 GBK 汉字 */
const GBK_FILE_TEXT = [
  'The quick brown fox jumps over the lazy dog.',
  '敏捷的棕色狐狸跳过懒狗。',
  'It was a bright cold day in April.',
  '敏捷的棕色狐狸跳过懒狗。',
  'The clocks were striking thirteen.',
  '敏捷的棕色狐狸跳过懒狗。',
].join('\n');

/**
 * 模拟「GBK 文件被当 UTF-8 读」的结果。
 * 真实 GBK 字节经 UTF-8 解码后，每个汉字会变成 1~2 个 U+FFFD，
 * 这里直接拼出同样的形态（检测逻辑只依赖这个特征）。
 */
function mojibake(count: number): string {
  return Array.from({ length: count }, () => '\uFFFD\uFFFD').join('');
}

async function save(article: Article): Promise<void> {
  await saveCustomArticle(article);
}

function sampleArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: makeCustomArticleId(),
    title: 'Sample',
    titleZh: '样例',
    level: 'CET-4',
    author: '用户导入',
    sentences: [
      { en: 'One sentence here.', zh: '第一句。' },
      { en: 'Second sentence here.', zh: '第二句。' },
      { en: 'Third sentence here.', zh: '第三句。' },
    ],
    source: '导入自 sample.txt',
    ...overrides,
  };
}

beforeEach(async () => {
  await clearAllData();
  // clearAllData 不碰新表，单独清一次
  await db.customArticles.clear();
});

/* ---------- 格式一：双语对照 ---------- */

describe('解析 · 双语对照', () => {
  it('英文行 / 中文行交替，按空行分段配对', () => {
    const { article, warnings } = parseArticleTextDetailed(BILINGUAL, 'fox.txt');

    expect(article.sentences).toHaveLength(3);
    expect(article.sentences[0]).toEqual({
      en: 'The quick brown fox jumps over the lazy dog.',
      zh: '敏捷的棕色狐狸跳过了懒狗。',
    });
    expect(article.sentences[2]!.en).toBe('The clocks were striking thirteen.');
    expect(article.sentences[2]!.zh).toBe('时钟正敲十三下。');
    expect(warnings).toHaveLength(0);
  });

  it('单行内用 Tab 分隔英中', () => {
    const text = [
      'The quick brown fox jumps over the lazy dog.\t敏捷的棕色狐狸跳过了懒狗。',
      'It was a bright cold day in April.\t四月里一个明亮寒冷的日子。',
      'The clocks were striking thirteen.\t时钟正敲十三下。',
    ].join('\n');
    const article = parseArticleText(text, 'tab.txt');

    expect(article.sentences).toHaveLength(3);
    expect(article.sentences[1]).toEqual({
      en: 'It was a bright cold day in April.',
      zh: '四月里一个明亮寒冷的日子。',
    });
  });

  it('连续多行英文对应连续多行中文', () => {
    const text = [
      'First English line.',
      'Second English line.',
      'Third English line.',
      '第一行中文。',
      '第二行中文。',
      '第三行中文。',
    ].join('\n');
    const article = parseArticleText(text, 'runs.txt');

    expect(article.sentences).toEqual([
      { en: 'First English line.', zh: '第一行中文。' },
      { en: 'Second English line.', zh: '第二行中文。' },
      { en: 'Third English line.', zh: '第三行中文。' },
    ]);
  });

  it('硬折行会拼回一句，不会把换行当断句', () => {
    const text = [
      'The quick brown fox jumps over',
      'the lazy dog and keeps running.',
      '敏捷的棕色狐狸跳过懒狗，继续奔跑。',
      '',
      'It was a bright cold day in April.',
      '四月里一个明亮寒冷的日子。',
      '',
      'The clocks were striking thirteen.',
      '时钟正敲十三下。',
    ].join('\n');
    const { article } = parseArticleTextDetailed(text, 'wrap.txt');

    expect(article.sentences).toHaveLength(3);
    expect(article.sentences[0]!.en).toBe(
      'The quick brown fox jumps over the lazy dog and keeps running.',
    );
  });

  it('markdown 标题会被识别成标题，不混进正文', () => {
    const text = ['# The Fox', '# 狐狸', BILINGUAL].join('\n');
    const { article } = parseArticleTextDetailed(text, 'fox.md');

    expect(article.title).toBe('The Fox');
    expect(article.titleZh).toBe('狐狸');
    expect(article.sentences).toHaveLength(3);
  });

  it('译行比英文行少时保留英文并给出提示', () => {
    const text = [
      'First English line.',
      'Second English line.',
      'Third English line.',
      '第一行中文。',
      '第二行中文。',
    ].join('\n');
    const { article, warnings } = parseArticleTextDetailed(text, 'uneven.txt');

    expect(article.sentences).toHaveLength(3);
    expect(article.sentences[2]).toEqual({ en: 'Third English line.', zh: '' });
    expect(warnings.join('')).toContain('对不上');
  });
});

/* ---------- 格式二：只有英文 ---------- */

describe('解析 · 只有英文', () => {
  const EN_ONLY = [
    'The quick brown fox jumps over the lazy dog.',
    'It was a bright cold day in April.',
    'The clocks were striking thirteen.',
  ].join('\n');

  it('按句末标点切句，zh 留空串', () => {
    const { article, warnings } = parseArticleTextDetailed(EN_ONLY, 'plain.txt');

    expect(article.sentences).toHaveLength(3);
    expect(article.sentences.every((s) => s.zh === '')).toBe(true);
    expect(article.sentences[1]!.en).toBe('It was a bright cold day in April.');
    expect(warnings.join('')).toContain('中文译文');
  });

  it('一段里挤多句也能切开', () => {
    const article = parseArticleText(
      'He came. He saw. He conquered the whole thing.',
      'inline.txt',
    );
    expect(article.sentences.map((s) => s.en)).toEqual([
      'He came.',
      'He saw.',
      'He conquered the whole thing.',
    ]);
  });

  it('缩写和姓名首字母不会被误切成句', () => {
    expect(splitEnglishSentences('Mr. Smith went to Washington. Then he left.')).toEqual([
      'Mr. Smith went to Washington.',
      'Then he left.',
    ]);
    expect(splitEnglishSentences('J. R. R. Tolkien wrote it.')).toEqual([
      'J. R. R. Tolkien wrote it.',
    ]);
    expect(splitEnglishSentences('Use it, e.g. in a test. Done.')).toEqual([
      'Use it, e.g. in a test.',
      'Done.',
    ]);
  });
});

/* ---------- 格式三：JSON ---------- */

describe('解析 · JSON', () => {
  it('完整 Article 结构', () => {
    const json = JSON.stringify({
      id: 'whatever',
      title: 'The Fox',
      titleZh: '狐狸',
      level: 'CET-6',
      author: 'Aesop',
      sentences: [
        { en: 'One.', zh: '一。' },
        { en: 'Two.', zh: '二。' },
        { en: 'Three.', zh: '三。' },
      ],
      source: 'public domain',
    });
    const article = parseArticleText(json, 'a.json');

    expect(article.title).toBe('The Fox');
    expect(article.titleZh).toBe('狐狸');
    expect(article.level).toBe('CET-6');
    expect(article.sentences).toHaveLength(3);
  });

  it('{ title, sentences } 简写，字段名兼容 text / cn', () => {
    const json = JSON.stringify({
      title: 'Short Form',
      sentences: [{ text: 'One.', cn: '一。' }, { en: 'Two.', zh: '二。' }, { en: 'Three.' }],
    });
    const { article } = parseArticleTextDetailed(json, 'b.json');

    expect(article.sentences[0]).toEqual({ en: 'One.', zh: '一。' });
    expect(article.sentences[2]).toEqual({ en: 'Three.', zh: '' });
    // 简写没给难度 → 默认 CET-4
    expect(ARTICLE_LEVELS).toContain(article.level);
    expect(article.level).toBe('CET-4');
  });

  it('JSON 语法错误给出明确的 invalid-json', () => {
    expect(() => parseArticleText('{ not json', 'bad.json')).toThrow(ArticleImportError);
    try {
      parseArticleText('{ not json', 'bad.json');
    } catch (e) {
      expect((e as ArticleImportError).code).toBe('invalid-json');
    }
  });

  it('JSON 里没有 sentences 数组时给出 invalid-json', () => {
    try {
      parseArticleText('{"title":"x"}', 'noses.json');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ArticleImportError).code).toBe('invalid-json');
    }
  });
});

/* ---------- GBK 乱码检测 ---------- */

describe('编码检测', () => {
  it('大量 U+FFFD 判为 GBK 乱码并提示另存为 UTF-8', () => {
    const broken = `The quick brown fox.${mojibake(40)}`;
    try {
      parseArticleText(broken, 'gbk.txt');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as ArticleImportError;
      expect(err).toBeInstanceOf(ArticleImportError);
      expect(err.code).toBe('encoding');
      expect(err.message).toContain('UTF-8');
    }
  });

  it('真实 GBK 字节被当 UTF-8 读时会被拦截', () => {
    const bytes = encodeGbk(GBK_FILE_TEXT);
    // 先用宽松 UTF-8 解，模拟 file.text() 的结果
    const lossy = new TextDecoder('utf-8').decode(bytes);
    expect(lossy).toContain('\uFFFD');

    try {
      parseArticleText(lossy, 'gbk-real.txt');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ArticleImportError).code).toBe('encoding');
    }
  });

  it('decodeArticleBytes 认出 GBK 并正确转码', () => {
    const bytes = encodeGbk(GBK_FILE_TEXT);
    const decoded = decodeArticleBytes(bytes);

    expect(decoded.encoding).toBe('gbk');
    expect(decoded.text).toContain('敏捷的棕色狐狸跳过懒狗。');
    // 转好码的文本能直接解析（3 组英文 + 中文）
    expect(parseArticleText(decoded.text, 'gbk-out.txt').sentences).toHaveLength(3);
  });

  it('decodeArticleBytes 对 UTF-8 字节走 utf-8 分支', () => {
    const utf8 = new TextEncoder().encode('四月里的日子。');
    const decoded = decodeArticleBytes(utf8);
    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.text).toBe('四月里的日子。');
  });

  it('偶发一两个替换字符不影响导入', () => {
    const text = [BILINGUAL, 'A stray \uFFFD char here.'].join('\n');
    expect(() => parseArticleText(text, 'ok.txt')).not.toThrow();
  });

  it('空文件报 empty', () => {
    try {
      parseArticleText('   \n\n  ', 'empty.txt');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ArticleImportError).code).toBe('empty');
    }
  });

  it('readArticleFile 读 Blob 并返回编码', async () => {
    const bytes = encodeGbk(GBK_FILE_TEXT);
    const file = new Blob([bytes.buffer as ArrayBuffer]);
    const decoded = await readArticleFile(file);
    expect(decoded.text).toContain('狐狸');
    expect(decoded.encoding).toBe('gbk');
  });
});

/* ---------- 句子数量与长度 ---------- */

describe('句数与长度限制', () => {
  it('少于 3 句拒绝导入', () => {
    const text = ['Only one sentence.', '只有一句。', '', 'And another one.', '还有一句。'].join(
      '\n',
    );
    try {
      parseArticleText(text, 'short.txt');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as ArticleImportError;
      expect(err.code).toBe('too-few-sentences');
      expect(err.message).toContain('至少');
    }
  });

  it('只有中文没有任何英文时拒绝', () => {
    const text = ['第一句中文。', '第二句中文。', '第三句中文。'].join('\n');
    try {
      parseArticleText(text, 'zh-only.txt');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ArticleImportError).code).toBe('no-sentences');
    }
  });

  it('超长句在词边界截断并补省略号', () => {
    const long = `${'word '.repeat(60)}end.`;
    expect(long.length).toBeGreaterThan(MAX_SENTENCE_CHARS);

    const text = [
      long,
      '这是译文。',
      'Second sentence.',
      '第二句。',
      'Third one.',
      '第三句。',
    ].join('\n');
    const { article, warnings } = parseArticleTextDetailed(text, 'long.txt');

    const first = article.sentences[0]!;
    expect(first.en.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS);
    expect(first.en.endsWith('…')).toBe(true);
    expect(warnings.join('')).toContain('截断');
  });

  it('truncateSentence 对短句原样返回', () => {
    expect(truncateSentence('Short one.')).toBe('Short one.');
    expect(truncateSentence('x'.repeat(200))).toHaveLength(MAX_SENTENCE_CHARS);
  });
});

/* ---------- 元信息推断 ---------- */

describe('元信息推断', () => {
  it('标题从文件名推断', () => {
    expect(titleFromFilename('cet4_the-old-man.txt')).toBe('cet4 the old man');
    expect(titleFromFilename('E:\\docs\\IELTS reading.TXT')).toBe('IELTS reading');
    expect(titleFromFilename('')).toBe('自定义文章');
  });

  it('难度先看 JSON 显式值，再看文件名，最后默认 CET-4', () => {
    expect(normalizeLevel('CET-6')).toBe('CET-6');
    expect(normalizeLevel('', 'ky_2020.txt')).toBe('CET-4');
    expect(normalizeLevel('', '考研真题.txt')).toBe('考研');
    expect(normalizeLevel('', 'ielts.txt')).toBe('雅思');
    expect(normalizeLevel('', 'cet6_notes.txt')).toBe('CET-6');
    expect(normalizeLevel()).toBe('CET-4');
  });

  it('解析结果带 id / source / author', () => {
    const article = parseArticleText(BILINGUAL, 'fox.txt');
    expect(article.id).toMatch(/^u[0-9a-z]+$/);
    expect(article.source).toBe('导入自 fox.txt');
    expect(article.author).toBe('用户导入');
  });
});

/* ---------- 存储层 ---------- */

describe('自定义文章存储', () => {
  it('保存后能读回，句子按顺序保留', async () => {
    const article = sampleArticle();
    await save(article);

    const rows = await listCustomArticles();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(article.id);
    expect(rows[0]!.sentences).toHaveLength(3);
    expect(rows[0]!.sentences[2]!.zh).toBe('第三句。');
  });

  it('列表按导入时间倒序', async () => {
    const older: CustomArticle = {
      id: 'uolder',
      title: 'Older',
      titleZh: '',
      level: 'CET-4',
      author: '用户导入',
      sentences: sampleArticle().sentences,
      source: '导入自 older.txt',
      createdAt: 1,
    };
    await db.customArticles.put(older);
    await save(sampleArticle({ title: 'Newer' }));

    const rows = await listCustomArticles();
    expect(rows.map((r) => r.title)).toEqual(['Newer', 'Older']);
  });

  it('覆盖保存保留原 createdAt，不改变列表顺序', async () => {
    const id = makeCustomArticleId();
    await db.customArticles.put({
      id,
      title: 'Original',
      titleZh: '',
      level: 'CET-4',
      author: '用户导入',
      sentences: sampleArticle().sentences,
      source: '导入自 a.txt',
      createdAt: 12345,
    } as CustomArticle);

    await save(sampleArticle({ id, title: 'Renamed' }));

    const row = await db.customArticles.get(id);
    expect(row?.title).toBe('Renamed');
    expect(row?.createdAt).toBe(12345);
  });

  it('删除后列表里不再出现', async () => {
    const article = sampleArticle();
    await save(article);
    expect(await listCustomArticles()).toHaveLength(1);

    await deleteCustomArticle(article.id);
    expect(await listCustomArticles()).toHaveLength(0);
  });

  it('句子太少拒绝写入，库里不留半成品', async () => {
    await expect(
      saveCustomArticle(sampleArticle({ sentences: [{ en: 'One.', zh: '一。' }] })),
    ).rejects.toBeInstanceOf(ArticleImportError);
    expect(await listCustomArticles()).toHaveLength(0);
  });

  it('保存时会丢掉空的英文句、清掉首尾空白', async () => {
    await save(
      sampleArticle({
        sentences: [
          { en: '  One.  ', zh: ' 一。 ' },
          { en: '   ', zh: '空的' },
          { en: 'Two.', zh: '二。' },
          { en: 'Three.', zh: '三。' },
        ],
      }),
    );
    const [row] = await listCustomArticles();
    expect(row!.sentences).toEqual([
      { en: 'One.', zh: '一。' },
      { en: 'Two.', zh: '二。' },
      { en: 'Three.', zh: '三。' },
    ]);
  });
});

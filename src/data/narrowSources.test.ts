/**
 * 窄式批次构造的单元测试。
 *
 * 重点是「文章 → 批次」这条转换：句数截断、脏字段兜底、排序稳定性。
 * 这些出错都不报错，只会让精听页显示一批奇怪的句子。
 */
import { describe, expect, it } from 'vitest';
import {
  BATCH_SIZE,
  batchFromArticle,
  batchFromSentences,
  getNarrowBatch,
  listNarrowBatches,
} from '@/data/narrowSources';
import type { Article } from '@/types';

/** 造一个够用的文章对象；只覆盖测试关心的字段 */
function article(id: string, sentences: string[], extra: Partial<Article> = {}): Article {
  return {
    id,
    title: `Title ${id}`,
    titleZh: `标题 ${id}`,
    level: 'CET-4',
    author: 'Someone',
    source: '',
    sentences: sentences.map((en) => ({ en, zh: `译 ${en}` })),
    ...extra,
  };
}

describe('batchFromArticle', () => {
  it('把文章句子转成精听项', () => {
    const b = batchFromArticle(article('a1', ['Hello there.', 'How are you?']));
    expect(b).not.toBeNull();
    expect(b!.id).toBe('a1');
    expect(b!.items).toHaveLength(2);
    expect(b!.items[0]!.en).toBe('Hello there.');
    expect(b!.items[0]!.zh).toBe('译 Hello there.');
    expect(b!.items[0]!.bankId).toBe('article:a1');
  });

  it('句子超过上限时从开头截取，不从中间抽', () => {
    // 文章有顺序，从中间抽会断上下文——而上下文正是窄式输入的价值
    const many = Array.from({ length: 20 }, (_, i) => `Sentence number ${i}.`);
    const b = batchFromArticle(article('long', many), 5);
    expect(b!.items).toHaveLength(5);
    expect(b!.items[0]!.en).toBe('Sentence number 0.');
    expect(b!.items[4]!.en).toBe('Sentence number 4.');
  });

  it('默认上限是 BATCH_SIZE', () => {
    const many = Array.from({ length: 30 }, (_, i) => `S${i}.`);
    expect(batchFromArticle(article('d', many))!.items).toHaveLength(BATCH_SIZE);
  });

  it('过滤空句子，但保留其余句子', () => {
    const b = batchFromArticle(article('gap', ['First.', '', '   ', 'Second.']));
    expect(b!.items.map((i) => i.en)).toEqual(['First.', 'Second.']);
  });

  it('句子里的 word 用文章标题兜底，不留空串', () => {
    // 结算页会显示「来自词条 xxx」，空串会让那一行变成空白
    const b = batchFromArticle(article('t', ['One sentence.']));
    expect(b!.items[0]!.word).toBe('标题 t');
  });

  it('缺中文标题时退回英文标题', () => {
    const a = article('nozh', ['X.'], { titleZh: '' });
    expect(batchFromArticle(a)!.items[0]!.word).toBe('Title nozh');
  });

  it('没有句子的文章返回 null', () => {
    expect(batchFromArticle(article('empty', []))).toBeNull();
    expect(batchFromArticle(article('blank', ['', '  ']))).toBeNull();
  });

  it('脏输入返回 null 而不是抛错', () => {
    // @ts-expect-error 故意传错类型
    expect(batchFromArticle(null)).toBeNull();
    // @ts-expect-error 故意传错类型
    expect(batchFromArticle({})).toBeNull();
    // @ts-expect-error sentences 不是数组
    expect(batchFromArticle({ id: 'x', sentences: 'oops' })).toBeNull();
  });

  it('limit 非法时至少给一句', () => {
    const b = batchFromArticle(article('l', ['A.', 'B.']), 0);
    expect(b!.items).toHaveLength(1);
  });
});

describe('listNarrowBatches', () => {
  it('跳过没有句子的文章', () => {
    const list = listNarrowBatches([
      article('ok', ['Hi.']),
      article('empty', []),
      article('ok2', ['Yo.']),
    ]);
    expect(list.map((b) => b.id)).toEqual(['ok', 'ok2']);
  });

  it('按难度分层：CET-4 → CET-6 → 考研 → 雅思', () => {
    const list = listNarrowBatches([
      article('y', ['A.'], { level: '雅思' }),
      article('f', ['B.'], { level: 'CET-4' }),
      article('s', ['C.'], { level: 'CET-6' }),
      article('k', ['D.'], { level: '考研' }),
    ]);
    expect(list.map((b) => b.level)).toEqual(['CET-4', 'CET-6', '考研', '雅思']);
  });

  it('同难度内按标题排序，保证顺序稳定', () => {
    // 不稳定排序会让用户每次进页面看到的文章顺序都不一样
    const list = listNarrowBatches([
      article('b', ['A.'], { title: 'Zebra' }),
      article('a', ['B.'], { title: 'Apple' }),
    ]);
    expect(list.map((b) => b.title)).toEqual(['Apple', 'Zebra']);
  });

  it('未知难度排在最后，不影响已知难度的顺序', () => {
    const list = listNarrowBatches([
      article('u', ['A.'], { level: '奇怪的难度' }),
      article('k', ['B.'], { level: 'CET-4' }),
    ]);
    expect(list.map((b) => b.level)).toEqual(['CET-4', '奇怪的难度']);
  });

  it('空输入返回空数组', () => {
    expect(listNarrowBatches([])).toEqual([]);
    // @ts-expect-error 故意传错类型
    expect(listNarrowBatches(null)).toEqual([]);
  });
});

describe('getNarrowBatch', () => {
  const arts = [article('hit', ['Found me.'])];

  it('按 id 取到批次', () => {
    expect(getNarrowBatch('hit', arts)!.items[0]!.en).toBe('Found me.');
  });

  it('id 不存在时返回 null（URL 里的旧链接不该炸页面）', () => {
    expect(getNarrowBatch('nope', arts)).toBeNull();
    expect(getNarrowBatch('', arts)).toBeNull();
  });
});

describe('batchFromSentences', () => {
  it('给非文章来源套一个统一外壳', () => {
    const b = batchFromSentences(
      [
        { en: 'A.', zh: '甲。', word: 'a', bankId: 'cet4', trans: '甲' },
        { en: 'B.', zh: '乙。', word: 'b', bankId: 'cet4', trans: '乙' },
      ],
      'mixed',
      '例句混合',
    );
    expect(b.id).toBe('mixed');
    expect(b.title).toBe('例句混合');
    expect(b.items).toHaveLength(2);
  });

  it('超过上限时截断', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      en: `S${i}.`,
      zh: '',
      word: `w${i}`,
      bankId: 'cet4',
      trans: '',
    }));
    expect(batchFromSentences(many).items).toHaveLength(BATCH_SIZE);
  });

  it('脏输入不会抛错', () => {
    // @ts-expect-error 故意传错类型
    expect(batchFromSentences(null).items).toEqual([]);
  });
});

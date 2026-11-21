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
  batchFromAuthor,
  batchFromSentences,
  getNarrowBatch,
  listAuthorBatches,
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

describe('batchFromAuthor', () => {
  /** 三篇同作者，篇内句子编号便于断言轮流取的顺序 */
  const sameAuthor: Article[] = [
    article('p1', ['A1.', 'A2.', 'A3.'], { author: 'Aesop' }),
    article('p2', ['B1.', 'B2.', 'B3.'], { author: 'Aesop' }),
    article('p3', ['C1.', 'C2.', 'C3.'], { author: 'Aesop' }),
  ];

  it('聚合同一作者的多篇', () => {
    const b = batchFromAuthor('Aesop', sameAuthor);
    expect(b).not.toBeNull();
    expect(b!.author).toBe('Aesop');
    expect(b!.items.length).toBeGreaterThan(0);
  });

  it('轮流取句，而不是先取完第一篇', () => {
    // 若逐篇取满，前 3 句会是 A1 A2 A3——那样跨篇复现根本不会发生
    const b = batchFromAuthor('Aesop', sameAuthor, 6);
    expect(b!.items.map((i) => i.en)).toEqual(['A1.', 'B1.', 'C1.', 'A2.', 'B2.', 'C2.']);
  });

  it('某篇较短时不卡住，继续从其它篇取', () => {
    const mixed: Article[] = [
      article('short', ['S1.'], { author: 'X' }),
      article('long', ['L1.', 'L2.', 'L3.'], { author: 'X' }),
    ];
    const b = batchFromAuthor('X', mixed, 4);
    // 第 2 轮 short 没有 S2，应跳过并继续取 L2/L3
    expect(b!.items.map((i) => i.en)).toEqual(['S1.', 'L1.', 'L2.', 'L3.']);
  });

  it('句子用的 word 是篇名而不是作者名', () => {
    // 作者名对每一句都一样，没有定位价值
    const b = batchFromAuthor('Aesop', sameAuthor);
    expect(b!.items[0]!.word).toBe('标题 p1');
    expect(b!.items[1]!.word).toBe('标题 p2');
  });

  it('作者不存在时返回 null', () => {
    expect(batchFromAuthor('Nobody', sameAuthor)).toBeNull();
    expect(batchFromAuthor('', sameAuthor)).toBeNull();
    // @ts-expect-error 故意传错类型
    expect(batchFromAuthor(null, sameAuthor)).toBeNull();
  });

  it('作者只有空句子时返回 null', () => {
    expect(batchFromAuthor('Y', [article('e', ['', '  '], { author: 'Y' })])).toBeNull();
  });

  it('难度取出现最多的那一档', () => {
    const arts: Article[] = [
      article('a', ['A.'], { author: 'Z', level: 'CET-4' }),
      article('b', ['B.'], { author: 'Z', level: 'CET-6' }),
      article('c', ['C.'], { author: 'Z', level: 'CET-6' }),
    ];
    expect(batchFromAuthor('Z', arts)!.level).toBe('CET-6');
  });
});

describe('listAuthorBatches', () => {
  it('只列出有多篇的作者（单篇拼不出跨篇复现）', () => {
    const arts: Article[] = [
      article('a1', ['A.'], { author: '多产作者' }),
      article('a2', ['B.'], { author: '多产作者' }),
      article('b1', ['C.'], { author: '单篇作者' }),
    ];
    expect(listAuthorBatches(arts).map((b) => b.author)).toEqual(['多产作者']);
  });

  it('按篇数从多到少排序', () => {
    const arts: Article[] = [
      ...Array.from({ length: 2 }, (_, i) => article(`x${i}`, ['S.'], { author: '两个' })),
      ...Array.from({ length: 5 }, (_, i) => article(`y${i}`, ['S.'], { author: '五个' })),
    ];
    expect(listAuthorBatches(arts).map((b) => b.author)).toEqual(['五个', '两个']);
  });

  it('空输入返回空数组', () => {
    expect(listAuthorBatches([])).toEqual([]);
    // @ts-expect-error 故意传错类型
    expect(listAuthorBatches(null)).toEqual([]);
  });

  it('真实语料里能列出 Aesop 合集', () => {
    const real = listAuthorBatches();
    expect(real.length).toBeGreaterThan(0);
    expect(real[0]!.author).toBe('Aesop');
    expect(real[0]!.items.length).toBe(BATCH_SIZE);
  });
});

describe('getNarrowBatch 支持同作者合集', () => {
  it('author: 前缀会走合集分支', () => {
    const b = getNarrowBatch('author:Aesop');
    expect(b).not.toBeNull();
    expect(b!.author).toBe('Aesop');
    expect(b!.id).toBe('author:Aesop');
  });

  it('普通文章 id 仍走单篇分支', () => {
    const single = getNarrowBatch('gettysburg');
    expect(single).not.toBeNull();
    expect(single!.id).toBe('gettysburg');
  });

  it('author: 后没有名字返回 null', () => {
    expect(getNarrowBatch('author:')).toBeNull();
    expect(getNarrowBatch('author:无名氏')).toBeNull();
  });
});

/**
 * 句子库的单测。
 *
 * 两个关注点：
 *   1. 逐词对比的判定口径（大小写、缺词、多余词、印刷字符归一化）
 *   2. 取句的筛选与降级行为（长度、一词一句、limit、加载失败返回 []）
 *
 * 语料是真实数据，但本文件不需要 fetch：`sentencesFromWords` 只吃内存里的
 * 词条数组，`sentencesForBank` 的降级路径靠 node 环境没有 fetch 来验证。
 */
import { describe, expect, it } from 'vitest';
import cet4 from '../../public/dicts/cet4.json';
import type { WordEntry } from '@/types';
import { diffSentence, joinSentence, mistakeCount } from '@/lib/sentenceDiff';
import { normalizeForCompare } from '@/lib/text';
import { sentencesForBank, sentencesFromWords } from './sentences';

/** 确定性的伪随机（同 round.test.ts 的做法），保证取句结果可复现 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function entry(w: string, sentences?: { en: string; zh: string }[]): WordEntry {
  return sentences ? { w, t: `${w} 的释义`, sentences } : { w, t: `${w} 的释义` };
}

/** 从真实词库里取一句含 U+2019（弯撇号）的句子，供归一化用例使用 */
const CURLY_APOS_SENTENCE =
  'It\u2019s a communication medium, not a substance or specific activity.';

describe('diffSentence', () => {
  it('整句完全一致时全部 ok', () => {
    const diffs = diffSentence('I have a dream.', 'I have a dream.');
    expect(diffs.map((d) => d.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(mistakeCount(diffs)).toBe(0);
  });

  it('大小写不同不算错', () => {
    const diffs = diffSentence('The quick brown fox', 'the QUICK brown FOX');
    expect(mistakeCount(diffs)).toBe(0);
  });

  it('打错一个词：该位置 wrong 且带 typed', () => {
    const diffs = diffSentence('I have a dream', 'I have a drem');
    expect(diffs[3]).toEqual({ word: 'dream', state: 'wrong', typed: 'drem' });
    expect(mistakeCount(diffs)).toBe(1);
  });

  it('缺词记 missing，且不产生 typed', () => {
    const diffs = diffSentence('I have a dream today', 'I have a dream');
    expect(diffs[4]).toEqual({ word: 'today', state: 'missing' });
    expect(diffs[4].typed).toBeUndefined();
    expect(mistakeCount(diffs)).toBe(1);
  });

  it('多打的词被忽略，不影响整句判定', () => {
    const diffs = diffSentence('I have a dream', 'I have a dream today please');
    expect(diffs).toHaveLength(4);
    expect(mistakeCount(diffs)).toBe(0);
  });

  it('空输入时整句都算缺词', () => {
    const diffs = diffSentence('You are welcome', '');
    expect(diffs).toHaveLength(3);
    expect(diffs.every((d) => d.state === 'missing')).toBe(true);
    expect(mistakeCount(diffs)).toBe(3);
  });

  it('真实语料里的弯撇号，用户打直撇号也算对', () => {
    // 语料是印刷体（U+2019），键盘只能打 U+0027，不归一化就永远判错
    const typed = CURLY_APOS_SENTENCE.replace(/\u2019/g, "'");
    const diffs = diffSentence(CURLY_APOS_SENTENCE, typed);
    expect(mistakeCount(diffs)).toBe(0);
    // 对照区展示的是归一化之后的词：It's（直撇号）
    expect(diffs[0].word).toBe("It's");
  });

  it('省略号 …（U+2026）与键盘输入 ... 等价', () => {
    // 词库例句里没有 …，但正文/译文里存在，且用户键盘打不出来，必须归一化
    const target = `Wait\u2026 I don\u2019t know.`;
    const typed = "Wait... I don't know.";
    expect(mistakeCount(diffSentence(target, typed))).toBe(0);
  });

  it('cet4 真句子里取一句含弯撇号的，归一化后可全对', () => {
    // 守住"真实数据可用"这条底线：不是用手造的样本自证
    const words = (cet4 as { words: WordEntry[] }).words;
    const pool = words
      .flatMap((w) => w.sentences ?? [])
      .filter((s) => s.en.includes('\u2019') && s.en.length <= 100);
    expect(pool.length).toBeGreaterThan(0);
    const target = pool[0].en;
    // 把弯撇号换回键盘能打的直撇号，其余保持原样
    const typed = target.replace(/\u2019/g, "'");
    expect(mistakeCount(diffSentence(target, typed))).toBe(0);
  });
});

describe('joinSentence', () => {
  it('用空格拼回，并归一化印刷字符', () => {
    expect(joinSentence(['It\u2019s', 'a', 'medium'])).toBe("It's a medium");
  });

  it('过滤空串，避免出现连续空格', () => {
    expect(joinSentence(['a', '', 'b'])).toBe('a b');
  });

  it('与 normalizeForCompare 口径一致', () => {
    const raw = 'He said \u201Chi\u201D \u2014 then left\u2026';
    expect(joinSentence(raw.split(' '))).toBe(normalizeForCompare(raw));
  });
});

describe('sentencesFromWords', () => {
  const withSentences = entry('apple', [
    { en: 'I ate an apple.', zh: '我吃了一个苹果。' },
    { en: 'An apple a day.', zh: '一天一苹果。' },
  ]);
  const withoutSentences = entry('zzz');
  const emptySentences = entry('empty', []);

  it('只取有例句的词条', async () => {
    const out = await sentencesFromWords(
      [withoutSentences, emptySentences, withSentences],
      'cet4',
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe('apple');
    expect(out[0].bankId).toBe('cet4');
  });

  it('一个词最多取 1 句', async () => {
    const out = await sentencesFromWords([withSentences], 'cet4', 10, seeded(1));
    expect(out).toHaveLength(1);
  });

  it('没有任何例句时返回空数组', async () => {
    const out = await sentencesFromWords([withoutSentences, emptySentences], 'cet4', 10);
    expect(out).toEqual([]);
  });

  it('句长超过 100 字符的句子被丢弃', async () => {
    const long = 'word '.repeat(30).trim(); // 149 字符
    const e = entry('long', [
      { en: long, zh: '太长' },
      { en: 'Short one.', zh: '短的' },
    ]);
    const out = await sentencesFromWords([e], 'cet4', 10, seeded(2));
    expect(out).toHaveLength(1);
    expect(out[0].en).toBe('Short one.');
    expect(out[0].en.length).toBeLessThanOrEqual(100);
  });

  it('只有超长句时该词条被整体跳过', async () => {
    const long = 'word '.repeat(30).trim();
    const out = await sentencesFromWords([entry('long', [{ en: long, zh: 'x' }])], 'cet4', 10);
    expect(out).toEqual([]);
  });

  /**
   * 阈值钉在 100 这个边界上，而不是只测「很长的被丢」。
   *
   * 这样做是因为 100 跟 `scripts/verify-data.mjs` 里文章的 140 是两条不同的线
   * （那 140 只为拦文章，实测 75 篇里 67 篇含超过 100 字符的句子）。
   * 只测 149 字符的话，谁把上限悄悄改成 140 这个用例照样绿；
   * 钉住 100 恰好过、101 恰好不过，改动才会当场暴露。
   */
  it('长度阈值正好是 100：100 字符保留、101 字符丢弃', async () => {
    const just100 = 'a'.repeat(100);
    const just101 = 'a'.repeat(101);
    const kept = await sentencesFromWords([entry('ok', [{ en: just100, zh: '刚好' }])], 'cet4', 10);
    expect(kept).toHaveLength(1);
    const dropped = await sentencesFromWords(
      [entry('no', [{ en: just101, zh: '多一个' }])],
      'cet4',
      10,
    );
    expect(dropped).toEqual([]);
  });

  it('limit 生效', async () => {
    const words = Array.from({ length: 20 }, (_, i) =>
      entry(`w${i}`, [{ en: `Sentence number ${i}.`, zh: `第 ${i} 句。` }]),
    );
    const out = await sentencesFromWords(words, 'cet4', 5, seeded(3));
    expect(out).toHaveLength(5);
  });

  it('limit <= 0 时返回空数组', async () => {
    expect(await sentencesFromWords([withSentences], 'cet4', 0)).toEqual([]);
    expect(await sentencesFromWords([withSentences], 'cet4', -3)).toEqual([]);
  });

  it('传入确定性 rng 时结果可复现', async () => {
    const words = Array.from({ length: 20 }, (_, i) =>
      entry(`w${i}`, [{ en: `Sentence number ${i}.`, zh: `第 ${i} 句。` }]),
    );
    const a = await sentencesFromWords(words, 'cet4', 5, seeded(42));
    const b = await sentencesFromWords(words, 'cet4', 5, seeded(42));
    expect(a).toEqual(b);
    // 换了种子就该变：否则说明 rng 根本没被用上
    const c = await sentencesFromWords(words, 'cet4', 5, seeded(7));
    expect(c).not.toEqual(a);
  });

  it('结果里的 bankId 是传入值', async () => {
    const out = await sentencesFromWords([withSentences], 'custom:mine', 10);
    expect(out[0].bankId).toBe('custom:mine');
  });

  it('真实词库里取出的句子长度都 <= 100', async () => {
    const words = (cet4 as { words: WordEntry[] }).words;
    const out = await sentencesFromWords(words, 'cet4', 40, seeded(11));
    expect(out.length).toBe(40);
    for (const s of out) {
      expect(s.en.length).toBeLessThanOrEqual(100);
      expect(s.en.trim()).toBe(s.en);
      expect(s.zh.length).toBeGreaterThan(0);
    }
  });
});

describe('sentencesForBank', () => {
  it('node 环境没有 fetch 时优雅返回空数组，不抛错', async () => {
    // 这是界面依赖的降级契约：加载失败只该表现为"没有句子"
    await expect(sentencesForBank('cet4', 5)).resolves.toEqual([]);
  });

  it('空 bankId 直接返回空数组', async () => {
    await expect(sentencesForBank('', 5)).resolves.toEqual([]);
  });
});

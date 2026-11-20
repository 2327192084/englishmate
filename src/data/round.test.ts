import { describe, expect, it } from 'vitest';
import { buildChoices, buildRound, shuffle } from './round';
import type { UserWord, WordEntry } from '@/types';
import { createCard } from '@/lib/fsrs';

const DAY = 86_400_000;

function entry(w: string, t = `${w} 的释义`): WordEntry {
  return { w, t };
}

function userWord(word: string, opts: Partial<UserWord> = {}): UserWord {
  return {
    id: `cet4:${word}`,
    bankId: 'cet4',
    word,
    trans: `${word} 的释义`,
    mistakes: 0,
    corrects: 0,
    favorite: false,
    mastered: false,
    card: { ...createCard(0), aneh: undefined } as never,
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  } as UserWord;
}

/** 确定性的伪随机，保证测试稳定 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('洗牌', () => {
  it('不改变长度也不丢元素', () => {
    const src = ['a', 'b', 'c', 'd', 'e'];
    const out = shuffle(src, seeded(7));
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual([...src].sort());
  });

  it('不修改原数组', () => {
    const src = ['a', 'b', 'c'];
    shuffle(src, seeded(3));
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

describe('出题队列', () => {
  const now = 10 * DAY;
  const allWords = Array.from({ length: 50 }, (_, i) => entry(`w${i}`));

  it('没有历史时优先出新词', () => {
    const plan = buildRound({
      bankId: 'cet4',
      allWords,
      known: new Map(),
      size: 10,
      newQuota: 10,
      mode: 'typing',
      rng: seeded(1),
      now,
    });
    expect(plan.entries).toHaveLength(10);
    for (const e of plan.entries) {
      expect(plan.reasons.get(e.w.toLowerCase())).toBe('new');
    }
  });

  it('新词额度为 0 时不会塞新词（还有存量可练）', () => {
    const known = new Map<string, UserWord>();
    // 10 个已学词，都还没到期
    for (let i = 0; i < 10; i++) {
      const w = `w${i}`;
      known.set(
        w,
        userWord(w, { card: { ...createCard(0), due: now + 5 * DAY, reps: 2 } as never }),
      );
    }
    const plan = buildRound({
      bankId: 'cet4',
      allWords,
      known,
      size: 10,
      newQuota: 0,
      mode: 'typing',
      rng: seeded(2),
      now,
    });
    // 已学但未到期的词不该以 'new' 出现
    for (const e of plan.entries) {
      expect(plan.reasons.get(e.w.toLowerCase())).not.toBe('new');
    }
  });

  it('到期的词排在最前并标为 review', () => {
    const known = new Map<string, UserWord>();
    const dueWord = 'w40';
    known.set(
      dueWord,
      userWord(dueWord, { card: { ...createCard(0), due: now - DAY, reps: 3 } as never }),
    );
    const plan = buildRound({
      bankId: 'cet4',
      allWords,
      known,
      size: 5,
      newQuota: 5,
      mode: 'typing',
      rng: seeded(3),
      now,
    });
    expect(plan.entries[0].w).toBe(dueWord);
    expect(plan.reasons.get(dueWord)).toBe('review');
  });

  it('错词会在额度内被提前拉进来', () => {
    const known = new Map<string, UserWord>();
    known.set(
      'w7',
      userWord('w7', {
        mistakes: 4,
        card: { ...createCard(0), due: now + 30 * DAY, reps: 2 } as never,
      }),
    );
    const plan = buildRound({
      bankId: 'cet4',
      allWords,
      known,
      size: 8,
      newQuota: 0,
      mode: 'typing',
      rng: seeded(4),
      now,
    });
    const hit = plan.entries.find((e) => e.w === 'w7');
    expect(hit).toBeDefined();
    expect(plan.reasons.get('w7')).toBe('wrong');
  });

  it('已掌握的词不再出题', () => {
    const known = new Map<string, UserWord>();
    for (const e of allWords) {
      known.set(
        e.w,
        userWord(e.w, { mastered: true, card: { ...createCard(0), due: now - DAY } as never }),
      );
    }
    const plan = buildRound({
      bankId: 'cet4',
      allWords,
      known,
      size: 10,
      newQuota: 5,
      mode: 'typing',
      rng: seeded(5),
      now,
    });
    // 全部掌握时会走到兜底分支，但绝不该把 mastered 的当复习
    for (const e of plan.entries) {
      expect(plan.reasons.get(e.w.toLowerCase())).not.toBe('review');
    }
  });

  it('不会返回重复词，也不超过请求数量', () => {
    const plan = buildRound({
      bankId: 'cet4',
      allWords,
      known: new Map(),
      size: 12,
      newQuota: 12,
      mode: 'typing',
      rng: seeded(6),
      now,
    });
    const keys = plan.entries.map((e) => e.w.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.entries.length).toBeLessThanOrEqual(12);
  });

  it('轮次量大于词库时不会崩，且不重复', () => {
    const tiny = [entry('a'), entry('b'), entry('c')];
    const plan = buildRound({
      bankId: 'cet4',
      allWords: tiny,
      known: new Map(),
      size: 20,
      newQuota: 20,
      mode: 'typing',
      rng: seeded(7),
      now,
    });
    expect(plan.entries).toHaveLength(3);
  });

  it('辨认模式给的题量更多', () => {
    const typing = buildRound({
      bankId: 'cet4',
      allWords,
      known: new Map(),
      size: 10,
      newQuota: 10,
      mode: 'typing',
      rng: seeded(8),
      now,
    });
    const choice = buildRound({
      bankId: 'cet4',
      allWords,
      known: new Map(),
      size: 10,
      newQuota: 10,
      mode: 'choice',
      rng: seeded(8),
      now,
    });
    expect(choice.entries.length).toBeGreaterThan(typing.entries.length);
  });
});

describe('辨认模式选项', () => {
  const pool: WordEntry[] = [
    { w: 'alpha', t: '甲' },
    { w: 'beta', t: '乙' },
    { w: 'gamma', t: '丙' },
    { w: 'delta', t: '丁' },
    { w: 'epsilon', t: '戊' },
  ];

  it('给出一个正确答案和三个干扰项', () => {
    const opts = buildChoices(pool[0], pool, seeded(9));
    expect(opts).toHaveLength(4);
    expect(opts.filter((o) => o.correct)).toHaveLength(1);
    expect(opts.find((o) => o.correct)?.label).toBe('甲');
  });

  it('干扰项不重复', () => {
    const opts = buildChoices(pool[0], pool, seeded(10));
    const labels = opts.map((o) => o.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('释义重复时不会产生两个正确答案', () => {
    const dupPool: WordEntry[] = [
      { w: 'alpha', t: '甲' },
      { w: 'beta', t: '甲' }, // 同义，必须被跳过
      { w: 'gamma', t: '丙' },
    ];
    const opts = buildChoices(dupPool[0], dupPool, seeded(11));
    expect(opts.filter((o) => o.label === '甲')).toHaveLength(1);
  });

  it('干扰项不足时不报错', () => {
    const opts = buildChoices(pool[0], [pool[0]], seeded(12));
    expect(opts.filter((o) => o.correct)).toHaveLength(1);
  });

  describe('每日复习上限（dailyReviewLimit 生效点）', () => {
    const now = 10 * DAY;

    it('上限为 0 时不返回任何到期复习词', () => {
      const known = new Map<string, UserWord>();
      for (let i = 0; i < 5; i++) {
        const w = `w${i}`;
        known.set(w, userWord(w, { card: { ...createCard(0), due: now - DAY, reps: 2 } as never }));
      }
      const all = Array.from({ length: 10 }, (_, i) => entry(`w${i}`));
      const plan = buildRound({
        bankId: 'cet4',
        allWords: all,
        known,
        size: 10,
        newQuota: 0,
        mode: 'typing',
        reviewLimit: 0,
        rng: seeded(20),
        now,
      });
      // 一个到期词都不该以 review 身份出现
      const reviews = plan.entries.filter((e) => plan.reasons.get(e.w.toLowerCase()) === 'review');
      if (reviews.length > 0) {
        console.log(
          '  意外出现 review 的词:',
          reviews.map((r) => r.w),
        );
        console.log('  reasons:', JSON.stringify([...plan.reasons.entries()]));
      }
      expect(reviews).toHaveLength(0);
    });

    it('上限为 2 时最多只取 2 个到期词', () => {
      const known = new Map<string, UserWord>();
      for (let i = 0; i < 8; i++) {
        const w = `w${i}`;
        known.set(w, userWord(w, { card: { ...createCard(0), due: now - DAY, reps: 2 } as never }));
      }
      const all = Array.from({ length: 8 }, (_, i) => entry(`w${i}`));
      const plan = buildRound({
        bankId: 'cet4',
        allWords: all,
        known,
        size: 10,
        newQuota: 0,
        mode: 'typing',
        reviewLimit: 2,
        rng: seeded(21),
        now,
      });
      const reviews = plan.entries.filter((e) => plan.reasons.get(e.w.toLowerCase()) === 'review');
      expect(reviews.length).toBeLessThanOrEqual(2);
    });

    it('省略 reviewLimit 时不限制（向后兼容）', () => {
      const known = new Map<string, UserWord>();
      for (let i = 0; i < 5; i++) {
        const w = `w${i}`;
        known.set(w, userWord(w, { card: { ...createCard(0), due: now - DAY, reps: 2 } as never }));
      }
      const all = Array.from({ length: 5 }, (_, i) => entry(`w${i}`));
      const plan = buildRound({
        bankId: 'cet4',
        allWords: all,
        known,
        size: 10,
        newQuota: 0,
        mode: 'typing',
        rng: seeded(22),
        now,
      });
      const reviews = plan.entries.filter((e) => plan.reasons.get(e.w.toLowerCase()) === 'review');
      expect(reviews.length).toBeGreaterThan(0);
    });
  });
});

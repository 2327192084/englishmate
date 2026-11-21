/**
 * 窄式精听 + 考核的纯逻辑测试。
 *
 * 这层的状态机（轮次 × 句号）看起来简单，但边界很容易写错：
 * 「本轮最后一句的下一句」和「整批最后一句的下一句」只差一个判断，
 * 写错的表现是提前结算或者卡住不动——都不报错，只能靠用例钉住。
 *
 * 考核部分要钉住的核心是**诚实边界**：英文可判分、中文不可判分。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUES,
  QUIZ_META,
  advance,
  buildPassPlan,
  buildQuizOrder,
  countListens,
  gradeQuiz,
  isFinished,
  progressPercent,
  quizProgress,
  translationOverlap,
  visibleText,
} from '@/lib/narrowListen';

describe('buildPassPlan', () => {
  it('默认四轮，按 盲听 → 中文 → 英文 → 中英对照 排列', () => {
    const plan = buildPassPlan();
    expect(plan.map((p) => p.cue)).toEqual(['none', 'zh', 'en', 'both']);
    expect(plan.map((p) => p.pass)).toEqual([0, 1, 2, 3]);
  });

  it('中英对照必须是最后一轮（它是收尾的映射确认）', () => {
    const plan = buildPassPlan();
    expect(plan[plan.length - 1]!.cue).toBe('both');
    expect(plan[0]!.cue).toBe('none');
  });

  it('轮数超过 4 时循环使用梯度', () => {
    const plan = buildPassPlan(6);
    expect(plan.map((p) => p.cue)).toEqual(['none', 'zh', 'en', 'both', 'none', 'zh']);
  });

  it('轮数小于 4 时只出前几轮', () => {
    expect(buildPassPlan(2).map((p) => p.cue)).toEqual(['none', 'zh']);
  });

  it('轮数非法时退回最少一轮而不是返回空数组', () => {
    expect(buildPassPlan(0)).toHaveLength(1);
    expect(buildPassPlan(-3)).toHaveLength(1);
    expect(buildPassPlan(NaN)).toHaveLength(4);
  });

  it('每一轮都有可读的标签与说明', () => {
    for (const p of buildPassPlan()) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('visibleText', () => {
  it('盲听两层都不给', () => {
    expect(visibleText('none', 'I use it.', '我用它。')).toEqual({ en: null, zh: null });
  });

  it('中文轮只给译文', () => {
    expect(visibleText('zh', 'I use it.', '我用它。')).toEqual({ en: null, zh: '我用它。' });
  });

  it('英文轮只给原文', () => {
    expect(visibleText('en', 'I use it.', '我用它。')).toEqual({ en: 'I use it.', zh: null });
  });

  it('中英对照轮两层都给', () => {
    // 新增的一轮：同时看到两边，建立"这句话 = 这个意思"的映射
    expect(visibleText('both', 'I use it.', '我用它。')).toEqual({
      en: 'I use it.',
      zh: '我用它。',
    });
  });

  it('缺译文时给空串而不是 null（"有这一层但内容为空"不同于"这一轮不给"）', () => {
    expect(visibleText('both', 'I use it.', '')).toEqual({ en: 'I use it.', zh: '' });
  });
});

describe('advance', () => {
  it('本轮内推进到下一句', () => {
    expect(advance({ pass: 0, index: 0 }, 3, 4)).toEqual({ pass: 0, index: 1 });
  });

  it('本轮最后一句之后回到第一句并进入下一轮', () => {
    expect(advance({ pass: 0, index: 2 }, 3, 4)).toEqual({ pass: 1, index: 0 });
  });

  it('最后一轮的最后一句之后返回 null（整批听完）', () => {
    expect(advance({ pass: 3, index: 2 }, 3, 4)).toBeNull();
  });

  it('只有一句时也能正确跨轮', () => {
    expect(advance({ pass: 0, index: 0 }, 1, 2)).toEqual({ pass: 1, index: 0 });
    expect(advance({ pass: 1, index: 0 }, 1, 2)).toBeNull();
  });

  it('空批次直接结束，不会陷入死循环', () => {
    expect(advance({ pass: 0, index: 0 }, 0, 4)).toBeNull();
    expect(advance({ pass: 0, index: 0 }, 3, 0)).toBeNull();
  });
});

describe('isFinished', () => {
  it('与 advance 的 null 口径一致', () => {
    const sentenceCount = 3;
    const passCount = 4;
    let pos: { pass: number; index: number } | null = { pass: 0, index: 0 };
    let steps = 0;
    while (pos) {
      expect(isFinished(pos, sentenceCount, passCount)).toBe(false);
      pos = advance(pos, sentenceCount, passCount);
      steps++;
      expect(steps).toBeLessThanOrEqual(sentenceCount * passCount);
    }
    expect(steps).toBe(sentenceCount * passCount);
  });

  it('空批次视为已结束', () => {
    expect(isFinished({ pass: 0, index: 0 }, 0, 4)).toBe(true);
    expect(isFinished({ pass: 0, index: 0 }, 3, 0)).toBe(true);
  });
});

describe('progressPercent', () => {
  it('起点是 0，终点是 100', () => {
    expect(progressPercent({ pass: 0, index: 0 }, 10, 4)).toBe(0);
    expect(progressPercent({ pass: 4, index: 0 }, 10, 4)).toBe(100);
  });

  it('按播放次数算而不是按轮次算', () => {
    // 4 轮 10 句 = 40 次；做完 3 轮 + 3 句 = 33 次
    const p = progressPercent({ pass: 3, index: 3 }, 10, 4);
    expect(p).toBeCloseTo((33 / 40) * 100, 5);
    // 按轮次算会得出 75，那是错的
    expect(p).toBeGreaterThan(80);
  });

  it('超出范围时夹在 0..100', () => {
    expect(progressPercent({ pass: 99, index: 0 }, 10, 4)).toBe(100);
    expect(progressPercent({ pass: -1, index: 0 }, 10, 4)).toBe(0);
  });

  it('空批次返回 0 而不是 NaN', () => {
    expect(progressPercent({ pass: 0, index: 0 }, 0, 4)).toBe(0);
    expect(progressPercent({ pass: 0, index: 0 }, 3, 0)).toBe(0);
  });
});

describe('countListens', () => {
  it('同一句反复听会累加计数', () => {
    let stats: Record<string, number> = {};
    stats = countListens(stats, 0, 0);
    stats = countListens(stats, 0, 0);
    expect(stats['0:0']).toBe(2);
  });

  it('不同轮次的同一句分开计数', () => {
    let stats: Record<string, number> = {};
    stats = countListens(stats, 0, 1);
    stats = countListens(stats, 1, 1);
    expect(stats['0:1']).toBe(1);
    expect(stats['1:1']).toBe(1);
  });

  it('不修改传入对象（保持纯函数）', () => {
    const original = { '0:0': 1 };
    const next = countListens(original, 0, 0);
    expect(original['0:0']).toBe(1);
    expect(next['0:0']).toBe(2);
  });
});

describe('DEFAULT_CUES', () => {
  it('四轮梯度是公开常量，界面与测试共用同一份定义', () => {
    expect(DEFAULT_CUES).toEqual(['none', 'zh', 'en', 'both']);
  });
});

describe('buildQuizOrder', () => {
  /** 确定性伪随机，保证顺序可复现 */
  function seeded(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  it('覆盖每一句且不重复', () => {
    const order = buildQuizOrder(10, seeded(42));
    expect(order).toHaveLength(10);
    expect(new Set(order).size).toBe(10);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('会打乱顺序（按听的顺序考等于送答案）', () => {
    const order = buildQuizOrder(10, seeded(7));
    expect(order).not.toEqual([...Array(10).keys()]);
  });

  it('同一 seed 结果可复现', () => {
    expect(buildQuizOrder(8, seeded(1))).toEqual(buildQuizOrder(8, seeded(1)));
  });

  it('边界：0 与 1 都不崩', () => {
    expect(buildQuizOrder(0)).toEqual([]);
    expect(buildQuizOrder(1)).toEqual([0]);
    expect(buildQuizOrder(NaN)).toEqual([]);
    expect(buildQuizOrder(-5)).toEqual([]);
  });
});

describe('translationOverlap', () => {
  it('完全相同是 1', () => {
    expect(translationOverlap('我用它。', '我用它。')).toBe(1);
  });

  it('标点空白不影响', () => {
    expect(translationOverlap('我 用 它', '我用它。')).toBe(1);
  });

  it('部分重合给出中间值', () => {
    const v = translationOverlap('我用了它', '我用它');
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  /**
   * 这条用例记录的是**设计的诚实边界**，不是缺陷：
   * 同义换说法的重合度会很低，正是不能用它判对错的原因。
   */
  it('同义换说法重合度低——所以它不能用来判对错', () => {
    const v = translationOverlap('他离开了', '他走了');
    expect(v).toBeLessThan(0.5);
    // 但两者意思一样，判错就是误伤
  });

  it('空答案给 0，空参考也给 0（不除零）', () => {
    expect(translationOverlap('', '我用它')).toBe(0);
    expect(translationOverlap('随便写', '')).toBe(0);
  });

  it('脏输入不抛错', () => {
    // @ts-expect-error 故意传错类型
    expect(translationOverlap(null, '参考')).toBe(0);
    // @ts-expect-error 故意传错类型
    expect(translationOverlap('答题', null)).toBe(0);
  });
});

describe('gradeQuiz', () => {
  const item = { en: "You don't want to be an editor?", zh: '你不想做编辑？' };

  it('英文模式走客观判分：打对即 correct', () => {
    const r = gradeQuiz('en', 'you dont want to be an editor', item);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.correct).toBe(true);
      expect(r.mistakes).toBe(0);
    }
  });

  it('英文模式拼错会指出来', () => {
    const r = gradeQuiz('en', 'you dont want to be an editer', item);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.correct).toBe(false);
      expect(r.mistakes).toBe(1);
    }
  });

  it('中文模式**不能**自动判分，只能给参考信息', () => {
    const r = gradeQuiz('zh', '你不想当编辑吗', item);
    expect(r.kind).toBe('manual');
    if (r.kind === 'manual') {
      expect(r.overlap).toBeGreaterThan(0);
      // 必须原样带出这句提示，界面不许省略
      expect(r.note).toContain('由你自己判断');
    }
  });

  it('中文模式不会说"错了"——因为翻译没有唯一答案', () => {
    const r = gradeQuiz('zh', '完全无关的内容', item);
    expect(r.kind).toBe('manual');
    if (r.kind === 'manual') {
      expect(r.overlap).toBe(0);
      // 但依然不给 correct:false 这种判定
      expect('correct' in r).toBe(false);
    }
  });

  it('空答案不崩', () => {
    expect(gradeQuiz('en', '', item).kind).toBe('auto');
    expect(gradeQuiz('zh', '', item).kind).toBe('manual');
    // @ts-expect-error 故意传错类型
    expect(gradeQuiz('en', null, item).kind).toBe('auto');
  });
});

describe('quizProgress', () => {
  it('按已答 / 总题数算', () => {
    expect(quizProgress(0, 10)).toBe(0);
    expect(quizProgress(5, 10)).toBe(50);
    expect(quizProgress(10, 10)).toBe(100);
  });

  it('超出范围时夹住', () => {
    expect(quizProgress(99, 10)).toBe(100);
    expect(quizProgress(-1, 10)).toBe(0);
  });

  it('总数为 0 时返回 0 而不是 NaN', () => {
    expect(quizProgress(0, 0)).toBe(0);
    expect(quizProgress(3, 0)).toBe(0);
  });
});

describe('QUIZ_META', () => {
  it('两种模式都有标签、说明与占位符', () => {
    for (const kind of ['en', 'zh'] as const) {
      expect(QUIZ_META[kind].label.length).toBeGreaterThan(0);
      expect(QUIZ_META[kind].hint.length).toBeGreaterThan(0);
      expect(QUIZ_META[kind].placeholder.length).toBeGreaterThan(0);
    }
  });
});

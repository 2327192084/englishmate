/**
 * 窄式精听的纯逻辑测试。
 *
 * 这层的状态机（轮次 × 句号）看起来简单，但边界很容易写错：
 * 「本轮最后一句的下一句」和「整批最后一句的下一句」只差一个判断，
 * 写错的表现是提前结算或者卡住不动——都不报错，只能靠用例钉住。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUES,
  advance,
  buildPassPlan,
  countListens,
  isFinished,
  progressPercent,
  visibleText,
} from '@/lib/narrowListen';

describe('buildPassPlan', () => {
  it('默认三轮，按 盲听 → 中文 → 英文 排列', () => {
    const plan = buildPassPlan();
    expect(plan.map((p) => p.cue)).toEqual(['none', 'zh', 'en']);
    expect(plan.map((p) => p.pass)).toEqual([0, 1, 2]);
  });

  it('顺序不能反：先给英文会让人直接读，耳朵就不干活了', () => {
    const plan = buildPassPlan();
    expect(plan[0]!.cue).toBe('none');
    expect(plan[plan.length - 1]!.cue).toBe('en');
  });

  it('轮数超过 3 时循环使用梯度', () => {
    const plan = buildPassPlan(5);
    expect(plan.map((p) => p.cue)).toEqual(['none', 'zh', 'en', 'none', 'zh']);
  });

  it('轮数小于 3 时只出前几轮', () => {
    expect(buildPassPlan(2).map((p) => p.cue)).toEqual(['none', 'zh']);
  });

  it('轮数非法时退回最少一轮而不是返回空数组', () => {
    // 空数组会让界面显示「第 1/0 轮」
    expect(buildPassPlan(0)).toHaveLength(1);
    expect(buildPassPlan(-3)).toHaveLength(1);
    expect(buildPassPlan(NaN)).toHaveLength(3);
  });

  it('每一轮都有可读的标签与说明', () => {
    for (const p of buildPassPlan()) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('visibleText', () => {
  it('盲听不显示任何文字', () => {
    expect(visibleText('none', 'I use it.', '我用它。')).toBeNull();
  });

  it('中文轮只给译文', () => {
    expect(visibleText('zh', 'I use it.', '我用它。')).toBe('我用它。');
  });

  it('英文轮给原文', () => {
    expect(visibleText('en', 'I use it.', '我用它。')).toBe('I use it.');
  });

  it('缺译文时不会显示 undefined', () => {
    expect(visibleText('zh', 'I use it.', '')).toBe('');
    expect(visibleText('en', '', '')).toBe('');
  });
});

describe('advance', () => {
  it('本轮内推进到下一句', () => {
    expect(advance({ pass: 0, index: 0 }, 3, 3)).toEqual({ pass: 0, index: 1 });
    expect(advance({ pass: 0, index: 1 }, 3, 3)).toEqual({ pass: 0, index: 2 });
  });

  it('本轮最后一句之后回到第一句并进入下一轮', () => {
    expect(advance({ pass: 0, index: 2 }, 3, 3)).toEqual({ pass: 1, index: 0 });
    expect(advance({ pass: 1, index: 2 }, 3, 3)).toEqual({ pass: 2, index: 0 });
  });

  it('最后一轮的最后一句之后返回 null（整批听完）', () => {
    expect(advance({ pass: 2, index: 2 }, 3, 3)).toBeNull();
  });

  it('只有一句时也能正确跨轮', () => {
    expect(advance({ pass: 0, index: 0 }, 1, 2)).toEqual({ pass: 1, index: 0 });
    expect(advance({ pass: 1, index: 0 }, 1, 2)).toBeNull();
  });

  it('空批次直接结束，不会陷入死循环', () => {
    expect(advance({ pass: 0, index: 0 }, 0, 3)).toBeNull();
    expect(advance({ pass: 0, index: 0 }, 3, 0)).toBeNull();
  });
});

describe('isFinished', () => {
  it('与 advance 的 null 口径一致', () => {
    const sentenceCount = 3;
    const passCount = 3;
    let pos: { pass: number; index: number } | null = { pass: 0, index: 0 };
    let steps = 0;
    while (pos) {
      expect(isFinished(pos, sentenceCount, passCount)).toBe(false);
      pos = advance(pos, sentenceCount, passCount);
      steps++;
      expect(steps).toBeLessThanOrEqual(sentenceCount * passCount);
    }
    // 走满 total 步之后才结束
    expect(steps).toBe(sentenceCount * passCount);
  });

  it('空批次视为已结束', () => {
    expect(isFinished({ pass: 0, index: 0 }, 0, 3)).toBe(true);
    expect(isFinished({ pass: 0, index: 0 }, 3, 0)).toBe(true);
  });
});

describe('progressPercent', () => {
  it('起点是 0，终点是 100', () => {
    expect(progressPercent({ pass: 0, index: 0 }, 10, 3)).toBe(0);
    expect(progressPercent({ pass: 3, index: 0 }, 10, 3)).toBe(100);
  });

  it('按播放次数算而不是按轮次算', () => {
    // 3 轮 10 句 = 30 次播放；做完 2 轮 + 3 句 = 23 次
    const p = progressPercent({ pass: 2, index: 3 }, 10, 3);
    expect(p).toBeCloseTo((23 / 30) * 100, 5);
    // 按轮次算会得出 66.7，那是错的
    expect(p).toBeGreaterThan(70);
  });

  it('超出范围时夹在 0..100', () => {
    expect(progressPercent({ pass: 99, index: 0 }, 10, 3)).toBe(100);
    expect(progressPercent({ pass: -1, index: 0 }, 10, 3)).toBe(0);
  });

  it('空批次返回 0 而不是 NaN', () => {
    expect(progressPercent({ pass: 0, index: 0 }, 0, 3)).toBe(0);
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

  it('不同轮次的同一句分开计数（这是两轮，不是听了一遍）', () => {
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
  it('三轮梯度是公开常量，界面与测试共用同一份定义', () => {
    expect(DEFAULT_CUES).toEqual(['none', 'zh', 'en']);
  });
});

import { describe, expect, it } from 'vitest';
import type { SerializedCard } from '@/types';
import {
  addDays,
  createCard,
  isDue,
  retrievability,
  reviewPreview,
  schedule,
  type Rating,
} from './fsrs';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** 固定基准时间，避免测试依赖真实时钟：2024-01-01T00:00:00Z */
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);

describe('createCard', () => {
  it('新卡字段全部按契约初始化', () => {
    const card = createCard(T0);
    expect(card).toEqual({
      due: T0,
      stability: 0,
      difficulty: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      state: 'new',
      lastReview: null,
      learningStep: 0,
    });
  });

  it('不传 now 时 due 落在当前时间附近', () => {
    const before = Date.now();
    const card = createCard();
    const after = Date.now();
    expect(card.due).toBeGreaterThanOrEqual(before);
    expect(card.due).toBeLessThanOrEqual(after);
  });
});

describe('新卡四档评分落点', () => {
  it('Again 回到第 0 步，1 分钟后到期', () => {
    const next = schedule(createCard(T0), 1, T0);
    expect(next.state).toBe('learning');
    expect(next.learningStep).toBe(0);
    expect(next.due).toBe(T0 + 1 * MINUTE);
    expect(next.reps).toBe(1);
    expect(next.stability).toBeGreaterThan(0);
  });

  it('Hard 停在第 0 步，1 分钟后重来', () => {
    const next = schedule(createCard(T0), 2, T0);
    expect(next.state).toBe('learning');
    expect(next.learningStep).toBe(0);
    expect(next.due).toBe(T0 + 1 * MINUTE);
  });

  it('Good 走到第 1 步，10 分钟后到期', () => {
    const next = schedule(createCard(T0), 3, T0);
    expect(next.state).toBe('learning');
    expect(next.learningStep).toBe(1);
    expect(next.due).toBe(T0 + 10 * MINUTE);
  });

  it('Easy 直接毕业进入 review，间隔至少 1 天', () => {
    const next = schedule(createCard(T0), 4, T0);
    expect(next.state).toBe('review');
    expect(next.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(next.due).toBeGreaterThanOrEqual(T0 + 1 * DAY);
    expect(next.lastReview).toBe(T0);
    expect(next.stability).toBeGreaterThan(0);
  });

  it('四档 due 严格递增（Again/Hard < Good < Easy）', () => {
    const base = createCard(T0);
    const dues = ([1, 2, 3, 4] as Rating[]).map((r) => schedule(base, r, T0).due);
    expect(dues[0]).toBe(dues[1]);
    expect(dues[1]).toBeLessThan(dues[2]);
    expect(dues[2]).toBeLessThan(dues[3]);
  });
});

describe('learning → review 迁移', () => {
  it('连续两次 Good 后进入 review 且间隔 ≥ 1 天', () => {
    const first = schedule(createCard(T0), 3, T0);
    expect(first.state).toBe('learning');
    // 10 分钟后到期，按时复习
    const second = schedule(first, 3, first.due);
    expect(second.state).toBe('review');
    expect(second.scheduledDays).toBeGreaterThanOrEqual(1);
    expect(second.learningStep).toBe(0);
    expect(second.lastReview).toBe(first.due);
  });

  it('learning 阶段 Again 回到第 0 步而不是继续推进', () => {
    const learned = schedule(createCard(T0), 3, T0); // step 1
    const back = schedule(learned, 1, learned.due);
    expect(back.state).toBe('learning');
    expect(back.learningStep).toBe(0);
    expect(back.due).toBe(learned.due + 1 * MINUTE);
  });

  it('learning 阶段 Easy 立即毕业', () => {
    const learned = schedule(createCard(T0), 3, T0);
    const easy = schedule(learned, 4, learned.due);
    expect(easy.state).toBe('review');
    expect(easy.scheduledDays).toBeGreaterThanOrEqual(1);
  });
});

describe('review 阶段间隔单调增长', () => {
  it('连续 3 次 Good 的间隔严格递增', () => {
    let card: SerializedCard = createCard(T0);
    // 先走完 learning 两步毕业
    card = schedule(card, 3, T0);
    card = schedule(card, 3, card.due);
    expect(card.state).toBe('review');

    const intervals: number[] = [];
    for (let i = 0; i < 3; i++) {
      card = schedule(card, 3, card.due);
      expect(card.state).toBe('review');
      intervals.push(card.scheduledDays);
    }

    expect(intervals).toHaveLength(3);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
  });

  it('连续 Good 的 due 时间戳递增且稳定度递增', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0); // Easy 毕业，直接进 review

    let prevDue = card.due;
    let prevStability = card.stability;
    for (let i = 0; i < 4; i++) {
      card = schedule(card, 3, card.due);
      expect(card.due).toBeGreaterThan(prevDue);
      expect(card.stability).toBeGreaterThan(prevStability);
      prevDue = card.due;
      prevStability = card.stability;
    }
  });

  it('maximumInterval 能兜住超长间隔', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0);
    for (let i = 0; i < 30; i++) {
      card = schedule(card, 4, card.due, { maximumInterval: 10 });
      expect(card.scheduledDays).toBeLessThanOrEqual(10);
    }
  });
});

describe('Again 进入 relearning', () => {
  it('review 卡答错后 lapses+1 并转入 relearning', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0); // 毕业
    card = schedule(card, 3, card.due);
    expect(card.state).toBe('review');

    const lapsed = schedule(card, 1, card.due);
    expect(lapsed.state).toBe('relearning');
    expect(lapsed.lapses).toBe(card.lapses + 1);
    expect(lapsed.stability).toBeGreaterThan(0);
    expect(lapsed.due).toBe(card.due + 1 * MINUTE);
    expect(lapsed.reps).toBe(card.reps + 1);
  });

  it('relearning 里连续作答最终回到 review', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0);
    card = schedule(card, 1, card.due); // 进入 relearning
    expect(card.state).toBe('relearning');

    card = schedule(card, 3, card.due); // 走第 2 步
    expect(card.state).toBe('relearning');
    card = schedule(card, 3, card.due); // 走完步进
    expect(card.state).toBe('review');
    expect(card.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('relearning 里 Easy 立即回到 review', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0);
    card = schedule(card, 1, card.due);
    expect(card.state).toBe('relearning');

    const rescued = schedule(card, 4, card.due);
    expect(rescued.state).toBe('review');
    expect(rescued.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('连续答错 lapses 持续累加', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0);
    for (let i = 1; i <= 3; i++) {
      card = schedule(card, 1, card.due);
      expect(card.lapses).toBe(i);
      expect(card.state).toBe('relearning');
    }
  });
});

describe('参数边界与脏输入', () => {
  it('任何评分下 stability 恒 > 0 且有限', () => {
    const base = createCard(T0);
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      const card = schedule(base, rating, T0);
      expect(card.stability).toBeGreaterThan(0);
      expect(Number.isFinite(card.stability)).toBe(true);
      expect(Number.isFinite(card.due)).toBe(true);
      expect(Number.isFinite(card.difficulty)).toBe(true);
    }
  });

  it('难度恒被夹在 [1, 10]', () => {
    const dirty: SerializedCard = {
      ...createCard(T0),
      state: 'review',
      stability: 5,
      difficulty: 10,
      lastReview: T0 - 3 * DAY,
      reps: 5,
    };
    // 连续 40 次 Again 会把难度往上顶，Easy 会往下压，都要被夹住
    let card = dirty;
    for (let i = 0; i < 40; i++) {
      card = schedule(card, 1, card.lastReview ?? T0);
      card = { ...card, lastReview: T0, due: T0 };
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
    card = dirty;
    for (let i = 0; i < 40; i++) {
      card = schedule(card, 4, card.lastReview ?? T0);
      card = { ...card, lastReview: T0, due: T0 };
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('全零/NaN/Infinity 的脏卡片不会产出 NaN', () => {
    const dirty = {
      due: Number.NaN,
      stability: Number.NaN,
      difficulty: Number.POSITIVE_INFINITY,
      scheduledDays: Number.NaN,
      reps: Number.NaN,
      lapses: Number.NaN,
      state: 'review',
      lastReview: Number.NaN,
      learningStep: Number.NaN,
    } as unknown as SerializedCard;

    const next = schedule(dirty, 3, T0);
    expect(Number.isFinite(next.due)).toBe(true);
    expect(next.stability).toBeGreaterThan(0);
    expect(Number.isFinite(next.stability)).toBe(true);
    expect(next.difficulty).toBeGreaterThanOrEqual(1);
    expect(next.difficulty).toBeLessThanOrEqual(10);
    expect(Number.isFinite(next.scheduledDays)).toBe(true);
    expect(next.due).toBeGreaterThanOrEqual(T0);
  });

  it('due 绝不倒退：即使卡片已过期很久，新 due 也不早于 now', () => {
    const stale: SerializedCard = {
      ...createCard(T0),
      state: 'review',
      stability: 3,
      difficulty: 5,
      lastReview: T0 - 365 * DAY,
      due: T0 - 300 * DAY,
      reps: 4,
    };
    const now = T0;
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      const next = schedule(stale, rating, now);
      expect(next.due).toBeGreaterThanOrEqual(now);
    }
  });

  it('schedule 不修改入参（纯函数）', () => {
    const base = createCard(T0);
    const snapshot = { ...base };
    schedule(base, 3, T0);
    expect(base).toEqual(snapshot);
  });

  it('requestRetention 越高间隔越短', () => {
    const base: SerializedCard = {
      ...createCard(T0),
      state: 'review',
      stability: 30,
      difficulty: 5,
      lastReview: T0 - 10 * DAY,
      due: T0,
      reps: 5,
    };
    const low = schedule(base, 3, T0, { requestRetention: 0.7 });
    const high = schedule(base, 3, T0, { requestRetention: 0.97 });
    expect(low.scheduledDays).toBeGreaterThan(high.scheduledDays);
  });

  it('越界评分被夹到 [1,4]，NaN 被兜底成 Good，均不抛错', () => {
    const base = createCard(T0);
    // 99 越界 → 夹到 4（Easy）
    const tooHigh = schedule(base, 99 as Rating, T0);
    const easy = schedule(base, 4, T0);
    expect(tooHigh.due).toBe(easy.due);
    expect(tooHigh.state).toBe(easy.state);

    // -5 越界 → 夹到 1（Again）
    const tooLow = schedule(base, -5 as Rating, T0);
    const again = schedule(base, 1, T0);
    expect(tooLow.due).toBe(again.due);

    // NaN → 兜底成 3（Good）
    const notANumber = schedule(base, Number.NaN as Rating, T0);
    const good = schedule(base, 3, T0);
    expect(notANumber.due).toBe(good.due);
    expect(notANumber.state).toBe(good.state);
  });
});

describe('isDue / retrievability / reviewPreview', () => {
  it('isDue 按毫秒时间戳比较，边界含等于', () => {
    const card = createCard(T0);
    expect(isDue(card, T0)).toBe(true);
    expect(isDue(card, T0 - 1)).toBe(false);
    expect(isDue({ ...card, due: T0 + 1000 }, T0)).toBe(false);
    expect(isDue({ ...card, due: Number.NaN }, T0)).toBe(true);
  });

  it('retrievability 对新卡返回 0，复习后随时间单调下降', () => {
    expect(retrievability(createCard(T0), T0)).toBe(0);

    const reviewed: SerializedCard = {
      ...createCard(T0),
      state: 'review',
      stability: 10,
      difficulty: 5,
      lastReview: T0,
      due: T0 + 10 * DAY,
      reps: 3,
    };
    const r0 = retrievability(reviewed, T0);
    const r5 = retrievability(reviewed, T0 + 5 * DAY);
    const r20 = retrievability(reviewed, T0 + 20 * DAY);

    expect(r0).toBeCloseTo(1, 5);
    expect(r5).toBeLessThan(r0);
    expect(r20).toBeLessThan(r5);
    expect(r20).toBeGreaterThanOrEqual(0);
  });

  it('稳定度等于间隔时保持率约为 0.9', () => {
    const card: SerializedCard = {
      ...createCard(T0),
      state: 'review',
      stability: 20,
      difficulty: 5,
      lastReview: T0,
      due: T0 + 20 * DAY,
      reps: 3,
    };
    expect(retrievability(card, T0 + 20 * DAY)).toBeCloseTo(0.9, 2);
  });

  it('reviewPreview 返回四档且间隔递增，不改动原卡', () => {
    let card: SerializedCard = createCard(T0);
    card = schedule(card, 4, T0);
    card = schedule(card, 3, card.due);
    const snapshot = { ...card };

    const preview = reviewPreview(card, card.due);
    expect(Object.keys(preview).sort()).toEqual(['1', '2', '3', '4']);
    expect(preview[1].scheduledDays).toBeLessThanOrEqual(preview[2].scheduledDays);
    expect(preview[2].scheduledDays).toBeLessThanOrEqual(preview[3].scheduledDays);
    expect(preview[3].scheduledDays).toBeLessThanOrEqual(preview[4].scheduledDays);
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      expect(Number.isFinite(preview[rating].due)).toBe(true);
      expect(Number.isFinite(preview[rating].scheduledDays)).toBe(true);
    }
    expect(card).toEqual(snapshot);
  });
});

describe('addDays', () => {
  it('按天推进毫秒时间戳', () => {
    expect(addDays(T0, 1)).toBe(T0 + DAY);
    expect(addDays(T0, 0.5)).toBe(T0 + DAY / 2);
    expect(addDays(T0, -2)).toBe(T0 - 2 * DAY);
  });

  it('非法输入不产生 NaN', () => {
    expect(Number.isFinite(addDays(T0, Number.NaN))).toBe(true);
    expect(Number.isFinite(addDays(Number.NaN, 1))).toBe(true);
  });
});

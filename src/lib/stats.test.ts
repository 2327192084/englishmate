import { describe, expect, it } from 'vitest';
import type { DailyStat, PracticeSession, UserWord } from '@/types';
import { createCard } from './fsrs';
import {
  aggregateDaily,
  computeAccuracy,
  computeLongestStreak,
  computeStreak,
  computeWpm,
  localDateKey,
  summarize,
} from './stats';

const DAY = 86_400_000;
/** 本地时区的某天零点，保证测试与运行机器时区无关 */
function localMidnight(year: number, month1: number, day: number): number {
  return new Date(year, month1 - 1, day, 0, 0, 0, 0).getTime();
}

const D0 = localMidnight(2024, 3, 1); // 2024-03-01
const D1 = localMidnight(2024, 3, 2); // 2024-03-02
const D2 = localMidnight(2024, 3, 3); // 2024-03-03
const D3 = localMidnight(2024, 3, 4); // 2024-03-04

/** 造一个字段齐全的练习会话，只覆盖关心的字段 */
function session(over: Partial<PracticeSession> = {}): PracticeSession {
  return {
    startedAt: D0 + 9 * 3_600_000,
    endedAt: D0 + 9 * 3_600_000 + 60_000,
    mode: 'typing',
    bankId: 'cet4',
    total: 10,
    perfect: 8,
    correct: 9,
    keystrokes: 100,
    correctKeystrokes: 90,
    wpm: 40,
    accuracy: 0.9,
    durationSec: 60,
    words: ['cancel'],
    ...over,
  };
}

/** 造一条 daily 统计 */
function daily(date: string, over: Partial<DailyStat> = {}): DailyStat {
  return {
    date,
    sessions: 1,
    words: 10,
    keystrokes: 100,
    bestWpm: 40,
    accuracy: 0.9,
    minutes: 1,
    ...over,
  };
}

/** 造一个 UserWord */
function userWord(over: Partial<UserWord> = {}): UserWord {
  return {
    id: 'cet4:cancel',
    bankId: 'cet4',
    word: 'cancel',
    trans: '取消',
    mistakes: 0,
    corrects: 1,
    favorite: false,
    mastered: false,
    card: createCard(D0),
    createdAt: D0,
    updatedAt: D0,
    ...over,
  };
}

describe('localDateKey', () => {
  it('返回本地时区的 YYYY-MM-DD', () => {
    expect(localDateKey(D0)).toBe('2024-03-01');
    expect(localDateKey(D1)).toBe('2024-03-02');
  });

  it('同一天的任意时刻共享同一个键', () => {
    expect(localDateKey(D0 + 23 * 3_600_000 + 59 * 60_000)).toBe('2024-03-01');
    expect(localDateKey(D0 - 1)).toBe('2024-02-29'); // 2024 是闰年
  });

  it('跨年正确', () => {
    expect(localDateKey(localMidnight(2025, 1, 1))).toBe('2025-01-01');
  });
});

describe('computeWpm', () => {
  it('正确字符/5/分钟，向下取整', () => {
    // 300 字符 / 5 = 60 词，1 分钟 → 60
    expect(computeWpm(300, 60_000)).toBe(60);
    // 同一速度下 23 字符/10 秒 → 27.6 → 27
    expect(computeWpm(23, 10_000)).toBe(27);
  });

  it('ms 为 0 或负数返回 0', () => {
    expect(computeWpm(100, 0)).toBe(0);
    expect(computeWpm(100, -1000)).toBe(0);
  });

  it('字符数为 0 返回 0，非法输入返回 0', () => {
    expect(computeWpm(0, 60_000)).toBe(0);
    expect(computeWpm(Number.NaN, 60_000)).toBe(0);
    expect(computeWpm(100, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('computeAccuracy', () => {
  it('返回 0..1 的比值', () => {
    expect(computeAccuracy(90, 100)).toBeCloseTo(0.9, 10);
    expect(computeAccuracy(100, 100)).toBe(1);
    expect(computeAccuracy(0, 100)).toBe(0);
  });

  it('分母为 0 返回 1', () => {
    expect(computeAccuracy(0, 0)).toBe(1);
    expect(computeAccuracy(50, 0)).toBe(1);
  });

  it('负数与非法输入被兜底', () => {
    expect(computeAccuracy(0, -5)).toBe(1);
    expect(computeAccuracy(Number.NaN, 100)).toBe(1);
    // 正确数超过总数按 100% 计
    expect(computeAccuracy(120, 100)).toBe(1);
  });
});

describe('aggregateDaily', () => {
  it('合并同日的多个 session', () => {
    const sessions = [
      session({
        startedAt: D0 + 1_000,
        durationSec: 60,
        total: 10,
        correct: 8,
        keystrokes: 100,
        wpm: 40,
      }),
      session({
        startedAt: D0 + 7_200_000,
        durationSec: 120,
        total: 20,
        correct: 18,
        keystrokes: 200,
        wpm: 65,
      }),
    ];
    const out = aggregateDaily(sessions);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('2024-03-01');
    expect(out[0].sessions).toBe(2);
    expect(out[0].words).toBe(30);
    expect(out[0].keystrokes).toBe(300);
    expect(out[0].bestWpm).toBe(65); // 取当日最佳
    expect(out[0].minutes).toBe(3); // 60s + 120s
    expect(out[0].accuracy).toBeCloseTo(26 / 30, 10); // 按词数加权
  });

  it('按日期升序且缺的日期不补', () => {
    const out = aggregateDaily([
      session({ startedAt: D3 }),
      session({ startedAt: D0 }),
      session({ startedAt: D2 }),
    ]);
    expect(out.map((d) => d.date)).toEqual(['2024-03-01', '2024-03-03', '2024-03-04']);
  });

  it('空输入返回空数组', () => {
    expect(aggregateDaily([])).toEqual([]);
  });

  it('durationSec 缺失时用起止时间兜底', () => {
    const out = aggregateDaily([session({ startedAt: D0, endedAt: D0 + 90_000, durationSec: 0 })]);
    expect(out[0].minutes).toBeCloseTo(1.5, 5);
  });

  it('忽略非法时间戳的会话', () => {
    const out = aggregateDaily([
      session({ startedAt: Number.NaN, endedAt: Number.NaN }),
      session({ startedAt: D0 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].sessions).toBe(1);
  });
});

describe('computeStreak', () => {
  it('今天有记录：从今天往前数', () => {
    const dailyStats = [daily('2024-03-04'), daily('2024-03-03'), daily('2024-03-02')];
    expect(computeStreak(dailyStats, '2024-03-04')).toBe(3);
  });

  it('今天没有但昨天有：从昨天算起，不断签', () => {
    const dailyStats = [daily('2024-03-03'), daily('2024-03-02'), daily('2024-03-01')];
    expect(computeStreak(dailyStats, '2024-03-04')).toBe(3);
  });

  it('中间断档：只算到断点', () => {
    const dailyStats = [
      daily('2024-03-04'),
      daily('2024-03-03'),
      // 缺 03-02
      daily('2024-03-01'),
    ];
    expect(computeStreak(dailyStats, '2024-03-04')).toBe(2);
  });

  it('今天和昨天都没有：连续天数为 0', () => {
    const dailyStats = [daily('2024-03-01'), daily('2024-02-28')];
    expect(computeStreak(dailyStats, '2024-03-04')).toBe(0);
  });

  it('空列表返回 0', () => {
    expect(computeStreak([], '2024-03-04')).toBe(0);
  });

  it('没有任何活动的记录不算签到', () => {
    const idle = daily('2024-03-04', { sessions: 0, words: 0, keystrokes: 0, minutes: 0 });
    expect(computeStreak([idle], '2024-03-04')).toBe(0);
  });

  it('跨月连续正确衔接', () => {
    const dailyStats = [daily('2024-03-01'), daily('2024-02-29'), daily('2024-02-28')];
    expect(computeStreak(dailyStats, '2024-03-01')).toBe(3);
  });

  it('不传 today 时以本地今天为准', () => {
    const todayKey = localDateKey(Date.now());
    expect(computeStreak([daily(todayKey)], todayKey)).toBe(1);
    expect(computeStreak([daily(todayKey)])).toBe(1);
  });
});

describe('computeLongestStreak', () => {
  it('取历史最长的一段，不要求延续到今天', () => {
    const dailyStats = [
      daily('2024-03-01'),
      daily('2024-03-02'),
      daily('2024-03-03'),
      // 断档
      daily('2024-03-10'),
      daily('2024-03-11'),
    ];
    expect(computeLongestStreak(dailyStats)).toBe(3);
  });

  it('单日记录返回 1，空列表返回 0', () => {
    expect(computeLongestStreak([daily('2024-03-01')])).toBe(1);
    expect(computeLongestStreak([])).toBe(0);
  });

  it('乱序输入也能算对', () => {
    const dailyStats = [
      daily('2024-03-02'),
      daily('2024-03-04'),
      daily('2024-03-01'),
      daily('2024-03-03'),
    ];
    expect(computeLongestStreak(dailyStats)).toBe(4);
  });

  it('重复日期不重复计数', () => {
    const dailyStats = [daily('2024-03-01'), daily('2024-03-01'), daily('2024-03-02')];
    expect(computeLongestStreak(dailyStats)).toBe(2);
  });
});

describe('summarize', () => {
  it('汇总会话与词库指标', () => {
    const sessions = [
      session({ startedAt: D0, total: 10, correct: 8, keystrokes: 100, wpm: 40, durationSec: 60 }),
      session({
        startedAt: D1,
        total: 20,
        correct: 20,
        keystrokes: 200,
        wpm: 60,
        durationSec: 180,
      }),
    ];
    const now = D2;
    const words: UserWord[] = [
      userWord({ id: 'cet4:a', card: { ...createCard(D0), due: D0 - 1 }, mistakes: 2 }),
      userWord({ id: 'cet4:b', card: { ...createCard(D0), due: D0 + 10 * DAY } }),
      userWord({ id: 'cet4:c', card: { ...createCard(D0), due: D0 - 1 }, mastered: true }),
      userWord({ id: 'cet4:d', card: { ...createCard(D0), due: D0 - 1 }, favorite: true }),
    ];

    const stats = summarize(sessions, words, 5, 12, now);

    expect(stats.totalSessions).toBe(2);
    expect(stats.totalWords).toBe(30);
    expect(stats.totalKeystrokes).toBe(300);
    expect(stats.bestWpm).toBe(60);
    // 按分钟加权：(40*1 + 60*3) / 4 = 55
    expect(stats.avgWpm).toBe(55);
    expect(stats.accuracy).toBeCloseTo(28 / 30, 10);
    expect(stats.masteredCount).toBe(1);
    expect(stats.favoriteCount).toBe(1); // 只有 d 被收藏
    expect(stats.wrongCount).toBe(1);
    expect(stats.dueCount).toBe(2);
    expect(stats.todayNew).toBe(5);
    expect(stats.todayReviewed).toBe(12);
  });

  it('空输入不产生 NaN', () => {
    const stats = summarize([], [], 0, 0, D0);
    expect(stats).toEqual({
      totalSessions: 0,
      totalWords: 0,
      totalKeystrokes: 0,
      bestWpm: 0,
      avgWpm: 0,
      accuracy: 1,
      streak: 0,
      longestStreak: 0,
      masteredCount: 0,
      wrongCount: 0,
      favoriteCount: 0,
      dueCount: 0,
      todayNew: 0,
      todayReviewed: 0,
    });
  });

  it('已掌握的词不计入待复习与错词', () => {
    const words: UserWord[] = [
      userWord({
        id: 'x:1',
        mastered: true,
        mistakes: 5,
        card: { ...createCard(D0), due: D0 - 1 },
      }),
    ];
    const stats = summarize([], words, 0, 0, D0);
    expect(stats.masteredCount).toBe(1);
    expect(stats.wrongCount).toBe(0);
    expect(stats.dueCount).toBe(0);
  });

  it('非法 today 参数被兜底为 0', () => {
    const stats = summarize([], [], Number.NaN, -3, D0);
    expect(stats.todayNew).toBe(0);
    expect(stats.todayReviewed).toBe(0);
  });
});

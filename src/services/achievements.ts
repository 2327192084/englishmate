/**
 * 成就解锁服务。
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────────────────
 * `data/achievements.ts` 里定义好了 14 个成就和 `evaluate()` 判定函数，
 * 但**从来没有任何地方调用它** —— 于是成就页永远显示 0/14。
 * 文档里却写着"14 个成就"，属于文档比代码超前。
 *
 * 这里补上接线：每次练习结算后算一次上下文、跑判定、把新解锁的写库。
 */
import { db } from '@/db';
import type { AchievementContext, UserWord } from '@/types';
import { ACHIEVEMENTS, evaluate } from '@/data/achievements';
import { aggregateDaily, computeStreak, summarize } from '@/lib/stats';

/**
 * 汇总当前所有统计，组装成成就判定需要的上下文。
 *
 * 这里有几次全表读取（sessions / userWords），
 * 但只在一次练习结算后触发一次，不在渲染循环里，开销可接受。
 */
async function buildContext(): Promise<AchievementContext> {
  const [sessions, words] = await Promise.all([db.sessions.toArray(), db.userWords.toArray()]);

  const daily = aggregateDaily(sessions);
  const streak = computeStreak(daily);
  // 今日新增/复习数量用 summarize 的参数位；成就判定不依赖这两项，传 0 即可
  const overview = summarize(sessions, words, 0, 0);

  return {
    totalSessions: overview.totalSessions,
    totalWords: overview.totalWords,
    streak,
    bestWpm: overview.bestWpm,
    accuracy: overview.accuracy,
    masteredCount: words.filter((w: UserWord) => w.mastered).length,
    totalKeystrokes: overview.totalKeystrokes,
  };
}

/**
 * 检查并解锁成就，返回本次**新解锁**的成就 id 列表。
 *
 * 调用时机：每轮练习结算、写入 session 之后。
 * 幂等：已解锁的不会再触发（evaluate 会把它们跳过）。
 */
export async function checkAchievements(): Promise<string[]> {
  try {
    const existing = await db.achievements.toArray();
    const unlocked = new Set(existing.map((a) => a.id));

    const fresh = evaluate(await buildContext(), unlocked);
    if (fresh.length === 0) return [];

    const now = Date.now();
    await db.achievements.bulkPut(fresh.map((id) => ({ id, unlockedAt: now })));
    return fresh;
  } catch {
    // 成就判定失败不该影响练习主流程
    return [];
  }
}

/** 已解锁进度，供页面直接查询 */
export async function achievementProgress(): Promise<{ unlocked: number; total: number }> {
  const count = await db.achievements.count();
  return { unlocked: count, total: ACHIEVEMENTS.length };
}

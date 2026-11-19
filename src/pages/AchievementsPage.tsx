/** 成就页：全部成就的解锁进度 */
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { ACHIEVEMENTS } from '@/data/achievements';
import { aggregateDaily, computeStreak, summarize } from '@/lib/stats';
import { todayCounts } from '@/services/learning';
import { Progress, Skeleton } from '@/components/ui';
import { IconTrophy } from '@/components/Icons';
import { useState, useMemo } from 'react';

export default function AchievementsPage() {
  const unlocked = useLiveQuery(() => db.achievements.toArray(), [], []);
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const words = useLiveQuery(() => db.userWords.toArray(), [], []);
  const [counts, setCounts] = useState({ todayNew: 0, todayReviewed: 0 });

  useMemo(() => {
    void todayCounts().then(setCounts);
  }, []);

  const ctx = useMemo(() => {
    const daily = aggregateDaily(sessions ?? []);
    const ov = summarize(sessions ?? [], words ?? [], counts.todayNew, counts.todayReviewed);
    return {
      totalSessions: ov.totalSessions,
      totalWords: ov.totalWords,
      streak: computeStreak(daily),
      bestWpm: ov.bestWpm,
      accuracy: ov.accuracy,
      masteredCount: ov.masteredCount,
      totalKeystrokes: ov.totalKeystrokes,
    };
  }, [sessions, words, counts]);

  if (!unlocked || !sessions || !words) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-32" />
      </div>
    );
  }

  const unlockedSet = new Set(unlocked.map((u) => u.id));
  const pct = Math.round((unlockedSet.size / ACHIEVEMENTS.length) * 100);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <IconTrophy width={20} height={20} className="text-amber-400" />
          成就
        </h1>
        <p className="mt-1 text-sm text-muted">
          已解锁 {unlockedSet.size} / {ACHIEVEMENTS.length}
        </p>
        <Progress value={pct} className="mt-2 max-w-xs" />
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        {ACHIEVEMENTS.map((a) => {
          const got = unlockedSet.has(a.id);
          const p = progressOf(a.id, ctx);
          return (
            <div
              key={a.id}
              className={`tf-card flex items-center gap-3 px-3.5 py-3 ${got ? 'border-amber-400/40' : ''}`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ${
                  got ? 'bg-amber-400/15' : 'bg-surface2 opacity-40 grayscale'
                }`}
              >
                {a.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm font-medium ${got ? 'text-ink' : 'text-muted'}`}>
                    {a.name}
                  </span>
                  {got && <span className="text-[10px] text-amber-400">已解锁</span>}
                </div>
                <div className="truncate text-[11px] text-muted">{a.description}</div>
                {!got && p < 1 && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <Progress value={p * 100} className="max-w-[120px]" />
                    <span className="tf-mono text-[10px] tabular-nums text-muted/70">
                      {Math.round(p * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 text-center">
        <Link to="/practice" className="tf-btn tf-btn-primary text-xs">
          继续练习解锁更多
        </Link>
      </div>
    </div>
  );
}

/** 给未解锁的成就算个进度百分比，让目标看得见 */
function progressOf(
  id: string,
  c: {
    totalSessions: number;
    totalWords: number;
    streak: number;
    bestWpm: number;
    accuracy: number;
    masteredCount: number;
    totalKeystrokes: number;
  },
): number {
  const ratio = (cur: number, goal: number) => Math.min(1, cur / goal);
  switch (id) {
    case 'first-step':
      return ratio(c.totalSessions, 1);
    case 'hundred':
      return ratio(c.totalWords, 100);
    case 'thousand':
      return ratio(c.totalWords, 1000);
    case 'streak-3':
      return ratio(c.streak, 3);
    case 'streak-7':
      return ratio(c.streak, 7);
    case 'streak-30':
      return ratio(c.streak, 30);
    case 'wpm-40':
      return ratio(c.bestWpm, 40);
    case 'wpm-60':
      return ratio(c.bestWpm, 60);
    case 'wpm-80':
      return ratio(c.bestWpm, 80);
    case 'accuracy-95':
      return ratio(c.accuracy, 0.95);
    case 'mastered-50':
      return ratio(c.masteredCount, 50);
    case 'mastered-500':
      return ratio(c.masteredCount, 500);
    case 'keys-10000':
      return ratio(c.totalKeystrokes, 10000);
    case 'keys-100000':
      return ratio(c.totalKeystrokes, 100000);
    default:
      return 0;
  }
}

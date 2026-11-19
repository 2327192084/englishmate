/**
 * 数据页：学习报告、热力图、词库分布、进步曲线。
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import type { DailyStat, PracticeSession, UserWord } from '@/types';
import {
  aggregateDaily,
  computeLongestStreak,
  computeStreak,
  localDateKey,
  summarize,
} from '@/lib/stats';
import { todayCounts } from '@/services/learning';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP } from '@/data/achievements';
import { EmptyState, Segmented, Skeleton, StatBlock } from '@/components/ui';
import { IconFlame, IconChart, IconTrophy } from '@/components/Icons';

type Range = '7' | '30' | '90';

export default function StatsPage() {
  const sessions = useLiveQuery(() => db.sessions.toArray(), [], []);
  const words = useLiveQuery(() => db.userWords.toArray(), [], []);
  const unlocked = useLiveQuery(() => db.achievements.toArray(), [], []);
  const [range, setRange] = useState<Range>('30');
  const [counts, setCounts] = useState({ todayNew: 0, todayReviewed: 0 });

  useMemo(() => {
    void todayCounts().then(setCounts);
  }, []);

  const daily = useMemo(() => aggregateDaily(sessions ?? []), [sessions]);
  const streak = useMemo(() => computeStreak(daily), [daily]);
  const longest = useMemo(() => computeLongestStreak(daily), [daily]);
  const overview = useMemo(
    () => summarize(sessions ?? [], words ?? [], counts.todayNew, counts.todayReviewed),
    [sessions, words, counts],
  );

  const rangeDays = Number(range);
  const inRange = useMemo(() => {
    const cutoff = Date.now() - rangeDays * 86400000;
    return daily.filter((d) => new Date(d.date + 'T00:00:00').getTime() >= cutoff);
  }, [daily, rangeDays]);

  const heatmap = useMemo(() => buildHeatmap(daily, 119), [daily]);

  if (!sessions || !words) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Skeleton className="mb-4 h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  /**
   * 只要有学过词就算有数据。
   * 只看 sessions 会漏掉"练到一半刷新"的情况——那些词已经进库了，
   * 却显示"还没有学习数据"，等于告诉用户白练了。
   */
  const hasData = sessions.length > 0 || words.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">学习数据</h1>
          <p className="mt-1 text-sm text-muted">所有数据都保存在这台设备上</p>
        </div>
        <Segmented<Range>
          value={range}
          onChange={setRange}
          size="sm"
          options={[
            { value: '7', label: '7天' },
            { value: '30', label: '30天' },
            { value: '90', label: '90天' },
          ]}
        />
      </header>

      {!hasData ? (
        <EmptyState
          icon={<IconChart width={32} height={32} />}
          title="还没有学习数据"
          hint="完成第一轮练习后，这里会显示你的 WPM 曲线、学习热力图和词库进度。"
          action={
            <Link to="/practice" className="tf-btn tf-btn-primary mt-2 text-xs">
              开始第一轮
            </Link>
          }
        />
      ) : (
        <>
          {/* 核心指标 */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBlock label="连续天数" value={streak} unit="天" hint={`最长 ${longest} 天`} />
            <StatBlock label="最佳 WPM" value={overview.bestWpm} hint={`平均 ${overview.avgWpm}`} />
            <StatBlock
              label="总正确率"
              value={`${Math.round(overview.accuracy * 100)}%`}
              hint={`${overview.totalKeystrokes} 次击键`}
            />
            <StatBlock
              label="累计练习"
              value={overview.totalWords}
              unit="词次"
              hint={`${overview.totalSessions} 轮`}
            />
          </div>

          {/* 词汇状态 */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBlock label="学习中" value={words.filter((w) => !w.mastered).length} unit="词" />
            <StatBlock
              label="已掌握"
              value={overview.masteredCount}
              unit="词"
              hint="标记为掌握的词"
            />
            <StatBlock label="错词本" value={overview.wrongCount} unit="词" hint="错过的词" />
            <StatBlock label="待复习" value={overview.dueCount} unit="词" hint="已到期" />
          </div>

          {/* WPM 趋势 */}
          <section className="tf-card mb-4 px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-ink">WPM 趋势</h2>
              <span className="text-[11px] text-muted">每日最佳</span>
            </div>
            {inRange.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">
                还没有完成的练习轮次。练完一轮后这里会出现趋势曲线。
              </p>
            ) : (
              <WpmChart data={inRange} />
            )}
          </section>

          {/* 每日词数 */}
          <section className="tf-card mb-4 px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-ink">每日练习量</h2>
              <span className="text-[11px] text-muted">词次 / 天</span>
            </div>
            {inRange.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">暂无数据</p>
            ) : (
              <VolumeChart data={inRange} target={20} />
            )}
          </section>

          {/* 热力图 */}
          <section className="tf-card mb-4 px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <IconFlame width={15} height={15} className="text-amber-400" />
                学习热力图
              </h2>
              <span className="text-[11px] text-muted">最近 17 周</span>
            </div>
            <Heatmap cells={heatmap} />
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((l) => (
                <span key={l} className={`h-[13px] w-[13px] rounded-[3px] ${heatClass(l)}`} />
              ))}
              <span>多</span>
            </div>
          </section>

          {/* 练习模式分布 */}
          <section className="tf-card mb-4 px-4 py-4">
            <h2 className="mb-3 text-sm font-medium text-ink">练习模式分布</h2>
            <ModeBreakdown sessions={sessions} />
          </section>

          {/* 词库进度 */}
          <section className="tf-card mb-4 px-4 py-4">
            <h2 className="mb-3 text-sm font-medium text-ink">词库进度</h2>
            <BankProgress words={words} />
          </section>

          {/* 成就 */}
          <section className="tf-card mb-4 px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <IconTrophy width={15} height={15} className="text-amber-400" />
                成就
              </h2>
              <Link to="/achievements" className="text-[11px] text-accent hover:underline">
                {unlocked?.length ?? 0} / {ACHIEVEMENTS.length} 查看全部 →
              </Link>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(unlocked ?? []).slice(0, 10).map((u) => {
                const def = ACHIEVEMENT_MAP.get(u.id);
                if (!def) return null;
                return (
                  <span
                    key={u.id}
                    title={`${def.name} · ${def.description}`}
                    className="flex items-center gap-1 rounded-full border border-line bg-surface2 px-2 py-1 text-xs"
                  >
                    <span>{def.icon}</span>
                    <span className="text-ink">{def.name}</span>
                  </span>
                );
              })}
              {(unlocked?.length ?? 0) === 0 && (
                <span className="text-xs text-muted">还没有解锁成就，继续练就好</span>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** ---------- 图表组件（纯 SVG，不引图表库） ---------- */

function WpmChart({ data }: { data: DailyStat[] }) {
  const w = 640;
  const h = 140;
  const pad = { l: 28, r: 8, t: 10, b: 18 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(40, ...data.map((d) => d.bestWpm));
  const points = data.map((d, i) => {
    const x = pad.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = pad.t + innerH - (d.bestWpm / max) * innerH;
    return { x, y, d };
  });
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${pad.t + innerH} L${points[0].x.toFixed(1)},${pad.t + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="WPM 趋势图">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={pad.t + innerH * f}
            y2={pad.t + innerH * f}
            stroke="rgb(var(--tf-border))"
            strokeDasharray="3 4"
          />
          <text x={2} y={pad.t + innerH * f + 3} fill="rgb(var(--tf-muted))" fontSize="9">
            {Math.round(max * (1 - f))}
          </text>
        </g>
      ))}
      <path d={area} fill="rgb(var(--tf-accent))" opacity="0.12" />
      <path
        d={line}
        fill="none"
        stroke="rgb(var(--tf-accent))"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="rgb(var(--tf-accent))">
          <title>
            {p.d.date} · {p.d.bestWpm} WPM
          </title>
        </circle>
      ))}
      {points.length <= 12 &&
        points.map((p, i) => (
          <text
            key={i}
            x={p.x}
            y={h - 4}
            fill="rgb(var(--tf-muted))"
            fontSize="8"
            textAnchor="middle"
          >
            {p.d.date.slice(5)}
          </text>
        ))}
    </svg>
  );
}

function VolumeChart({ data, target }: { data: DailyStat[]; target: number }) {
  const w = 640;
  const h = 120;
  const pad = { l: 24, r: 6, t: 8, b: 16 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(target, ...data.map((d) => d.words));
  /**
   * 柱宽要封顶：只有一天数据时 innerW/1 会让柱子铺满整个图表，
   * 看起来像一整块色条而不是"一根柱子"。上限 40px，少数据时也不会失真。
   */
  const bw = Math.min(40, Math.max(2, innerW / data.length - 1.5));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="每日练习量">
      <line
        x1={pad.l}
        x2={w - pad.r}
        y1={pad.t + innerH - (target / max) * innerH}
        y2={pad.t + innerH - (target / max) * innerH}
        stroke="rgb(var(--tf-muted))"
        strokeDasharray="3 3"
        opacity="0.5"
      />
      {data.map((d, i) => {
        const bh = Math.max(1, (d.words / max) * innerH);
        const x = pad.l + (i / data.length) * innerW;
        return (
          <rect
            key={i}
            x={x}
            y={pad.t + innerH - bh}
            width={bw}
            height={bh}
            rx="1"
            fill={d.words >= target ? 'rgb(var(--tf-correct))' : 'rgb(var(--tf-accent))'}
            opacity={d.words >= target ? 0.85 : 0.6}
          >
            <title>
              {d.date} · {d.words} 词 · {d.minutes} 分钟
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

interface HeatCell {
  date: string;
  level: number;
  words: number;
}

function buildHeatmap(daily: DailyStat[], days: number): HeatCell[] {
  const map = new Map(daily.map((d) => [d.date, d]));
  const cells: HeatCell[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const key = localDateKey(d.getTime());
    const stat = map.get(key);
    const words = stat?.words ?? 0;
    const level = words === 0 ? 0 : words < 10 ? 1 : words < 25 ? 2 : words < 50 ? 3 : 4;
    cells.push({ date: key, level, words });
  }
  return cells;
}

function heatClass(level: number): string {
  switch (level) {
    case 0:
      return 'bg-surface2';
    case 1:
      return 'bg-accent/25';
    case 2:
      return 'bg-accent/50';
    case 3:
      return 'bg-accent/75';
    default:
      return 'bg-accent';
  }
}

function Heatmap({ cells }: { cells: HeatCell[] }) {
  // 按周分列：每列 7 天
  const weeks: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <div className="flex justify-center overflow-x-auto pb-1">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {week.map((c) => (
            <div
              key={c.date}
              title={`${c.date} · ${c.words} 词`}
              // 格子放大到 3.25（13px）并给个最小间距，否则在高分屏上糊成一片
              className={`mr-1 h-[13px] w-[13px] shrink-0 rounded-[3px] ${heatClass(c.level)}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const MODE_NAME: Record<string, string> = {
  typing: '跟打',
  dictation: '听写',
  recall: '默写',
  choice: '辨认',
};

function ModeBreakdown({ sessions }: { sessions: PracticeSession[] }) {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.mode, (counts.get(s.mode) ?? 0) + 1);
  const total = sessions.length || 1;
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-2">
      {rows.map(([mode, n]) => (
        <div key={mode} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-muted">{MODE_NAME[mode] ?? mode}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(n / total) * 100}%` }}
            />
          </div>
          <span className="tf-mono w-10 shrink-0 text-right text-[11px] tabular-nums text-muted">
            {Math.round((n / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function BankProgress({ words }: { words: UserWord[] }) {
  const map = new Map<string, { total: number; mastered: number }>();
  for (const w of words) {
    const cur = map.get(w.bankId) ?? { total: 0, mastered: 0 };
    cur.total += 1;
    if (w.mastered) cur.mastered += 1;
    map.set(w.bankId, cur);
  }
  const rows = [...map.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);

  if (rows.length === 0) {
    return <p className="text-xs text-muted">还没有开始任何词库</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map(([bankId, v]) => (
        <div key={bankId} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-[11px] text-muted">
            {bankId.replace('custom:', '')}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full rounded-full bg-correct"
              style={{ width: `${(v.mastered / Math.max(1, v.total)) * 100}%` }}
            />
          </div>
          <span className="tf-mono shrink-0 text-[11px] tabular-nums text-muted">
            {v.mastered}/{v.total}
          </span>
        </div>
      ))}
    </div>
  );
}

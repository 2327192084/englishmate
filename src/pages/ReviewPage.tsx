/**
 * 复习页 —— FSRS 队列的入口。
 *
 * 和学习页的区别：这里只练「已经学过、且到期」的词，
 * 并给出每个词的记忆强度（可提取概率），让用户理解为什么现在复习它。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import type { UserWord, PracticeMode } from '@/types';
import { loadWords } from '@/data/wordbanks';
import { buildRound } from '@/data/round';
import { usePractice } from '@/store/practice';
import { useSettings } from '@/store/settings';
import { retrievability } from '@/lib/fsrs';
import { EmptyState, Progress, Segmented, Skeleton } from '@/components/ui';
import { IconFlame, IconRefresh, IconVolume } from '@/components/Icons';
import { speak } from '@/lib/speech';

type Bucket = 'due' | 'soon' | 'all';

export default function ReviewPage() {
  const userWords = useLiveQuery(() => db.userWords.toArray(), [], []);
  const [bucket, setBucket] = useState<Bucket>('due');
  const [mode, setMode] = useState<PracticeMode>('typing');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = usePractice();
  const settings = useSettings((s) => s.settings);
  const navigate = useNavigate();

  const { dueList, soonList, learned } = useMemo(() => {
    const now = Date.now();
    const all = (userWords ?? []).filter((w) => !w.mastered);
    const due = all.filter((w) => w.card.due <= now).sort((a, b) => a.card.due - b.card.due);
    const soon = all
      .filter((w) => w.card.due > now && w.card.due <= now + 3 * 24 * 3600 * 1000)
      .sort((a, b) => a.card.due - b.card.due);
    return { dueList: due, soonList: soon, learned: all.length };
  }, [userWords]);

  const shown = bucket === 'due' ? dueList : bucket === 'soon' ? soonList : (userWords ?? []);

  /**
   * 开始复习：从 due 队列里出题。
   * 队列为空时提示去学新词，而不是硬凑。
   */
  const startReview = async () => {
    if (dueList.length === 0) {
      setError('当前没有到期需要复习的词，去练习页学几个新词吧。');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // 按 bank 分组，一个 bank 一个 round，从最多的 bank 开始
      const byBank = new Map<string, UserWord[]>();
      for (const w of dueList) {
        const arr = byBank.get(w.bankId) ?? [];
        arr.push(w);
        byBank.set(w.bankId, arr);
      }
      const [topBank, topWords] = [...byBank.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )[0];

      if (topBank.startsWith('custom:')) {
        // 自定义词库同样走 loadWords
        const words = await loadWords(topBank);
        const entryMap = new Map(words.map((e) => [e.w.toLowerCase(), e]));
        const known = new Map((userWords ?? []).map((w) => [w.word.toLowerCase(), w]));
        const plan = buildRound({
          bankId: topBank,
          allWords: words,
          known,
          size: Math.min(settings.roundSize, topWords.length),
          newQuota: 0,
          mode,
          reviewLimit: settings.dailyReviewLimit,
        });
        if (plan.entries.length === 0 && entryMap.size > 0) {
          // 兜底：直接用到期词条拼
          const entries = topWords
            .map((w) => entryMap.get(w.word.toLowerCase()))
            .filter((e): e is NonNullable<typeof e> => !!e)
            .slice(0, settings.roundSize);
          p.start({ mode, bankId: topBank, queue: entries, reasons: new Map() });
        } else {
          p.start({ mode, bankId: topBank, queue: plan.entries, reasons: plan.reasons });
        }
      } else {
        const words = await loadWords(topBank);
        const known = new Map((userWords ?? []).map((w) => [w.word.toLowerCase(), w]));
        const plan = buildRound({
          bankId: topBank,
          allWords: words,
          known,
          size: Math.min(settings.roundSize, Math.max(5, topWords.length)),
          newQuota: 0,
          mode,
          reviewLimit: settings.dailyReviewLimit,
        });
        // buildRound 会优先出 due 词；若不足，用到期词直接补
        const picked = new Set(plan.entries.map((e) => e.w.toLowerCase()));
        const wordsByLower = new Map(words.map((e) => [e.w.toLowerCase(), e]));
        for (const uw of topWords) {
          if (plan.entries.length >= settings.roundSize) break;
          const k = uw.word.toLowerCase();
          if (picked.has(k)) continue;
          const e = wordsByLower.get(k);
          if (e) {
            plan.entries.push(e);
            plan.reasons.set(k, 'review');
            picked.add(k);
          }
        }
        p.start({ mode, bankId: topBank, queue: plan.entries, reasons: plan.reasons });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '复习启动失败');
    } finally {
      setStarting(false);
    }
  };

  /** 复习一旦开始就跳到练习页，复用那套完整界面与结算 */
  const handleStart = async () => {
    await startReview();
    if (usePractice.getState().phase === 'running') {
      navigate(`/practice?bank=${encodeURIComponent(usePractice.getState().bankId)}&mode=${mode}`);
    }
  };

  if (p.phase === 'running' || p.phase === 'finished') {
    // 复习复用练习页的完整流程；正常情况下 start() 后已跳转，这里只是兜底
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-center text-sm text-muted">
        <p>正在复习中…</p>
        <button
          type="button"
          onClick={() => navigate('/practice')}
          className="tf-btn tf-btn-primary mt-4 text-xs"
        >
          前往练习界面
        </button>
      </div>
    );
  }

  if (!userWords)
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-40" />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">复习队列</h1>
        <p className="mt-1 text-sm text-muted">
          按 FSRS 记忆曲线安排：到期越久、越容易忘的词排在最前
        </p>
      </header>

      {/* 概览 */}
      <div className="mb-5 grid grid-cols-3 gap-2">
        <div className="tf-card px-3 py-3 text-center">
          <div className="tf-mono text-2xl font-semibold tabular-nums text-error">
            {dueList.length}
          </div>
          <div className="text-[11px] text-muted">已到期</div>
        </div>
        <div className="tf-card px-3 py-3 text-center">
          <div className="tf-mono text-2xl font-semibold tabular-nums text-accent">
            {soonList.length}
          </div>
          <div className="text-[11px] text-muted">3 天内到期</div>
        </div>
        <div className="tf-card px-3 py-3 text-center">
          <div className="tf-mono text-2xl font-semibold tabular-nums text-ink">{learned}</div>
          <div className="text-[11px] text-muted">学习中</div>
        </div>
      </div>

      {learned === 0 ? (
        <EmptyState
          icon={<IconFlame width={32} height={32} />}
          title="还没有需要复习的词"
          hint="先学一些新词，FSRS 会在你快要忘记的时候把它们排进复习队列。"
          action={
            <Link to="/practice" className="tf-btn tf-btn-primary mt-2 text-xs">
              去学新词
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Segmented<Bucket>
              value={bucket}
              onChange={setBucket}
              size="sm"
              options={[
                { value: 'due', label: `已到期 ${dueList.length}` },
                { value: 'soon', label: `3天内 ${soonList.length}` },
                { value: 'all', label: `全部 ${userWords.length}` },
              ]}
            />
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={starting || dueList.length === 0}
              className="tf-btn tf-btn-primary text-xs"
            >
              <IconRefresh width={14} height={14} />
              {starting
                ? '准备中…'
                : `开始复习（${Math.min(dueList.length, settings.roundSize)} 词）`}
            </button>
          </div>

          {error && (
            <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-400">
              {error}
            </div>
          )}

          <div className="mb-4 flex items-center gap-2">
            <span className="text-[11px] text-muted">模式</span>
            <Segmented<PracticeMode>
              value={mode}
              onChange={setMode}
              size="sm"
              options={[
                { value: 'typing', label: '跟打' },
                { value: 'dictation', label: '听写' },
                { value: 'recall', label: '默写' },
                { value: 'choice', label: '辨认' },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <EmptyState title="这个分组里暂时没有词" hint="换一个分组看看。" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                {shown.slice(0, 200).map((w) => (
                  <ReviewRow key={w.id} uw={w} accent={settings.accent} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewRow({ uw, accent }: { uw: UserWord; accent: 'en-US' | 'en-GB' }) {
  const now = Date.now();
  const r = retrievability(uw.card, now);
  const overdueDays = Math.floor((now - uw.card.due) / 86400000);
  const dueText =
    uw.card.due <= now
      ? overdueDays > 0
        ? `逾期 ${overdueDays} 天`
        : '现在'
      : `${Math.max(1, Math.ceil((uw.card.due - now) / 86400000))} 天后`;

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface2/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="tf-mono text-sm font-medium text-ink">{uw.word}</span>
          {uw.phonetic && <span className="tf-mono text-[10px] text-muted/70">{uw.phonetic}</span>}
        </div>
        <div className="truncate text-[11px] text-muted">{uw.trans}</div>
      </div>

      <div className="w-24 shrink-0">
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
          <span>记忆</span>
          <span className="tf-mono tabular-nums">{Math.round(r * 100)}%</span>
        </div>
        <Progress value={r * 100} />
      </div>

      <div className="w-20 shrink-0 text-right">
        <div className={`text-[11px] ${uw.card.due <= now ? 'text-error' : 'text-muted'}`}>
          {dueText}
        </div>
        <div className="tf-mono text-[10px] text-muted/60">
          间隔 {Math.round(uw.card.scheduledDays)}d
        </div>
      </div>

      <button
        type="button"
        onClick={() => speak(uw.word, { accent })}
        className="shrink-0 rounded p-1.5 text-muted hover:text-accent"
        aria-label="朗读"
      >
        <IconVolume width={13} height={13} />
      </button>
    </div>
  );
}

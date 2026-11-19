/**
 * 练习页 —— 从选题到结算的完整闭环。
 *
 * 三个界面状态：
 *   setup    选题（词库 / 模式 / 轮次大小）
 *   running  打字中
 *   summary  本轮结算
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PracticeMode, UserWord } from '@/types';
import { db, getMeta, setMeta } from '@/db';
import { loadBankIndex, loadWords, listCustomBanks, CATEGORY_LABEL } from '@/data/wordbanks';
import { buildRound, buildChoices } from '@/data/round';
import { buildPlan, flattenPlan, FLOW_PRESETS, type FlowPreset } from '@/lib/flow';
import { usePractice } from '@/store/practice';
import { useSettings } from '@/store/settings';
import { recordAttempt, saveSession, todayCounts } from '@/services/learning';
import { TypingArea } from '@/components/TypingArea';
import { Chip, Progress, Skeleton } from '@/components/ui';
import {
  IconArrowRight,
  IconLightning,
  IconRefresh,
  IconVolume,
  IconX,
  IconCheck,
} from '@/components/Icons';
import type { WordbankMeta } from '@/types';
import { speak } from '@/lib/speech';
import { playFinishSound } from '@/lib/sound';

const MODES: { id: PracticeMode; name: string; hint: string }[] = [
  { id: 'typing', name: '跟打', hint: '看词打字，实时校验' },
  { id: 'dictation', name: '听写', hint: '听发音拼写' },
  { id: 'recall', name: '默写', hint: '看释义写单词' },
  { id: 'choice', name: '辨认', hint: '四选一快速过词' },
];

const LAST_BANK_KEY = 'lastBankId';
const LAST_MODE_KEY = 'lastMode';

export default function PracticePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const p = usePractice();

  const [banks, setBanks] = useState<WordbankMeta[] | null>(null);
  const [bankId, setBankId] = useState<string>('');
  const [mode, setMode] = useState<PracticeMode>('typing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState({ todayNew: 0, todayReviewed: 0 });
  const [roundSize, setRoundSize] = useState(settings.roundSize);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(false);
  /** 已经写进数据库的 attempts 数量，用于增量落库去重 */
  const savedUpToRef = useRef(0);

  /** 初始化：词库列表 + 记忆上次选择 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [idx, custom, lastBank, lastMode] = await Promise.all([
        loadBankIndex(),
        listCustomBanks(),
        getMeta<string>(LAST_BANK_KEY, ''),
        getMeta<string>(LAST_MODE_KEY, 'typing'),
      ]);
      if (!alive) return;
      const all = [...idx.banks, ...custom];
      setBanks(all);
      const wanted = params.get('bank');
      const pick = wanted ?? (all.find((b) => b.id === lastBank)?.id || all[0]?.id || '');
      setBankId(pick);
      const m = (params.get('mode') as PracticeMode | null) ?? (lastMode as PracticeMode);
      if (MODES.some((x) => x.id === m)) setMode(m);
      setCounts(await todayCounts());
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** URL 里的 bank/mode 变化时同步 */
  useEffect(() => {
    const qBank = params.get('bank');
    const qMode = params.get('mode') as PracticeMode | null;
    if (qBank && qBank !== bankId) setBankId(qBank);
    if (qMode && MODES.some((x) => x.id === qMode) && qMode !== mode) setMode(qMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const userWords = useLiveQuery(() => db.userWords.toArray(), [], []);

  const known = useMemo(() => {
    const m = new Map<string, UserWord>();
    for (const w of userWords ?? []) m.set(w.word.toLowerCase(), w);
    return m;
  }, [userWords]);

  const activeBank = banks?.find((b) => b.id === bankId);
  const learnedInBank = useMemo(
    () => (userWords ?? []).filter((w) => w.bankId === bankId).length,
    [userWords, bankId],
  );

  /** 开始一轮 */
  const startRound = useCallback(async () => {
    if (!bankId) return;
    setLoading(true);
    setError(null);
    savedRef.current = false;
    savedUpToRef.current = 0;
    try {
      const words = await loadWords(bankId);
      const remainingNew = Math.max(0, settings.dailyNewTarget - counts.todayNew);
      const round = buildRound({
        bankId,
        allWords: words,
        known,
        size: mode === 'choice' ? Math.max(10, roundSize) : roundSize,
        newQuota: remainingNew,
        mode,
      });
      if (round.entries.length === 0) {
        setError('这个词库暂时没有可练的词，换一个词库试试。');
        return;
      }

      /**
       * 生成练习流程。
       *
       * 辨认模式是"快速过词"，不适合再串跟打/默写，所以强制走单模式；
       * 其余模式按用户选的流程模板展开成线性队列——
       * 这样"同一批词先跟打、立刻默写、再进下一组"的语义得以保留，
       * 而练习界面仍然只需要处理一个 queue + index。
       */
      const presetId: FlowPreset = mode === 'choice' ? 'followOnly' : settings.flowPreset;
      const flow = buildPlan(round.entries, presetId, settings.groupSize);
      const items = flattenPlan(flow);

      await setMeta(LAST_BANK_KEY, bankId);
      await setMeta(LAST_MODE_KEY, mode);
      p.start({
        mode,
        bankId,
        queue: items.map((i) => i.entry),
        reasons: round.reasons,
        plan: items,
      });
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('bank', bankId);
        next.set('mode', mode);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '词库加载失败');
    } finally {
      setLoading(false);
    }
  }, [
    bankId,
    counts.todayNew,
    known,
    mode,
    p,
    roundSize,
    setParams,
    settings.dailyNewTarget,
    settings.flowPreset,
    settings.groupSize,
  ]);

  /**
   * 增量落库：每答完一个词就写进数据库。
   *
   * 不能等整轮结束才写——用户练到一半刷新、关标签页、或者直接切走，
   * 那一轮的词就全丢了。本地优先的应用里这是最不可接受的失败模式。
   * savedUpToRef 保证同一个 attempt 只写一次（effect 会因重渲染多次触发）。
   */
  useEffect(() => {
    if (p.phase !== 'running' && p.phase !== 'finished') return;
    if (savedUpToRef.current >= p.attempts.length) return;

    const pending = p.attempts.slice(savedUpToRef.current);
    savedUpToRef.current = p.attempts.length;

    void (async () => {
      for (const a of pending) {
        await recordAttempt({
          entry: a.entry,
          bankId: a.bankId,
          correct: a.correct,
          mistakes: a.mistakes,
          now: p.roundStartedAt + a.ms,
        });
      }
      // 让练习页顶部的"今日已学"实时跟上
      setCounts(await todayCounts());
    })();
  }, [p.attempts, p.phase, p.roundStartedAt]);

  /** 一轮结束后：写会话记录 + 结算 */
  useEffect(() => {
    if (p.phase !== 'finished' || savedRef.current) return;
    if (p.attempts.length === 0) return;
    savedRef.current = true;
    setSaving(true);
    void (async () => {
      try {
        await saveSession({
          mode: p.mode,
          bankId: p.bankId,
          startedAt: p.roundStartedAt,
          endedAt: Date.now(),
          attempts: p.attempts,
          // 用活跃时长算 WPM：挂机 / 系统休眠的时间不算练习
          activeMs: p.elapsed(),
        });
        setCounts(await todayCounts());
        if (settings.keySound) playFinishSound(settings.keyVolume);
      } finally {
        setSaving(false);
      }
    })();
  }, [
    p.phase,
    p.attempts,
    p.mode,
    p.bankId,
    p.roundStartedAt,
    settings.keySound,
    settings.keyVolume,
  ]);

  /** 辨认模式：进入每个词时生成选项 */
  useEffect(() => {
    if (p.phase !== 'running' || p.mode !== 'choice') return;
    const cur = p.current();
    if (!cur) return;
    void loadWords(p.bankId).then((all) => {
      const opts = buildChoices(cur, all);
      p.buildChoices(() => opts);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.index, p.phase, p.mode, p.bankId]);

  /** 辨认模式选中后延迟跳下一个 */
  useEffect(() => {
    if (p.mode !== 'choice' || p.choicePicked === null) return;
    const chosen = p.choices[p.choicePicked];
    if (!chosen) return;
    // 判错与计数统一由 store.next() 负责，这里只跳动画面
    const t = window.setTimeout(
      () => {
        usePractice.getState().next();
      },
      chosen.correct ? 260 : 1100,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.choicePicked]);

  /** ---------- 渲染 ---------- */

  if (p.phase === 'running') {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col justify-center">
        <div className="px-4 pb-1 pt-3">
          <Progress value={(p.index / Math.max(1, p.queue.length)) * 100} />
        </div>
        {p.mode === 'choice' ? <ChoiceBoard /> : <TypingArea />}
        <div className="pb-4 text-center">
          <button
            type="button"
            onClick={() => {
              if (p.attempts.length > 0) {
                if (!window.confirm('结束本轮？已练的词会保存。')) return;
                // 触发落库：先跳到结束
                usePractice.setState({ phase: 'finished' });
              } else {
                p.reset();
              }
            }}
            className="text-xs text-muted underline-offset-2 hover:text-error hover:underline"
          >
            结束本轮
          </button>
        </div>
      </div>
    );
  }

  if (p.phase === 'finished') {
    return <Summary saving={saving} onAgain={() => void startRound()} onBack={() => p.reset()} />;
  }

  // setup
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink">开始练习</h1>
        <p className="mt-1 text-sm text-muted">
          今日已学 <span className="tf-mono font-semibold text-ink">{counts.todayNew}</span> 个新词
          · 复习 <span className="tf-mono font-semibold text-ink">{counts.todayReviewed}</span> 个 ·
          目标 {settings.dailyNewTarget} 新词
        </p>
      </header>

      {/* 模式 */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">练习模式</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  setParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('mode', m.id);
                    return next;
                  });
                }}
                className={`tf-card flex flex-col items-start gap-1 px-3 py-3 text-left transition-colors ${
                  active ? 'border-accent bg-accent/10' : 'hover:border-accent/50'
                }`}
              >
                <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-ink'}`}>
                  {m.name}
                </span>
                <span className="text-[11px] leading-tight text-muted">{m.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/*
        流程选择：决定"一批词练几轮"。
        辨认模式是快速过词，不参与流程编排，所以这里对辨认模式隐藏。
      */}
      {mode !== 'choice' && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
            <span>练习流程</span>
            <span className="normal-case text-muted/70">
              {FLOW_PRESETS[settings.flowPreset].steps.length > 1
                ? `每组 ${settings.groupSize} 词循环`
                : '整批过一遍'}
            </span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(FLOW_PRESETS) as FlowPreset[]).map((key) => {
              const tpl = FLOW_PRESETS[key];
              const active = settings.flowPreset === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void update({ flowPreset: key })}
                  className={`tf-card flex flex-col items-start gap-1 px-3 py-2.5 text-left transition-colors ${
                    active ? 'border-accent bg-accent/10' : 'hover:border-accent/50'
                  }`}
                >
                  <span className={`text-sm font-semibold ${active ? 'text-accent' : 'text-ink'}`}>
                    {tpl.name}
                  </span>
                  <span className="text-[11px] leading-tight text-muted">{tpl.hint}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {tpl.steps.map((st) => (
                      <span
                        key={st.id}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          active ? 'bg-accent/15 text-accent' : 'bg-surface2 text-muted'
                        }`}
                      >
                        {st.label}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
          {settings.flowPreset !== 'followOnly' && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <span>每组词数</span>
              <input
                type="range"
                min={3}
                max={15}
                step={1}
                value={settings.groupSize}
                onChange={(e) => void update({ groupSize: Number(e.target.value) })}
                className="w-28 accent-[rgb(var(--tf-accent))]"
              />
              <span className="tf-mono tabular-nums text-ink">{settings.groupSize}</span>
              <span className="text-muted/70">一组练完立刻换模式再练，比逐词过一遍记得牢</span>
            </div>
          )}
        </section>
      )}

      {/* 词库 */}
      <section className="mb-6">
        <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted">
          <span>选择词库</span>
          {activeBank && (
            <span className="normal-case text-muted/70">
              {learnedInBank} / {activeBank.count} 已学
            </span>
          )}
        </h2>
        {!banks ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {banks.map((b) => {
              const active = b.id === bankId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setBankId(b.id);
                    setParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.set('bank', b.id);
                      return next;
                    });
                  }}
                  className={`tf-card flex items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                    active ? 'border-accent bg-accent/10' : 'hover:border-accent/50'
                  }`}
                >
                  <div className="min-w-0">
                    <div
                      className={`truncate text-sm font-medium ${active ? 'text-accent' : 'text-ink'}`}
                    >
                      {b.name}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">{b.description}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tf-mono text-xs tabular-nums text-muted">{b.count}</div>
                    <div className="text-[10px] text-muted/70">{CATEGORY_LABEL[b.category]}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => navigate('/words')}
          className="mt-2 text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
        >
          管理词库与导入自定义词库 →
        </button>
      </section>

      {/* 轮次大小 */}
      <section className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
        <div>
          <div className="text-sm font-medium text-ink">本轮词数</div>
          <div className="text-[11px] text-muted">10–50，默认跟随每日目标</div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={roundSize}
            onChange={(e) => setRoundSize(Number(e.target.value))}
            className="w-32 accent-[rgb(var(--tf-accent))]"
          />
          <span className="tf-mono w-8 text-right text-sm font-semibold tabular-nums text-ink">
            {roundSize}
          </span>
        </div>
      </section>

      {error && (
        <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void startRound()}
          disabled={loading || !bankId}
          className="tf-btn tf-btn-primary flex-1 py-2.5 text-sm sm:flex-none sm:px-8"
        >
          {loading ? '加载词库…' : '开始'}
          {!loading && <IconArrowRight width={15} height={15} />}
        </button>
        <button
          type="button"
          onClick={() =>
            void update({ dailyNewTarget: Math.min(100, settings.dailyNewTarget + 10) })
          }
          className="tf-btn text-xs"
          title="把每日新词目标提高 10 个"
        >
          <IconLightning width={14} height={14} />
          多练 10 个
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">小提示</div>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted">
          <li>· 打错的字符不会前进，必须改对才能继续——这样才能避免把错拼法练成肌肉记忆。</li>
          <li>· 空格键直接进入下一个词，Tab 跳过（记为答错，进错词本）。</li>
          <li>· 每个词的复习间隔由 FSRS 算法安排，答得越稳间隔越长。</li>
        </ul>
      </div>
    </div>
  );
}

/** 辨认模式面板 */
function ChoiceBoard() {
  const p = usePractice();
  const settings = useSettings((s) => s.settings);
  const cur = p.current();
  if (!cur) return null;

  return (
    <div className="flex flex-col items-center gap-5 px-4 py-8">
      <div className="text-[11px] font-medium text-muted">
        {p.reasons.get(cur.w.toLowerCase()) === 'new' ? '新词' : '复习'} · 选出正确释义
      </div>
      <div className="flex items-center gap-3">
        <span className="tf-mono text-4xl font-semibold tracking-wide text-ink">{cur.w}</span>
        <button
          type="button"
          onClick={() => speak(cur.w, { accent: settings.accent, rate: settings.speechRate })}
          className="rounded-md p-1.5 text-muted hover:bg-surface2 hover:text-accent"
          aria-label="朗读"
        >
          <IconVolume width={16} height={16} />
        </button>
      </div>
      {cur.p && <div className="tf-mono -mt-3 text-xs text-muted/70">{cur.p}</div>}

      <div className="grid w-full max-w-xl gap-2">
        {p.choices.length === 0 && <Skeleton className="h-11" />}
        {p.choices.map((c, i) => {
          const picked = p.choicePicked === i;
          const revealed = p.choicePicked !== null;
          const cls = !revealed
            ? 'hover:border-accent'
            : c.correct
              ? 'border-correct bg-correct/10 text-correct'
              : picked
                ? 'border-error bg-error/10 text-error'
                : 'opacity-50';
          return (
            <button
              key={i}
              type="button"
              disabled={revealed}
              onClick={() => {
                p.pickChoice(i);
                if (settings.keySound) playFinishSound(settings.keyVolume * 0.5);
              }}
              className={`tf-card flex items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors ${cls}`}
            >
              <span className="min-w-0 flex-1">{c.label}</span>
              {revealed && c.correct && <IconCheck width={16} height={16} className="shrink-0" />}
              {revealed && picked && !c.correct && (
                <IconX width={16} height={16} className="shrink-0" />
              )}
            </button>
          );
        })}
      </div>
      <div className="text-xs text-muted">
        {p.index + 1} / {p.queue.length}
      </div>
    </div>
  );
}

/** 结算页 */
function Summary({
  saving,
  onAgain,
  onBack,
}: {
  saving: boolean;
  onAgain: () => void;
  onBack: () => void;
}) {
  const p = usePractice();
  const navigate = useNavigate();

  const total = p.attempts.length;
  const correct = p.attempts.filter((a) => a.correct).length;
  const perfect = p.attempts.filter((a) => a.correct && a.mistakes === 0).length;
  const mistakes = p.attempts.reduce((s, a) => s + a.mistakes, 0);
  // 用活跃时长（排除挂机/休眠），与落库时的口径保持一致
  const activeMs = p.elapsed();
  const durationSec = Math.max(1, Math.round((activeMs || Date.now() - p.roundStartedAt) / 1000));
  const chars = p.attempts.reduce((s, a) => s + a.word.length, 0);
  const wpm = Math.max(0, Math.floor(chars / 5 / (durationSec / 60)));
  const accuracy = total === 0 ? 1 : (total - (total - correct)) / total;
  const wrongList = p.attempts.filter((a) => !a.correct || a.mistakes > 0);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-correct/15 text-correct">
          <IconCheck width={24} height={24} />
        </div>
        <h1 className="text-xl font-semibold text-ink">本轮完成</h1>
        <p className="mt-1 text-sm text-muted">
          {saving ? '正在保存学习记录…' : '记录已保存，复习计划已按 FSRS 更新'}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryStat label="词数" value={total} />
        <SummaryStat label="WPM" value={wpm} accent />
        <SummaryStat label="一次通过" value={`${perfect}/${total}`} />
        <SummaryStat label="错误按键" value={mistakes} tone={mistakes > 0 ? 'error' : undefined} />
      </div>

      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>
          正确 {correct}/{total} · 用时 {durationSec}s · 正确率 {Math.round(accuracy * 100)}%
        </span>
      </div>
      <Progress value={total ? (correct / total) * 100 : 0} className="mb-6" />

      {wrongList.length > 0 && (
        <div className="mb-6 rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
            本轮需要加强（已自动收录进错词本）
          </div>
          <div className="max-h-64 divide-y divide-line overflow-y-auto">
            {wrongList.map((a) => (
              <div key={a.word} className="flex items-center justify-between gap-3 px-4 py-2">
                <div className="min-w-0">
                  <span className="tf-mono text-sm font-medium text-ink">{a.word}</span>
                  <span className="ml-2 truncate text-[11px] text-muted">{a.entry.t}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.mistakes > 0 && <Chip tone="error">{a.mistakes} 错</Chip>}
                  {!a.correct && <Chip tone="warn">未完成</Chip>}
                  <button
                    type="button"
                    onClick={() =>
                      speak(a.word, { accent: useSettings.getState().settings.accent })
                    }
                    className="rounded p-1 text-muted hover:text-accent"
                    aria-label="朗读"
                  >
                    <IconVolume width={13} height={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAgain} className="tf-btn tf-btn-primary">
          <IconRefresh width={15} height={15} />
          再来一轮
        </button>
        <button type="button" onClick={() => navigate('/review')} className="tf-btn">
          去复习队列
        </button>
        <button type="button" onClick={onBack} className="tf-btn">
          回到设置
        </button>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  tone?: 'error';
}) {
  return (
    <div className="tf-card px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div
        className={`tf-mono mt-0.5 text-xl font-semibold tabular-nums ${
          tone === 'error' ? 'text-error' : accent ? 'text-accent' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

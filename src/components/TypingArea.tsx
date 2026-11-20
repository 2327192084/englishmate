/**
 * 打字练习区 —— 全应用最核心的组件。
 *
 * 交互契约（和 Qwerty Learner / Type Words 保持一致，用户不用重新学）：
 *   字母键 → 校验一个字符，错了原地不退格
 *   Space  → 提交并进入下一个词
 *   Backspace → 退一格（错误计数不回退）
 *   Esc    → 退出练习
 *   自动聚焦，点击空白处自动抢回焦点（但点按钮不要抢）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PracticeMode, WordEntry } from '@/types';
import { usePractice } from '@/store/practice';
import { useSettings } from '@/store/settings';
import { speak } from '@/lib/speech';
import { playKeySound, buzz } from '@/lib/sound';
import { isComplete } from '@/lib/typing';
import { IconVolume } from './Icons';
import { WordDetail } from './WordDetail';

const REASON_LABEL: Record<string, { text: string; cls: string }> = {
  review: { text: '复习', cls: 'text-accent' },
  wrong: { text: '错词', cls: 'text-error' },
  new: { text: '新词', cls: 'text-correct' },
  random: { text: '加练', cls: 'text-muted' },
  favorite: { text: '收藏', cls: 'text-amber-400' },
};

/** 单个字符的渲染状态 */
function charState(i: number, cursor: number, hasError: boolean, wrongAt: number[]) {
  // 非严格模式下已占据但打错的位置，即使光标已越过也要标红
  if (wrongAt.includes(i)) return 'wrong';
  if (i < cursor) return 'correct';
  if (i === cursor) return hasError ? 'error' : 'current';
  return 'pending';
}

export function TypingArea() {
  const p = usePractice();
  const settings = useSettings((s) => s.settings);
  const inputRef = useRef<HTMLDivElement>(null);
  /** 输入法是否正在组字；组字期间必须忽略所有按键 */
  const composingRef = useRef(false);
  /** 词条详情面板开关 */
  const [detailOpen, setDetailOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const cur = p.current();

  const hidden = p.mode === 'dictation' || p.mode === 'recall';

  /** 自动抢焦点：只在点击非交互元素时 */
  const focus = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    focus();
    // 换词时收起详情，避免面板停留在上一个词上
    setDetailOpen(false);
  }, [focus, p.index]);

  /** 每 200ms 刷新一次计时/WPM 显示（不重渲染整棵树的关键是用局部 state） */
  useEffect(() => {
    if (p.phase !== 'running') return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [p.phase]);

  /**
   * 每秒推进活跃计时。
   * 与上面 200ms 的显示刷新分开：计时器有自己的 tick 逻辑
   * （空闲暂停、休眠防护），不该被 UI 刷新频率影响。
   */
  useEffect(() => {
    if (p.phase !== 'running') return;
    const t = window.setInterval(() => usePractice.getState().tick(), 1000);
    return () => window.clearInterval(t);
  }, [p.phase]);

  /** 进入新词自动发音 */
  useEffect(() => {
    if (!cur) return;
    if (!settings.autoSpeak && p.mode !== 'dictation') return;
    speak(cur.w, { accent: settings.accent, rate: settings.speechRate });
  }, [cur?.w, p.index, settings.autoSpeak, settings.accent, settings.speechRate, p.mode, cur]);

  /** 键盘事件：只挂在练习容器上，避免全局监听打断输入框 */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (p.phase !== 'running') return;

      /**
       * ── 输入法（IME）处理 ────────────────────────────────────────────
       * 中文输入法开着时，按键会先进入组字缓冲区：
       *   - 组字过程中 e.key 可能是 'Process' 或拼音字母
       *   - 选中候选后浏览器还会补发一次 compositionend，并可能再触发 keydown
       * 如果不管，拼音字母会被当成答题内容（打 'nihao' 就判一堆错），
       * 即使用户最终选了正确的英文单词也救不回来。
       *
       * 做法：组字期间的按键一律不处理；等 compositionend 拿到最终字符再喂给引擎。
       */
      if (e.nativeEvent.isComposing || composingRef.current) return;
      if (e.key === 'Process') return;

      const k = e.key;

      /**
       * 提交键只保留 Space 一个。
       *
       * 原来 Space 和 Enter 走同一分支，两个键做同一件事——
       * 用户不知道该按哪个，提示里也只能写一个，另一个等于隐藏功能。
       * 统一到 Space：它在打字流里离手指最近，且不会与输入法候选上屏冲突。
       */
      if (k === ' ') {
        e.preventDefault();
        if (isComplete(p.typing) || p.mode === 'typing') {
          handleNext();
        } else {
          p.submit();
        }
        return;
      }
      /**
       * 发音快捷键：Tab。
       *
       * Tab 原本是"跳过当前词"，已按用户要求移除（与 Space 重复），
       * 现在这个键空出来，正好给发音——练听写时反复听一个词是高频操作，
       * 鼠标去点按钮太打断节奏。
       *
       * 为什么不用 Ctrl+某键：单手按组合键会分散打字注意力，
       * 而 Tab 在左手小指位置，按一下就能重听，不打断双手姿势。
       */
      if (k === 'Tab') {
        e.preventDefault();
        const now = usePractice.getState().current();
        if (now) speak(now.w, { accent: settings.accent, rate: settings.speechRate });
        return;
      }

      if (k === 'Backspace') {
        e.preventDefault();
        p.backspace();
        if (settings.keySound) playKeySound(settings.keyVolume, 'up');
        return;
      }
      if (k === 'Escape') {
        e.preventDefault();
        if (window.confirm('退出本轮练习？已完成的词会保留记录。')) {
          window.location.hash = '';
          p.reset();
        }
        return;
      }
      if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const beforeSeq = p.typing.errorSeq;
        p.input(k, settings.strictCorrection);
        const st = usePractice.getState();
        const isNewError = st.typing.errorSeq > beforeSeq;

        if (isNewError) {
          // 错音优先级高于普通按键音：这是用户最需要听到的反馈
          void buzz();
        }
        if (settings.keySound) {
          playKeySound(settings.keyVolume, isNewError ? 'error' : 'down');
        }
        return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      p.phase,
      p.typing,
      p.mode,
      p.index,
      settings.keySound,
      settings.keyVolume,
      settings.strictCorrection,
      settings.accent,
      settings.speechRate,
    ],
  );

  const handleNext = () => {
    const s = usePractice.getState();
    if (s.mode !== 'typing' && !isComplete(s.typing) && s.submittedWrong) {
      s.next();
      return;
    }
    s.next();
    focus();
  };

  /**
   * 输入法组字开始：标记状态，后续 keydown 全部忽略。
   * （中文输入法下，用户可能只是想输拼音，不能当成答题）
   */
  const onCompositionStart = () => {
    composingRef.current = true;
  };

  /**
   * 组字结束：把最终提交的字符喂给引擎。
   *
   * 注意两个坑：
   *  1. 要在微任务后再清 composing 标记 —— 部分浏览器会在 compositionend
   *     之后立刻补一个 keydown，此时若标记已清，同一个字符会被录入两次。
   *  2. 一次 commit 可能是多个字符（比如整词上屏），逐字符处理。
   */
  const onCompositionEnd = (e: React.CompositionEvent) => {
    const text = e.data ?? '';
    const s = usePractice.getState();
    if (s.phase === 'running' && text) {
      for (const ch of text) {
        const before = usePractice.getState().wordMistakes;
        s.input(ch, settings.strictCorrection);
        const after = usePractice.getState().wordMistakes;
        if (settings.keySound) {
          playKeySound(settings.keyVolume, after > before ? 'error' : 'down');
        }
      }
    }
    // 延后一拍再解除，避免紧跟其后的 keydown 重复录入
    window.setTimeout(() => {
      composingRef.current = false;
    }, 0);
  };

  if (!cur) return null;

  const typed = p.typing.target.slice(0, p.typing.cursor);
  const reason = p.reasons.get(cur.w.toLowerCase());

  return (
    <div
      ref={inputRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('button')) return;
        focus();
      }}
      className="outline-none"
      role="application"
      aria-label="打字练习区"
    >
      {/* 词卡 */}
      <div className="flex flex-col items-center gap-3 px-4 py-6 sm:py-10">
        {/* 输入法提醒：检测到非英文输入时出现 */}
        <ImeWarning seq={p.imeWarningSeq} />

        {reason && (
          <div className={`text-[11px] font-medium ${REASON_LABEL[reason].cls}`}>
            {REASON_LABEL[reason].text}
          </div>
        )}

        {/*
          流程步骤提示：让用户知道"现在在练第几层"。
          单模式时 planStepLabel 为空，整块不渲染。
        */}
        {p.planStepLabel && p.plan.length > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-medium text-accent">
              {p.planStepLabel}
            </span>
            <span className="text-muted">
              第 {p.planGroupIndex + 1} 组 · 本组 {(p.index % Math.max(1, countGroupSize(p))) + 1}/
              {countGroupSize(p)}
            </span>
          </div>
        )}

        {/* 释义（永远显示） */}
        <div className="max-w-2xl text-center text-sm leading-relaxed text-muted">
          {cur.t || '（无释义）'}
        </div>

        {/* 单词区 */}
        <div className="mt-1 flex min-h-[4.5rem] flex-wrap items-center justify-center gap-x-1">
          {hidden ? (
            <HiddenWord
              cur={cur}
              typed={typed}
              mode={p.mode}
              wrongChar={p.typing.lastWrongChar}
              errorSeq={p.typing.errorSeq}
              hasError={p.typing.lastError}
            />
          ) : (
            <SpelledWord
              target={p.typing.target}
              cursor={p.typing.cursor}
              hasError={p.typing.lastError}
              wrongAt={p.typing.wrongAt}
              wrongChar={p.typing.lastWrongChar}
              errorSeq={p.typing.errorSeq}
            />
          )}
        </div>

        {/* 音标 + 发音 */}
        <div className="flex items-center gap-2 text-xs text-muted">
          {cur.p && <span className="tf-mono opacity-70">{cur.p}</span>}
          {/*
            发音按钮。
            原来只有 14px 的灰色图标，夹在音标与"详情"之间，几乎不会被注意到
            （用户反馈"想加个发音按钮"——其实它一直在，只是看不见）。
            改成带描边和文字的按钮，并区分美音/英音标签。
          */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              speak(cur.w, { accent: settings.accent, rate: settings.speechRate });
            }}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface2 px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            aria-label={`朗读 ${cur.w}`}
            title={`用${settings.accent === 'en-US' ? '美音' : '英音'}朗读（可在设置里切换口音）`}
          >
            <IconVolume width={13} height={13} />
            发音
            <span className="text-[10px] font-normal text-muted">
              {settings.accent === 'en-US' ? '美' : '英'}
            </span>
          </button>
          {/* 详情入口：默写/听写模式下隐藏——那时看详情等于看答案 */}
          {!hidden && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailOpen(true);
              }}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface2 hover:text-accent"
            >
              详情
            </button>
          )}
        </div>

        {/* 默写模式的输入回显 */}
        {hidden && (
          <div className="tf-mono mt-2 flex min-h-[2rem] items-center gap-0.5 text-2xl tracking-[0.15em]">
            {p.typing.target.split('').map((ch, i) => {
              const st = charState(i, p.typing.cursor, p.typing.lastError, p.typing.wrongAt);
              return (
                <span
                  key={i}
                  className={
                    st === 'correct'
                      ? 'text-ink'
                      : st === 'current'
                        ? 'text-muted border-b-2 border-accent tf-caret'
                        : st === 'error' || st === 'wrong'
                          ? 'text-error border-b-2 border-error'
                          : 'border-b-2 border-line text-transparent'
                  }
                >
                  {st === 'correct' ? ch : st === 'pending' ? '_' : ' '}
                </span>
              );
            })}
          </div>
        )}

        {/*
          操作提示。
          原来用 text-[11px] + text-muted，在深色背景上对比度太低，
          几乎看不见（用户反馈"不太明显"）。改为：
          - 提示组用 border 圆角包起来，与上方内容有明确分隔
          - 键帽加亮（bg-surface2 + border）与文字对比（text-ink）
          - 说明文字提亮到 text-muted，字号 12px
        */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-lg border border-line/70 bg-surface2/40 px-3 py-2 text-xs text-muted">
          <Hint keys={['字母']} label="输入" />
          <Hint keys={['Space']} label="下一个" />
          <Hint keys={['Tab']} label="再听一遍" />
          <Hint keys={['⌫']} label="退格" />
          <Hint keys={['Esc']} label="退出" />
        </div>
      </div>

      {/* 底部实时指标 */}
      <div className="flex items-center justify-center gap-6 border-t border-line px-4 py-2.5 text-xs text-muted">
        <span>
          <span className="tf-mono text-sm font-semibold tabular-nums text-ink">
            {p.liveWpm(now)}
          </span>{' '}
          WPM
        </span>
        <span>
          <span className="tf-mono text-sm font-semibold tabular-nums text-ink">
            {Math.floor(p.elapsed(now) / 1000)}s
          </span>
        </span>
        <span>
          <span className="tf-mono text-sm font-semibold tabular-nums text-ink">
            {p.index + 1}/{p.queue.length}
          </span>
        </span>
        <span
          className={
            p.wordMistakes > 0 ? 'flex items-center gap-1 text-error' : 'flex items-center gap-1'
          }
        >
          错<span className="tf-mono text-sm font-semibold tabular-nums">{p.wordMistakes}</span>
          {/* 错字提示：让这个数字不再是唯一反馈 */}
          {p.wordMistakes > 0 && p.typing.lastWrongChar && (
            <span
              key={`foot-${p.typing.errorSeq}`}
              className="tf-wrong-char ml-1 rounded bg-error/15 px-1 py-0.5 text-[10px] font-medium"
            >
              应为 {p.typing.target[p.typing.cursor]}
            </span>
          )}
        </span>
      </div>

      <WordDetail entry={cur} open={detailOpen} onClose={() => setDetailOpen(false)} />
    </div>
  );
}

/** 跟打模式：逐字符显示目标词 */
function SpelledWord({
  target,
  cursor,
  hasError,
  wrongAt,
  wrongChar,
  errorSeq,
}: {
  target: string;
  cursor: number;
  hasError: boolean;
  wrongAt: number[];
  /** 用户刚按错的那个键 */
  wrongChar: string | null;
  /** 每按错一次 +1，作为 key 让动画重放 */
  errorSeq: number;
}) {
  return (
    <span
      // key 变化才会重放抖动动画；同一个错字连按也要震
      key={`shake-${errorSeq}`}
      className={`tf-mono flex flex-wrap items-center justify-center text-4xl font-semibold tracking-wide sm:text-5xl ${
        hasError ? 'tf-shake' : ''
      }`}
    >
      {target.split('').map((ch, i) => {
        const st = charState(i, cursor, hasError, wrongAt);
        return (
          <span key={i} className="relative">
            <span
              className={
                st === 'correct'
                  ? 'text-correct'
                  : st === 'current'
                    ? 'text-muted'
                    : st === 'error'
                      ? 'text-error'
                      : st === 'wrong'
                        ? 'text-error/80'
                        : 'text-muted/45'
              }
            >
              {ch === ' ' ? '\u00a0' : ch}
            </span>
            {/* 打错时，在光标位置上方浮出"你实际按的字母" */}
            {st === 'error' && wrongChar && (
              <span
                key={`wc-${errorSeq}`}
                className="tf-wrong-char pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded bg-error px-1.5 py-0.5 text-sm font-bold leading-none text-white shadow-lg"
                aria-hidden="true"
              >
                {wrongChar === ' ' ? '␣' : wrongChar}
              </span>
            )}
            {st === 'current' && (
              <span className="absolute -bottom-1 left-0 h-[3px] w-full rounded bg-accent tf-caret" />
            )}
            {(st === 'error' || st === 'wrong') && (
              <span className="absolute -bottom-1 left-0 h-[3px] w-full rounded bg-error" />
            )}
          </span>
        );
      })}
    </span>
  );
}

/** 听写/默写模式：不显示单词，只显示已输入的正确前缀长度提示 */
function HiddenWord({
  cur,
  typed,
  mode,
  wrongChar,
  errorSeq,
  hasError,
}: {
  cur: WordEntry;
  typed: string;
  mode: PracticeMode;
  wrongChar: string | null;
  errorSeq: number;
  hasError: boolean;
}) {
  // 听写：只显示字母数提示；默写：显示首字母
  const cells = cur.w.split('');
  const hint = mode === 'recall' ? 0 : -1;
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        key={`hw-${errorSeq}`}
        className={`flex flex-wrap items-center justify-center gap-1.5 ${hasError ? 'tf-shake' : ''}`}
      >
        {cells.map((ch, i) => {
          const done = i < typed.length;
          const revealHint = i === hint && !done && mode === 'recall';
          // 当前待输入格在打错时标红
          const isCurrent = i === typed.length;
          const showError = isCurrent && hasError;
          return (
            <span
              key={i}
              className={`relative flex h-9 w-6 items-end justify-center border-b-2 pb-0.5 text-2xl font-semibold ${
                done
                  ? 'border-correct text-correct'
                  : showError
                    ? 'border-error text-error'
                    : 'border-line text-muted/40'
              }`}
            >
              {done ? ch : revealHint ? ch : ''}
              {/* 打错时浮出实际按的键，让用户知道错在哪 */}
              {showError && wrongChar && (
                <span
                  key={`hwc-${errorSeq}`}
                  className="tf-wrong-char pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded bg-error px-1 py-0.5 text-[10px] font-bold leading-none text-white"
                  aria-hidden="true"
                >
                  {wrongChar === ' ' ? '␣' : wrongChar}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div className="text-[11px] text-muted">
        {mode === 'dictation' ? '听到什么就打出什么' : '根据释义写出单词'}
      </div>
    </div>
  );
}

/** 当前所在组的词数（按 plan 里同组同步骤的项数算） */
function countGroupSize(p: {
  plan: { groupIndex: number; stepIndex: number }[];
  index: number;
}): number {
  const cur = p.plan[p.index];
  if (!cur) return 0;
  return p.plan.filter((x) => x.groupIndex === cur.groupIndex && x.stepIndex === cur.stepIndex)
    .length;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}

/**
 * 一组"键帽 + 说明"的提示。
 * 键帽比说明文字更亮，视线能先扫到按键再读功能。
 */
function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink shadow-sm"
        >
          {k}
        </kbd>
      ))}
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

/**
 * 输入法警告横幅。
 *
 * 只在检测到非英文输入法时出现，几秒后自动消失。
 * 用 seq 作为 key 触发重放：用户连续用中文输入时，每按一次都重新提示一次。
 */
function ImeWarning({ seq }: { seq: number }) {
  const [visible, setVisible] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    if (seq <= lastSeq.current) return;
    lastSeq.current = seq;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 3200);
    return () => window.clearTimeout(t);
  }, [seq]);

  if (!visible || seq === 0) return null;

  return (
    <div
      key={`ime-${seq}`}
      role="alert"
      aria-live="assertive"
      className="tf-warn-in tf-warn-pulse flex items-center gap-2 rounded-lg border border-error/50 bg-error/10 px-3 py-2 text-xs text-error"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-error/20 text-[10px] font-bold">
        !
      </span>
      <span>
        检测到非英文输入法，请按 <Kbd>Shift</Kbd> 或 <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd> 切换到英文
      </span>
    </div>
  );
}

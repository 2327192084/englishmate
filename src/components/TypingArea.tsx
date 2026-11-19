/**
 * 打字练习区 —— 全应用最核心的组件。
 *
 * 交互契约（和 Qwerty Learner / Type Words 保持一致，用户不用重新学）：
 *   字母键 → 校验一个字符，错了原地不退格
 *   Space  → 提交并进入下一个词
 *   Backspace → 退一格（错误计数不回退）
 *   Tab    → 跳过当前词（记为答错）
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

const REASON_LABEL: Record<string, { text: string; cls: string }> = {
  review: { text: '复习', cls: 'text-accent' },
  wrong: { text: '错词', cls: 'text-error' },
  new: { text: '新词', cls: 'text-correct' },
  random: { text: '加练', cls: 'text-muted' },
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
  }, [focus, p.index]);

  /** 每 200ms 刷新一次计时/WPM 显示（不重渲染整棵树的关键是用局部 state） */
  useEffect(() => {
    if (p.phase !== 'running') return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
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

      if (k === ' ' || k === 'Enter') {
        e.preventDefault();
        // 空格键在单词中间不常见，直接当"下一个"
        if (isComplete(p.typing) || p.mode === 'typing') {
          handleNext();
        } else {
          p.submit();
        }
        return;
      }
      if (k === 'Backspace') {
        e.preventDefault();
        p.backspace();
        if (settings.keySound) playKeySound(settings.keyVolume, 'up');
        return;
      }
      if (k === 'Tab') {
        e.preventDefault();
        handleSkip();
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

  const handleSkip = () => {
    const s = usePractice.getState();
    // 标记为错：直接进下一个，next() 会按 isComplete 判定为 incorrect
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
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              speak(cur.w, { accent: settings.accent, rate: settings.speechRate });
            }}
            className="rounded-md p-1 text-muted hover:bg-surface2 hover:text-accent"
            aria-label="朗读"
          >
            <IconVolume width={14} height={14} />
          </button>
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

        {/* 操作提示 */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <Kbd>字母</Kbd> 输入
          <Kbd>Space</Kbd> 下一个
          <Kbd>Tab</Kbd> 跳过
          <Kbd>⌫</Kbd> 退格
          <Kbd>Esc</Kbd> 退出
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

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
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

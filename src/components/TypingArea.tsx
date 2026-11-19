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
import { playKeySound } from '@/lib/sound';
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
        const before = p.wordMistakes;
        p.input(k, settings.strictCorrection);
        const after = usePractice.getState().wordMistakes;
        if (settings.keySound) {
          playKeySound(settings.keyVolume, after > before ? 'error' : 'down');
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
            <HiddenWord cur={cur} typed={typed} mode={p.mode} />
          ) : (
            <SpelledWord
              target={p.typing.target}
              cursor={p.typing.cursor}
              hasError={p.typing.lastError}
              wrongAt={p.typing.wrongAt}
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
        <span className={p.wordMistakes > 0 ? 'text-error' : ''}>
          错 <span className="tf-mono text-sm font-semibold tabular-nums">{p.wordMistakes}</span>
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
}: {
  target: string;
  cursor: number;
  hasError: boolean;
  wrongAt: number[];
}) {
  return (
    <span className="tf-mono flex flex-wrap items-center justify-center text-4xl font-semibold tracking-wide sm:text-5xl">
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
function HiddenWord({ cur, typed, mode }: { cur: WordEntry; typed: string; mode: PracticeMode }) {
  // 听写：只显示字母数提示；默写：显示首字母
  const cells = cur.w.split('');
  const hint = mode === 'recall' ? 0 : -1;
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {cells.map((ch, i) => {
          const done = i < typed.length;
          const revealHint = i === hint && !done && mode === 'recall';
          return (
            <span
              key={i}
              className={`flex h-9 w-6 items-end justify-center border-b-2 pb-0.5 text-2xl font-semibold ${
                done ? 'border-correct text-correct' : 'border-line text-muted/40'
              }`}
            >
              {done ? ch : revealHint ? ch : ''}
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

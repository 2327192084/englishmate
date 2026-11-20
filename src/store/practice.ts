/**
 * 练习会话 store —— 打字练习的全部运行时状态。
 *
 * 为什么用 store 而不是组件内 useState：
 * 打字练习要跨组件共享（大字号输入区、实时指标条、侧边词表），
 * 并且每次按键都会更新，useState 提升到页面级会引发整页重渲染。
 */
import { create } from 'zustand';
import type { PracticeMode, WordEntry, WordAttempt } from '@/types';
import {
  initTyping,
  typeChar,
  typeBackspace,
  isComplete,
  noUnfixedErrors,
  type TypingState,
  normalizeChar,
  isNonLatinChar,
} from '@/lib/typing';
import { computeWpm } from '@/lib/stats';
import type { PlannedItem } from '@/lib/flow';
import {
  createTimer,
  startTimer,
  markActivity,
  tickTimer,
  elapsed as timerElapsed,
  type TimerState,
} from '@/lib/timer';

export interface AttemptLog extends WordAttempt {
  entry: WordEntry;
}

interface PracticeState {
  /** 当前轮次状态 */
  phase: 'idle' | 'running' | 'finished';
  mode: PracticeMode;
  bankId: string;
  queue: WordEntry[];
  reasons: Map<string, 'review' | 'wrong' | 'new' | 'random' | 'favorite'>;
  index: number;
  typing: TypingState;
  /** 当前词的错误数（每次进入新词归零） */
  wordMistakes: number;
  /** 当前词的开始时间 */
  wordStartedAt: number;
  /** 本轮起点时间 */
  roundStartedAt: number;
  /**
   * 练习计时器（活跃时长）。
   * 用累计活跃毫秒而不是 Date.now() 差值，避免休眠/挂机把 WPM 稀释掉。
   */
  timer: TimerState;
  attempts: AttemptLog[];
  /** 每个词的作答中是否"已判错"（默写/听写模式下按 Tab/回车提交） */
  submittedWrong: boolean;
  /** 辨认模式的选项 */
  choices: { label: string; correct: boolean }[];
  /** 辨认模式是否已选 */
  choicePicked: number | null;
  /**
   * 输入法警告的递增序号。
   * 每检测到一次非英文输入就 +1，组件据此重放提示动画——
   * 用计数器而不是布尔值，是因为布尔值在连续触发时不会变化，动画不会重放。
   */
  imeWarningSeq: number;
  /**
   * 流程链（跟打→默写→听写）。为空表示单模式，行为与传统练习一致。
   * 展开后每个元素 = "这个词，用这个模式练一次"。
   */
  plan: PlannedItem[];
  /** 当前处于流程的第几组 / 第几步，用于 UI 显示"默写 3/7" */
  planGroupIndex: number;
  planStepLabel: string;

  start: (params: {
    mode: PracticeMode;
    bankId: string;
    queue: WordEntry[];
    reasons: Map<string, 'review' | 'wrong' | 'new' | 'random' | 'favorite'>;
    /** 可选：流程链展开结果；不传即单模式 */
    plan?: PlannedItem[];
  }) => void;
  input: (ch: string, strict?: boolean) => void;
  backspace: () => void;
  /** 默写/听写模式：直接提交当前输入（允许不完整） */
  submit: () => void;
  /** 进入下一个词；返回 true 表示整轮结束 */
  next: () => boolean;
  pickChoice: (i: number) => void;
  /** 辨认模式的判定结果；非辨认模式或未选择时返回 null */
  choiceOutcome: () => { correct: boolean; mistakes: number } | null;
  buildChoices: (fn: (entry: WordEntry) => { label: string; correct: boolean }[]) => void;
  reset: () => void;
  /** 当前词 */
  current: () => WordEntry | undefined;
  /** 实时 WPM */
  liveWpm: (now?: number) => number;
  elapsed: (now?: number) => number;
  /** 每秒调用，推进活跃计时 */
  tick: (now?: number) => void;
}

const emptyTyping = initTyping('');

export const usePractice = create<PracticeState>((set, get) => ({
  phase: 'idle',
  mode: 'typing',
  bankId: '',
  queue: [],
  reasons: new Map(),
  index: 0,
  typing: emptyTyping,
  wordMistakes: 0,
  wordStartedAt: 0,
  roundStartedAt: 0,
  timer: createTimer(),
  attempts: [],
  submittedWrong: false,
  choices: [],
  choicePicked: null,
  imeWarningSeq: 0,
  plan: [],
  planGroupIndex: 0,
  planStepLabel: '',

  start: ({ mode, bankId, queue, reasons, plan }) => {
    const first = queue[0];
    const now = Date.now();
    set({
      phase: queue.length ? 'running' : 'finished',
      mode,
      plan: plan ?? [],
      planGroupIndex: plan?.[0]?.groupIndex ?? 0,
      planStepLabel: plan?.[0]?.stepLabel ?? '',
      bankId,
      queue,
      reasons,
      index: 0,
      typing: initTyping(first?.w ?? ''),
      wordMistakes: 0,
      wordStartedAt: now,
      roundStartedAt: now,
      timer: startTimer(createTimer(now), now),
      attempts: [],
      submittedWrong: false,
      choices: [],
      choicePicked: null,
    });
  },

  input: (ch, strict = true) => {
    const { phase, typing, wordMistakes } = get();
    if (phase !== 'running') return;

    /**
     * 非英文输入法检测。
     *
     * 组字期间的按键已经被组件层过滤掉了，这里收到的是"上屏的最终字符"。
     * 如果它还是中/日/韩文字符，说明用户没切成英文输入法——
     * 这时不该记一个错字（那是输入法问题，不是他拼错了），
     * 而是要提示他切换输入法。
     */
    if (isNonLatinChar(ch)) {
      set({ imeWarningSeq: get().imeWarningSeq + 1 });
      return;
    }

    const nowTs = Date.now();
    // 每次按键都算"活动"，用于空闲检测与计时恢复
    const revived = markActivity(get().timer, nowTs);

    const clean = normalizeChar(ch);
    const next = typeChar(typing, clean, nowTs, strict);
    if (next === typing) return;
    set({
      typing: next,
      timer: revived,
      wordMistakes: next.errors > typing.errors ? wordMistakes + 1 : wordMistakes,
    });
  },

  backspace: () => {
    const { phase, typing } = get();
    if (phase !== 'running') return;
    const next = typeBackspace(typing);
    if (next !== typing) set({ typing: next });
  },

  submit: () => {
    const { phase, typing } = get();
    if (phase !== 'running') return;
    // 默写模式：允许提前提交（此时光标未到末尾，视为答错）
    if (!isComplete(typing)) {
      set({ submittedWrong: true });
    }
  },

  next: () => {
    const state = get();
    const cur = state.queue[state.index];
    if (!cur) return true;

    const now = Date.now();
    /**
     * 判定口径分模式：
     *   辨认模式没有字符输入，`typing.cursor` 永远是 0，若沿用 isComplete 会
     *   把每个词都判成错——所以单独读 choice 的选择结果。
     *   其余模式看是否打完全部字符且没有提前提交错误。
     */
    const choice = get().choiceOutcome();
    const correct =
      state.mode === 'choice'
        ? (choice?.correct ?? false)
        : isComplete(state.typing) && !state.submittedWrong && noUnfixedErrors(state.typing);
    const mistakes = state.mode === 'choice' ? (choice?.mistakes ?? 1) : state.wordMistakes;

    const log: AttemptLog = {
      entry: cur,
      word: cur.w,
      correct,
      mistakes,
      ms: Math.max(1, now - state.wordStartedAt),
      bankId: state.bankId,
    };

    const attempts = [...state.attempts, log];
    const nextIndex = state.index + 1;
    const done = nextIndex >= state.queue.length;

    if (done) {
      set({
        attempts,
        phase: 'finished',
        index: nextIndex,
        typing: initTyping(''),
        submittedWrong: false,
        wordMistakes: 0,
        choices: [],
        choicePicked: null,
      });
      return true;
    }

    const nextPlanItem = state.plan[nextIndex];
    set({
      attempts,
      index: nextIndex,
      // 流程链会切换模式（跟打→默写→听写），索引推进时必须同步
      mode: nextPlanItem ? nextPlanItem.mode : state.mode,
      planGroupIndex: nextPlanItem ? nextPlanItem.groupIndex : state.planGroupIndex,
      planStepLabel: nextPlanItem ? nextPlanItem.stepLabel : state.planStepLabel,
      typing: initTyping(state.queue[nextIndex].w),
      wordMistakes: 0,
      wordStartedAt: now,
      submittedWrong: false,
      choices: [],
      choicePicked: null,
    });
    return false;
  },

  pickChoice: (i) => {
    const { phase, choicePicked } = get();
    if (phase !== 'running' || choicePicked !== null) return;
    set({ choicePicked: i });
  },

  choiceOutcome: () => {
    const s = get();
    if (s.mode !== 'choice' || s.choicePicked === null) return null;
    const chosen = s.choices[s.choicePicked];
    if (!chosen) return null;
    // 答错记 1 次错误，让它能进错词本；答对记 0
    return { correct: chosen.correct, mistakes: chosen.correct ? 0 : 1 };
  },

  buildChoices: (fn) => {
    const cur = get().current();
    if (!cur) return;
    set({ choices: fn(cur) });
  },

  reset: () =>
    set({
      phase: 'idle',
      queue: [],
      index: 0,
      typing: emptyTyping,
      attempts: [],
      wordMistakes: 0,
      submittedWrong: false,
      choices: [],
      choicePicked: null,
      imeWarningSeq: 0,
    }),

  current: () => get().queue[get().index],

  liveWpm: () => {
    const s = get();
    if (s.attempts.length === 0 && s.typing.cursor === 0) return 0;
    // 只统计真正在练习的时长
    const ms = timerElapsed(s.timer);
    if (ms < 500) return 0;
    const doneChars = s.attempts.reduce((acc, a) => acc + a.word.length, 0);
    const chars = doneChars + s.typing.cursor;
    return computeWpm(chars, ms);
  },

  elapsed: () => timerElapsed(get().timer),

  tick: (now = Date.now()) => {
    const s = get();
    if (s.phase !== 'running') return;
    const next = tickTimer(s.timer, now);
    if (next !== s.timer) set({ timer: next });
  },
}));

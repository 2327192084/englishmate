/**
 * 打字引擎 —— 纯逻辑，零 DOM 依赖，便于单测。
 *
 * 三种模式共用一条输入管线：
 *   跟打 typing   ：目标串 = 单词本身
 *   听写 dictation：目标串 = 单词本身，但不显示单词
 *   默写 recall   ：目标串 = 单词本身，不显示单词、只显示释义
 * 差别只在「显示什么」，校验逻辑完全一致，所以这里只做校验。
 */

export interface TypingState {
  /** 目标串 */
  target: string;
  /** 已确认正确的字符数（即光标位置） */
  cursor: number;
  /** 累计错误按键 */
  errors: number;
  /** 全部击键数（含错误） */
  keystrokes: number;
  /** 首个击键的时间戳，null 表示还没开始 */
  startedAt: number | null;
  /** 完成时间戳，null 表示未完成 */
  finishedAt: number | null;
  /** 刚刚按错时高亮一下错误字符 */
  lastError: boolean;
  /** 非严格模式下，曾打错过的字符位置（退格改对后会被移除） */
  wrongAt: number[];
}

export function initTyping(target: string): TypingState {
  return {
    target,
    cursor: 0,
    errors: 0,
    keystrokes: 0,
    startedAt: null,
    finishedAt: null,
    lastError: false,
    wrongAt: [],
  };
}

export function isComplete(s: TypingState): boolean {
  return s.cursor >= s.target.length && s.target.length > 0;
}

/**
 * 处理一个字符输入。
 * @param strict true（默认）：打错不前进，必须退格改对才能继续 —— 防止错误肌肉记忆
 *               false：打错仍占位前进，但把该位置记为错，词末按"有错"结算。
 *                      适合追求连贯手感、不想被一个错字打断节奏的用户。
 *
 * 注意：strict 模式下光标不因错误前进 —— 这是"防止错误肌肉记忆"的核心，
 * 与 Qwerty Learner 一致。
 */
export function typeChar(s: TypingState, ch: string, now: number, strict = true): TypingState {
  if (s.finishedAt !== null) return s;
  // 没有目标串（空词条）时任何输入都不该计为错误，否则会污染统计
  if (s.target.length === 0) return s;
  if (isComplete(s)) return s;
  if (ch.length !== 1) return s;

  const expected = s.target[s.cursor];
  const keystrokes = s.keystrokes + 1;
  const startedAt = s.startedAt ?? now;
  const isRight = ch === expected;

  if (isRight) {
    const cursor = s.cursor + 1;
    return {
      ...s,
      cursor,
      keystrokes,
      startedAt,
      lastError: false,
      finishedAt: cursor >= s.target.length ? now : null,
    };
  }

  // 打错：非严格模式下占位前进并记录出错位置
  if (!strict) {
    const cursor = s.cursor + 1;
    return {
      ...s,
      cursor,
      keystrokes,
      errors: s.errors + 1,
      startedAt,
      lastError: true,
      wrongAt: [...s.wrongAt, s.cursor],
      finishedAt: cursor >= s.target.length ? now : null,
    };
  }

  return {
    ...s,
    keystrokes,
    errors: s.errors + 1,
    startedAt,
    lastError: true,
  };
}

/** 退格：允许改掉已确认的正确字符，但错误计数不回退（错误已经发生了） */
export function typeBackspace(s: TypingState): TypedResult {
  if (s.cursor === 0) return s;
  /**
   * 已经打完整但还留着没修正的错字时，允许退回去改正。
   * 否则非严格模式下错误一旦打满就没有任何补救机会，等于该模式失去意义。
   * 退回时重新打开当前词（清掉 finishedAt），提交判定才会按修正后重新算。
   */
  const canReopen = s.finishedAt !== null && s.wrongAt.length > 0;
  if (s.finishedAt !== null && !canReopen) return s;

  const wrongAt = s.wrongAt.filter((i) => i !== s.cursor - 1);
  return {
    ...s,
    cursor: s.cursor - 1,
    lastError: false,
    wrongAt,
    finishedAt: canReopen ? null : s.finishedAt,
  };
}

type TypedResult = TypingState;

/**
 * 比较大小写不敏感（单词练习里大写只出现在专有名词，不该因此判错），
 * 但保留原始目标串用于渲染。
 */
export function normalizeChar(ch: string): string {
  return ch.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-');
}

/** 已用毫秒，未开始返回 0 */
export function elapsedMs(s: TypingState, now: number): number {
  if (s.startedAt === null) return 0;
  return (s.finishedAt ?? now) - s.startedAt;
}

/** 本次是否有过错误 */
export function hadMistake(s: TypingState): boolean {
  return s.errors > 0;
}

/** 某个位置是否被标记为打错（非严格模式） */
export function isWrongAt(s: TypingState, i: number): boolean {
  return s.wrongAt.includes(i);
}

/**
 * 最终判定：是否"所有位置都正确"。
 *
 * 严格模式下错误不会留痕（wrongAt 恒为空），有错误也一定能改对才能打满，
 * 所以只要打满就算全对。非严格模式下错误字符会占位，必须确认没有遗留的
 * 未修正错字，否则整词判错。
 */
export function noUnfixedErrors(s: TypingState): boolean {
  return s.wrongAt.length === 0;
}

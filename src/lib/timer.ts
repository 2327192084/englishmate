/**
 * 练习计时器 —— 纯逻辑，零 DOM 依赖。
 *
 * ── 为什么不用 Date.now() 差值 ─────────────────────────────────────────────
 * 最直觉的做法是 `结束时间 - 开始时间`，但它有个致命问题：
 * 用户合上笔记本、或者切去买咖啡，这段真实时间会被全部算进练习时长，
 * 于是 WPM 被稀释到接近 0，正确率统计也随之失真。
 *
 * 这里的做法是**累计活跃时长**：
 *  - 每 1 秒 tick 一次，正常情况 +1000ms
 *  - 单次 tick 的真实间隔超过阈值（比如系统休眠后一口气跳了 2 小时），
 *    只计入一个上限值，不把休眠时间算作练习
 *  - 空闲超过 IDLE_MS 无操作，自动暂停，恢复时从暂停点继续
 *
 * 这样得到的是「真实动过键盘的时间」，WPM 才有意义。
 */

/** 空闲多久算挂机（毫秒） */
export const IDLE_MS = 3 * 60 * 1000;

/**
 * 单次 tick 允许计入的最大时长。
 *
 * 定时器每秒触发一次，正常间隔在 1000ms 左右；浏览器标签被节流、
 * 或系统休眠唤醒后，会出现一次巨大的跳变。任何超过这个值的间隔
 * 都视为"这段时间用户没在练习"，按上限截断。
 */
export const MAX_TICK_MS = 2500;

/** 暂停原因 */
export type PauseReason = 'idle' | 'hidden' | 'manual' | null;

export interface TimerState {
  /** 累计活跃时长（毫秒）—— WPM 的唯一依据 */
  activeMs: number;
  /** 最近一次活动（按键）的时间戳 */
  lastActivityAt: number;
  /** 是否暂停 */
  paused: boolean;
  /** 暂停原因 */
  pauseReason: PauseReason;
  /** 暂停开始的时刻，用于恢复时补算 */
  pausedAt: number | null;
  /** 最后一次 tick 的时刻，用于计算真实间隔 */
  lastTickAt: number;
}

export function createTimer(now = Date.now()): TimerState {
  return {
    activeMs: 0,
    lastActivityAt: now,
    paused: true,
    pauseReason: null,
    pausedAt: null,
    lastTickAt: now,
  };
}

/** 开始 / 恢复计时 */
export function startTimer(s: TimerState, now = Date.now()): TimerState {
  return {
    ...s,
    paused: false,
    pauseReason: null,
    pausedAt: null,
    lastActivityAt: now,
    lastTickAt: now,
  };
}

/**
 * 记一次活动（每次按键调用）。
 * 如果当前是"因空闲暂停"，活动本身就该恢复计时——用户回来了。
 */
export function markActivity(s: TimerState, now = Date.now()): TimerState {
  const revived = s.paused && s.pauseReason === 'idle' ? startTimer(s, now) : s;
  return { ...revived, lastActivityAt: now };
}

/** 暂停，并记录到 activeMs 里已经积累的部分不受影响 */
export function pauseTimer(s: TimerState, reason: PauseReason, now = Date.now()): TimerState {
  if (s.paused) return s;
  return { ...s, paused: true, pauseReason: reason, pausedAt: now };
}

/**
 * 每秒调用一次。
 *
 * 返回新的计时状态。三条规则：
 *  1. 暂停中：不计时，但要把 lastTickAt 推进，避免恢复时把暂停期间算进去
 *  2. 空闲超时：自动暂停
 *  3. 正常：按**真实间隔**累加，但单个间隔不超过 MAX_TICK_MS
 */
export function tickTimer(s: TimerState, now = Date.now()): TimerState {
  const rawDelta = now - s.lastTickAt;

  // 已暂停：只推进基准时间点，不累加
  if (s.paused) {
    return { ...s, lastTickAt: now };
  }

  /**
   * 分两种情况：
   *
   *  a) rawDelta 在正常范围内（一次 tick 的正常间隔，允许标签页轻微节流）：
   *     如实计入。这是绝大多数情况。
   *
   *  b) rawDelta 远超上限（系统休眠、标签页被冻结、进程被挂起）：
   *     这段时间用户有没有在练，我们**无从得知**，因此一律不计。
   *     补记一个"上限值"是凭空造数据——2 小时休眠补 2.5 秒毫无依据，
   *     不如诚实记 0，让 WPM 只反映真正观测到的活跃时间。
   */
  const delta = rawDelta > 0 && rawDelta <= MAX_TICK_MS ? rawDelta : 0;
  const activeMs = s.activeMs + delta;

  // 空闲超时 → 自动暂停（上面那一格是否计入已在 delta 里决定）
  const idleFor = now - s.lastActivityAt;
  if (idleFor >= IDLE_MS) {
    return { ...s, activeMs, paused: true, pauseReason: 'idle', pausedAt: now, lastTickAt: now };
  }

  return { ...s, activeMs, lastTickAt: now };
}

/** 当前累计活跃毫秒数 */
export function elapsed(s: TimerState): number {
  return Math.max(0, s.activeMs);
}

/** 是否处于因空闲而暂停的状态（UI 用它显示"已暂停"） */
export function isIdlePaused(s: TimerState): boolean {
  return s.paused && s.pauseReason === 'idle';
}

/**
 * 把活跃区间按本地日期切分，便于"今日学习时长"这类统计跨天不出错。
 *
 * 一次练习可能横跨午夜（比如 23:58 练到 00:05），
 * 如果整段都记到某一天，另一天的统计就会为 0。
 */
export function splitByDay(start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let cursor = start;
  // 防御：非法区间直接返回空
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;

  while (cursor < end) {
    const d = new Date(cursor);
    d.setHours(24, 0, 0, 0);
    const partEnd = Math.min(end, d.getTime());
    out.push([cursor, partEnd]);
    cursor = partEnd;
    // 理论上不会发生，但避免任何情况下的死循环
    if (out.length > 400) break;
  }
  return out;
}

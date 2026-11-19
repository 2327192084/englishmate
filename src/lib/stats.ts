/**
 * 统计聚合 —— 纯函数，只依赖类型契约与 FSRS 的到期判定，可在 node 环境单测。
 *
 * 口径约定
 * --------
 * - 日期一律走**本地时区**（`YYYY-MM-DD`），以设备本地日历为准。
 * - WPM 用「正确字符数 / 5 / 分钟」的行业惯例（1 词 ≈ 5 字符），向下取整。
 * - 正确率分母为 0 时视为 100%（没有按键就没有错误），避免新用户看到 0%。
 * - `aggregateDaily` 只输出**有练习记录**的日期，不补空档（补空档是图表的活）。
 */
import type { DailyStat, OverviewStats, PracticeSession, UserWord } from '@/types';
import { isDue } from './fsrs';

const DAY_MS = 86_400_000;
/** 连续天数计算的硬上限（100 年），只为防御脏数据死循环 */
const MAX_STREAK_DAYS = 36_500;

/** 补零到两位 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 毫秒时间戳 → 本地时区 `YYYY-MM-DD` */
export function localDateKey(ts: number): string {
  const d = new Date(Number.isFinite(ts) ? ts : Date.now());
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `YYYY-MM-DD` → 本地零点时间戳；非法或溢出的日期返回 NaN */
function parseDateKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  // 防御 2024-02-31 这类越界输入被 Date 静默进位
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return NaN;
  return d.getTime();
}

/** 日期键按日历日加减（跨月/跨年安全） */
function shiftDateKey(key: string, days: number): string {
  const ts = parseDateKey(key);
  if (!Number.isFinite(ts)) return key;
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return localDateKey(d.getTime());
}

/**
 * 每分钟词数：正确字符 / 5 / 分钟，向下取整。
 * `ms <= 0` 返回 0（没耗时就没有速度可言）。
 */
export function computeWpm(correctKeystrokes: number, ms: number): number {
  if (!Number.isFinite(correctKeystrokes) || !Number.isFinite(ms)) return 0;
  if (correctKeystrokes <= 0 || ms <= 0) return 0;
  const minutes = ms / 60_000;
  if (!(minutes > 0)) return 0;
  return Math.floor(correctKeystrokes / 5 / minutes);
}

/** 正确率 0..1；分母为 0（或输入非法）返回 1 */
export function computeAccuracy(correctKeystrokes: number, totalKeystrokes: number): number {
  if (!Number.isFinite(correctKeystrokes) || !Number.isFinite(totalKeystrokes)) return 1;
  if (totalKeystrokes <= 0) return 1;
  const correct = Math.max(0, Math.min(correctKeystrokes, totalKeystrokes));
  return correct / totalKeystrokes;
}

/** 单个会话贡献的分钟数：优先 durationSec，旧数据缺字段时用起止时间兜底 */
function sessionMinutes(s: PracticeSession): number {
  if (Number.isFinite(s.durationSec) && s.durationSec > 0) return s.durationSec / 60;
  if (Number.isFinite(s.startedAt) && Number.isFinite(s.endedAt)) {
    return Math.max(0, s.endedAt - s.startedAt) / 60_000;
  }
  return 0;
}

/** 保留一位小数，避免浮点噪声 */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 聚合过程中的累加器：对外字段 + 算加权用的内部量 */
interface DailyBucket extends DailyStat {
  /** 当日答对词数（算词级正确率用） */
  correctWords: number;
  /** 当日正确击键数（无词数时算击键级正确率用） */
  correctKeys: number;
}

/**
 * 按本地日期聚合会话：同一天的多个 session 合并成一条，结果按日期升序。
 * 缺的日期不补（前端图表自己决定是否补零）。
 */
export function aggregateDaily(sessions: PracticeSession[]): DailyStat[] {
  const buckets = new Map<string, DailyBucket>();

  for (const s of sessions) {
    if (!s) continue;
    // 以会话开始时间归档：跨零点的长会话算在开始那天，符合"今天练了多久"的直觉
    const stamp = Number.isFinite(s.startedAt) ? s.startedAt : s.endedAt;
    if (!Number.isFinite(stamp)) continue;
    const date = localDateKey(stamp);

    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = {
        date,
        sessions: 0,
        words: 0,
        keystrokes: 0,
        bestWpm: 0,
        accuracy: 1,
        minutes: 0,
        correctWords: 0,
        correctKeys: 0,
      };
      buckets.set(date, bucket);
    }

    const total = Number.isFinite(s.total) ? Math.max(0, s.total) : 0;
    const correct = Number.isFinite(s.correct) ? Math.max(0, Math.min(s.correct, total)) : 0;
    const keystrokes = Number.isFinite(s.keystrokes) ? Math.max(0, s.keystrokes) : 0;
    const correctKeys = Number.isFinite(s.correctKeystrokes)
      ? Math.max(0, Math.min(s.correctKeystrokes, keystrokes))
      : 0;
    const wpm = Number.isFinite(s.wpm) ? Math.max(0, s.wpm) : 0;

    bucket.sessions += 1;
    bucket.words += total;
    bucket.keystrokes += keystrokes;
    bucket.bestWpm = Math.max(bucket.bestWpm, wpm);
    bucket.minutes += sessionMinutes(s);
    bucket.correctWords += correct;
    bucket.correctKeys += correctKeys;
  }

  const out: DailyStat[] = [];
  for (const bucket of buckets.values()) {
    // 当日正确率：优先按词数加权；没有词数时退回击键口径；都没有则为 1（无错可犯）
    let accuracy = 1;
    if (bucket.words > 0) {
      accuracy = bucket.correctWords / bucket.words;
    } else if (bucket.keystrokes > 0) {
      accuracy = computeAccuracy(bucket.correctKeys, bucket.keystrokes);
    }

    out.push({
      date: bucket.date,
      sessions: bucket.sessions,
      words: bucket.words,
      keystrokes: bucket.keystrokes,
      // 当日最佳速度取整；当天无速度数据时保持 0，避免图表出现假峰值
      bestWpm: Math.floor(bucket.bestWpm),
      accuracy,
      minutes: round1(bucket.minutes),
    });
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/** 某天是否算"练过" */
function isActiveDay(d: DailyStat): boolean {
  return d.sessions > 0 || d.words > 0 || d.keystrokes > 0 || d.minutes > 0;
}

/** 把 DailyStat 列表收敛成「有活动的日期」集合 */
function activeDateSet(daily: DailyStat[]): Set<string> {
  const active = new Set<string>();
  for (const d of daily) {
    if (d && typeof d.date === 'string' && isActiveDay(d)) active.add(d.date);
  }
  return active;
}

/**
 * 当前连续天数。
 * 今天练了就从今天往前数；今天还没练但昨天练了，从昨天往前数
 * （不因今天尚未开始而断签）；一旦遇到空档立即停止。
 */
export function computeStreak(daily: DailyStat[], today?: string): number {
  if (!daily.length) return 0;
  const todayKey =
    today && /^\d{4}-\d{2}-\d{2}$/.test(today) && Number.isFinite(parseDateKey(today))
      ? today
      : localDateKey(Date.now());

  const active = activeDateSet(daily);
  if (!active.size) return 0;

  let cursor: string;
  if (active.has(todayKey)) {
    cursor = todayKey;
  } else {
    const yesterday = shiftDateKey(todayKey, -1);
    if (!active.has(yesterday)) return 0;
    cursor = yesterday;
  }

  let streak = 0;
  for (let i = 0; i < MAX_STREAK_DAYS; i++) {
    if (!active.has(cursor)) break;
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

/** 历史最长连续天数（不要求延续到今天） */
export function computeLongestStreak(daily: DailyStat[]): number {
  if (!daily.length) return 0;
  const dates = Array.from(activeDateSet(daily)).sort();
  if (!dates.length) return 0;

  let longest = 1;
  let current = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = parseDateKey(dates[i - 1]);
    const cur = parseDateKey(dates[i]);
    const consecutive = Number.isFinite(prev) && Number.isFinite(cur) && cur - prev === DAY_MS;
    if (consecutive) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

/**
 * 全局概览。
 *
 * @param sessions      全部练习会话
 * @param words         全部学习过的词（含 FSRS 卡）
 * @param todayNew      今日已学新词（由调用方按 session 口径统计后传入）
 * @param todayReviewed 今日已复习数（由调用方统计后传入）
 * @param now           判定到期的时间基准，默认当前时间
 */
export function summarize(
  sessions: PracticeSession[],
  words: UserWord[],
  todayNew: number,
  todayReviewed: number,
  now?: number,
): OverviewStats {
  const timestamp = Number.isFinite(now) ? (now as number) : Date.now();
  const daily = aggregateDaily(sessions);

  let totalWords = 0;
  let totalKeystrokes = 0;
  let bestWpm = 0;
  let correctWords = 0;
  let wpmWeightedSum = 0;
  let wpmWeight = 0;

  for (const s of sessions) {
    if (!s) continue;
    const total = Number.isFinite(s.total) ? Math.max(0, s.total) : 0;
    totalWords += total;
    correctWords += Number.isFinite(s.correct) ? Math.max(0, Math.min(s.correct, total)) : 0;
    totalKeystrokes += Number.isFinite(s.keystrokes) ? Math.max(0, s.keystrokes) : 0;

    const wpm = Number.isFinite(s.wpm) ? Math.max(0, s.wpm) : 0;
    if (wpm > bestWpm) bestWpm = wpm;
    // 平均速度按练习时长加权，短会话不该和长会话同权
    const minutes = sessionMinutes(s);
    if (minutes > 0 && wpm > 0) {
      wpmWeightedSum += wpm * minutes;
      wpmWeight += minutes;
    }
  }

  const avgWpm = wpmWeight > 0 ? Math.floor(wpmWeightedSum / wpmWeight) : 0;
  // 总正确率按词数加权；总词数为 0 时按击键口径兜底
  const accuracy = totalWords > 0 ? correctWords / totalWords : computeAccuracy(0, 0);

  let masteredCount = 0;
  let wrongCount = 0;
  let favoriteCount = 0;
  let dueCount = 0;
  for (const w of words) {
    if (!w) continue;
    if (w.favorite) favoriteCount += 1;
    if (w.mastered) {
      // 手动标记已掌握的词退出错词本，也不再计入待复习
      masteredCount += 1;
      continue;
    }
    if (w.mistakes > 0) wrongCount += 1;
    if (w.card && isDue(w.card, timestamp)) dueCount += 1;
  }

  return {
    totalSessions: sessions.length,
    totalWords,
    totalKeystrokes,
    bestWpm: Math.floor(bestWpm),
    avgWpm,
    accuracy,
    streak: computeStreak(daily),
    longestStreak: computeLongestStreak(daily),
    masteredCount,
    wrongCount,
    favoriteCount,
    dueCount,
    todayNew: Number.isFinite(todayNew) ? Math.max(0, Math.floor(todayNew)) : 0,
    todayReviewed: Number.isFinite(todayReviewed) ? Math.max(0, Math.floor(todayReviewed)) : 0,
  };
}

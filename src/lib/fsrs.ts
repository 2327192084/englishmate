/**
 * FSRS 间隔重复引擎（FSRS-4.5 简化版）
 *
 * 参数来源
 * --------
 * 权重数组 `W` 取自 FSRS 官方默认参数集（21 个权重，对应 FSRS-6 的
 * `DEFAULT_PARAMETERS`，Anki / fsrs-rs 的出厂默认值，未针对本应用调参）：
 *   https://github.com/open-spaced-repetition/fsrs-rs  (src/parameters.rs)
 *   https://github.com/open-spaced-repetition/fsrs4anki
 *
 * 曲线与公式采用 FSRS-4.5 的经典形式（这也是「4.5 简化版」的含义）：
 *   遗忘曲线  R(t, S) = (1 + FACTOR * t / S) ^ DECAY
 *   其中 DECAY = -0.5、FACTOR = 19/81，使得 R(S, S) = 0.9。
 *   权重下标 0..19 与 4.5 的公式一一对应；下标 20 是 FSRS-6 新增的
 *   曲线衰减参数，本简化版固定曲线不读取它，仅为与官方 21 权重的
 *   参数集保持形状一致（将来切换到 FSRS-6 曲线时直接启用）。
 *
 * 设计约束（与 task-1 验收口径一致）
 * --------------------------------
 * - 纯函数、零 UI / 零 React / 零 DOM 依赖，node 环境可直接单测。
 * - 所有 `due` / `lastReview` 都是**毫秒时间戳**；`scheduledDays` 是天（可为小数）。
 * - 无论输入多脏，输出的 `stability` 恒为 (0, 有限值]，`difficulty` 恒在 [1, 10]，
 *   绝不产生 NaN / Infinity / 倒退的 due。
 */
import type { SerializedCard } from '@/types';

/** 四档评分：1=Again 忘记 · 2=Hard 模糊 · 3=Good 记住 · 4=Easy 简单 */
export type Rating = 1 | 2 | 3 | 4;

export interface FsrsOptions {
  /** 目标记忆保持率，默认 0.9 */
  requestRetention?: number;
  /** 最大间隔天数，默认 36500（100 年，实际等于不设上限） */
  maximumInterval?: number;
}

/** FSRS 官方默认权重（21 个），见文件头「参数来源」 */
const W: readonly number[] = [
  0.212, //  0  初始稳定度 Again
  1.2931, // 1  初始稳定度 Hard
  2.3065, // 2  初始稳定度 Good
  8.2956, // 3  初始稳定度 Easy
  6.4133, // 4  初始难度截距
  0.8334, // 5  初始难度指数
  3.0194, // 6  难度变化率
  0.001, //  7  难度均值回归系数
  1.8722, // 8  成功复习稳定度增益
  0.1666, // 9  成功复习稳定度衰减指数
  0.796, //  10 成功复习可提取度敏感度
  1.4835, // 11 遗忘稳定度系数
  0.0614, // 12 遗忘难度指数
  0.2629, // 13 遗忘稳定度指数
  1.6483, // 14 遗忘可提取度敏感度
  0.6014, // 15 Hard 惩罚系数
  1.8729, // 16 Easy 奖励系数
  0.5425, // 17 同日复习稳定度增益
  0.0912, // 18 同日复习增益偏移
  0.0658, // 19 同日复习稳定度衰减指数
  0.1542, // 20 FSRS-6 曲线衰减参数（本简化版不读取，保留）
];

/** 遗忘曲线参数：DECAY = -0.5、FACTOR = 19/81 ⇒ R(S, S) = 0.9 */
const DECAY = -0.5;
const FACTOR = 19 / 81;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** 学习步进（分钟）：1 分钟 → 10 分钟 */
const LEARNING_STEPS_MINUTES: readonly number[] = [1, 10];

const DEFAULT_REQUEST_RETENTION = 0.9;
const DEFAULT_MAXIMUM_INTERVAL = 36_500;

const MIN_STABILITY = 0.01;
/** 稳定度绝对上限（天），只为防溢出，实际间隔由 maximumInterval 兜底 */
const MAX_STABILITY = 365_000;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
/** 单次复习难度变动上限：难度带 [-0.8, +0.8] */
const MAX_DIFFICULTY_DELTA = 0.8;
/** 难度回落到中位值时使用的锚点（D0(Easy)），非法难度也回落到它 */
const FALLBACK_DIFFICULTY = 5;

const RATINGS: readonly Rating[] = [1, 2, 3, 4];

/** ---------- 基础工具 ---------- */

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** 稳定度归一：非有限值、负数、0 一律回落到最小正稳定度；超过上限则截断 */
function clampStability(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_STABILITY;
  return Math.min(value, MAX_STABILITY);
}

/** 难度归一：非有限值回落到中位，其余夹到 [1, 10] */
function clampDifficulty(value: number): number {
  if (!Number.isFinite(value)) return FALLBACK_DIFFICULTY;
  return clamp(value, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/** 评分归一：非法评分（含小数、越界）按 Good 处理，保证不会抛错 */
function normalizeRating(rating: number): Rating {
  if (!Number.isFinite(rating)) return 3;
  const rounded = Math.round(rating);
  return clamp(rounded, 1, 4) as Rating;
}

function resolveRetention(opts?: FsrsOptions): number {
  const raw = opts?.requestRetention;
  if (!Number.isFinite(raw)) return DEFAULT_REQUEST_RETENTION;
  // 保持率必须落在 (0, 1)，否则间隔公式会除零或变号
  return clamp(raw as number, 0.05, 0.99);
}

function resolveMaxInterval(opts?: FsrsOptions): number {
  const raw = opts?.maximumInterval;
  if (!Number.isFinite(raw)) return DEFAULT_MAXIMUM_INTERVAL;
  return Math.max(1, Math.floor(raw as number));
}

/** 当前时间归一 */
function resolveNow(now?: number): number {
  return Number.isFinite(now) ? (now as number) : Date.now();
}

/** 把毫秒时间戳推进若干天 */
export function addDays(ts: number, days: number): number {
  const base = Number.isFinite(ts) ? ts : Date.now();
  const delta = Number.isFinite(days) ? days : 0;
  return base + delta * DAY_MS;
}

/** ---------- 曲线 ---------- */

/**
 * 可提取度 R：距离上次复习 t 天、稳定度 S 时，此刻还能想起来的概率，0..1。
 * 新卡（从未复习 / 稳定度为 0）没有记忆痕迹，返回 0。
 */
export function retrievability(card: SerializedCard, now?: number): number {
  const timestamp = resolveNow(now);
  if (card.lastReview === null || !Number.isFinite(card.lastReview)) return 0;
  if (!Number.isFinite(card.stability) || card.stability <= 0) return 0;
  const elapsedDays = Math.max(0, timestamp - card.lastReview) / DAY_MS;
  const r = Math.pow(1 + (FACTOR * elapsedDays) / card.stability, DECAY);
  if (!Number.isFinite(r)) return 0;
  return clamp(r, 0, 1);
}

/**
 * 按目标保持率把稳定度换算成间隔天数。
 * 由 R(t) = r 反解：t = S * (r^(1/DECAY) - 1) / FACTOR。
 */
function intervalDaysForStability(
  stability: number,
  retention: number,
  maxInterval: number,
): number {
  const s = clampStability(stability);
  const raw = (s / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return clamp(Math.round(raw), 1, maxInterval);
}

/** ---------- 初始参数 ---------- */

/** 首次作答的稳定度 S0(rating) = w[rating-1] */
function initialStability(rating: Rating): number {
  return clampStability(W[rating - 1]);
}

/** 首次作答的难度 D0(rating) = w4 - e^(w5 * (rating - 1)) + 1，夹到 [1, 10] */
function initialDifficulty(rating: Rating): number {
  const raw = W[4] - Math.exp(W[5] * (rating - 1)) + 1;
  return clampDifficulty(raw);
}

/**
 * 难度更新（review 状态）：
 *   1. 原始变化 ΔD = -w6 * (rating - 3)，按剩余空间线性阻尼；
 *   2. 单次变动截断到 ±0.8（难度带）；
 *   3. 向 D0(Easy) 做均值回归，权重 w7；
 *   4. 最后夹到 [1, 10]。
 */
function nextDifficulty(difficulty: number, rating: Rating): number {
  const base = clampDifficulty(difficulty);
  const delta = -W[6] * (rating - 3);
  const damped = (delta * (MAX_DIFFICULTY - base)) / 9;
  const bounded = clamp(damped, -MAX_DIFFICULTY_DELTA, MAX_DIFFICULTY_DELTA);
  const reverted = W[7] * initialDifficulty(4) + (1 - W[7]) * (base + bounded);
  return clampDifficulty(reverted);
}

/** 成功复习（跨天）后的稳定度 */
function stabilityAfterSuccess(
  stability: number,
  difficulty: number,
  recall: number,
  rating: Rating,
): number {
  const s = clampStability(stability);
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  const growth =
    Math.exp(W[8]) *
    (11 - clampDifficulty(difficulty)) *
    Math.pow(s, -W[9]) *
    (Math.exp(W[10] * (1 - recall)) - 1);
  const next = s * (1 + growth * hardPenalty * easyBonus);
  return clampStability(next);
}

/** 遗忘后的稳定度：不超过遗忘前的稳定度（避免"忘了一次反而更牢"） */
function stabilityAfterLapse(stability: number, difficulty: number, recall: number): number {
  const s = clampStability(stability);
  const raw =
    W[11] *
    Math.pow(clampDifficulty(difficulty), -W[12]) *
    (Math.pow(s + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - recall));
  if (!Number.isFinite(raw)) return MIN_STABILITY;
  return clampStability(Math.min(raw, s));
}

/** 同日复习（间隔 < 1 天）用的短程稳定度公式，避免一天内刷卡把稳定度刷没 */
function stabilitySameDay(stability: number, rating: Rating): number {
  const s = clampStability(stability);
  const next = s * Math.exp(W[17] * (rating - 3 + W[18])) * Math.pow(s, -W[19]);
  return clampStability(next);
}

/** 稳定度 → 下次间隔（天），至少 1 天 */
function scheduleFromStability(
  stability: number,
  difficulty: number,
  now: number,
  retention: number,
  maxInterval: number,
): { stability: number; difficulty: number; scheduledDays: number; due: number } {
  const s = clampStability(stability);
  const d = clampDifficulty(difficulty);
  const days = intervalDaysForStability(s, retention, maxInterval);
  return { stability: s, difficulty: d, scheduledDays: days, due: addDays(now, days) };
}

/** ---------- 卡片归一 ---------- */

const VALID_STATES: readonly SerializedCard['state'][] = [
  'new',
  'learning',
  'review',
  'relearning',
];

/** 把外部传入（可能来自旧数据）的卡片补齐成合法值，绝不返回 NaN */
function normalizeCard(card: SerializedCard, now: number): SerializedCard {
  const state = VALID_STATES.includes(card.state) ? card.state : 'new';
  const stability =
    Number.isFinite(card.stability) && card.stability > 0
      ? Math.min(card.stability, MAX_STABILITY)
      : 0;
  return {
    due: Number.isFinite(card.due) ? card.due : now,
    stability,
    difficulty: Number.isFinite(card.difficulty) ? card.difficulty : 0,
    scheduledDays:
      Number.isFinite(card.scheduledDays) && card.scheduledDays > 0 ? card.scheduledDays : 0,
    reps: Number.isFinite(card.reps) && card.reps > 0 ? Math.floor(card.reps) : 0,
    lapses: Number.isFinite(card.lapses) && card.lapses > 0 ? Math.floor(card.lapses) : 0,
    state,
    lastReview:
      card.lastReview !== null && Number.isFinite(card.lastReview) ? card.lastReview : null,
    learningStep:
      Number.isFinite(card.learningStep) && card.learningStep > 0
        ? Math.floor(card.learningStep)
        : 0,
  };
}

/** ---------- 对外 API ---------- */

/** 新建一张卡：state=new，一切归零，due=now */
export function createCard(now?: number): SerializedCard {
  const timestamp = resolveNow(now);
  return {
    due: timestamp,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReview: null,
    learningStep: 0,
  };
}

/** 是否到期（含正好到期） */
export function isDue(card: SerializedCard, now?: number): boolean {
  const timestamp = resolveNow(now);
  if (!Number.isFinite(card.due)) return true;
  return card.due <= timestamp;
}

/** 学习步进 → 落在第 step 步的延迟（天） */
function learningStepDays(step: number): number {
  const minutes = LEARNING_STEPS_MINUTES[clamp(step, 0, LEARNING_STEPS_MINUTES.length - 1)];
  return minutes / 1440;
}

/**
 * 核心：对一张卡评分后返回新卡（纯函数，不修改入参）。
 *
 * 状态机：
 *   new ──Again/Hard──> learning(step 0)
 *   new/learning ──Good──> 下一步；走完两步 ──> review（间隔 ≥ 1 天）
 *   new/learning ──Easy──> review（立即毕业，间隔 ≥ 1 天）
 *   review ──Again──> relearning(step 0)，lapses+1
 *   review ──Hard/Good/Easy──> review，按 FSRS 公式算稳定度与间隔
 *   relearning ──Good 走完步进──> review
 */
export function schedule(
  card: SerializedCard,
  rating: Rating,
  now?: number,
  opts?: FsrsOptions,
): SerializedCard {
  const timestamp = resolveNow(now);
  const retention = resolveRetention(opts);
  const maxInterval = resolveMaxInterval(opts);
  const prev = normalizeCard(card, timestamp);
  const grade = normalizeRating(rating);
  const reps = prev.reps + 1;

  // 共用尾部：把计算结果拼成新卡，并保证 due 不早于 now（绝不倒退）
  const finish = (
    fields: Pick<SerializedCard, 'due' | 'state' | 'stability' | 'difficulty' | 'scheduledDays'> & {
      lapses?: number;
      learningStep?: number;
    },
  ): SerializedCard => ({
    due: Math.max(timestamp, Number.isFinite(fields.due) ? fields.due : timestamp),
    stability: clampStability(fields.stability),
    difficulty: clampDifficulty(fields.difficulty),
    scheduledDays:
      Number.isFinite(fields.scheduledDays) && fields.scheduledDays > 0
        ? Math.min(fields.scheduledDays, maxInterval)
        : 0,
    reps,
    lapses: fields.lapses ?? prev.lapses,
    state: fields.state,
    lastReview: timestamp,
    learningStep: fields.learningStep ?? 0,
  });

  /** 未进入复习队列：new / learning */
  if (prev.state === 'new' || prev.state === 'learning') {
    const step = prev.state === 'new' ? 0 : prev.learningStep;
    const stability =
      prev.stability > 0
        ? Math.max(prev.stability, initialStability(grade))
        : initialStability(grade);
    const difficulty =
      prev.difficulty > 0 ? clampDifficulty(prev.difficulty) : initialDifficulty(grade);

    // Again：回到第 0 步，稳定度不因一次失败归零
    if (grade === 1) {
      return finish({
        due: timestamp + LEARNING_STEPS_MINUTES[0] * MINUTE_MS,
        state: 'learning',
        stability,
        difficulty,
        scheduledDays: learningStepDays(0),
        learningStep: 0,
      });
    }

    // Hard：停在当前步，重来一次
    if (grade === 2) {
      return finish({
        due: timestamp + LEARNING_STEPS_MINUTES[step] * MINUTE_MS,
        state: 'learning',
        stability,
        difficulty,
        scheduledDays: learningStepDays(step),
        learningStep: step,
      });
    }

    // Easy：立即毕业
    if (grade === 4) {
      const graduated = scheduleFromStability(
        stability,
        difficulty,
        timestamp,
        retention,
        maxInterval,
      );
      return finish({ ...graduated, state: 'review' });
    }

    // Good：走下一步；两步走完转 review
    const nextStep = step + 1;
    if (nextStep < LEARNING_STEPS_MINUTES.length) {
      return finish({
        due: timestamp + LEARNING_STEPS_MINUTES[nextStep] * MINUTE_MS,
        state: 'learning',
        stability,
        difficulty,
        scheduledDays: learningStepDays(nextStep),
        learningStep: nextStep,
      });
    }
    const graduated = scheduleFromStability(
      stability,
      difficulty,
      timestamp,
      retention,
      maxInterval,
    );
    return finish({ ...graduated, state: 'review', learningStep: 0 });
  }

  // 复习队列：review / relearning
  const elapsedDays =
    prev.lastReview === null ? 0 : Math.max(0, timestamp - prev.lastReview) / DAY_MS;
  const recall = retrievability(prev, timestamp);

  if (grade === 1) {
    const stability = stabilityAfterLapse(prev.stability, prev.difficulty, recall);
    const difficulty = nextDifficulty(prev.difficulty, grade);
    return finish({
      due: timestamp + LEARNING_STEPS_MINUTES[0] * MINUTE_MS,
      state: 'relearning',
      stability,
      difficulty,
      scheduledDays: learningStepDays(0),
      lapses: prev.lapses + 1,
      learningStep: 0,
    });
  }

  const stability =
    elapsedDays < 1
      ? stabilitySameDay(prev.stability, grade)
      : stabilityAfterSuccess(prev.stability, prev.difficulty, recall, grade);
  const difficulty = nextDifficulty(prev.difficulty, grade);

  // relearning 里答对：先把学习步进走完，才回到 review
  if (prev.state === 'relearning') {
    const nextStep = prev.learningStep + 1;
    if (grade !== 4 && nextStep < LEARNING_STEPS_MINUTES.length) {
      return finish({
        due: timestamp + LEARNING_STEPS_MINUTES[nextStep] * MINUTE_MS,
        state: 'relearning',
        stability,
        difficulty,
        scheduledDays: learningStepDays(nextStep),
        learningStep: nextStep,
      });
    }
  }

  const graduated = scheduleFromStability(stability, difficulty, timestamp, retention, maxInterval);
  return finish({ ...graduated, state: 'review', learningStep: 0 });
}

/** 四档评分各自的落点预览（不改动原卡片），UI 用按钮上的「下次 X 天」 */
export function reviewPreview(
  card: SerializedCard,
  now?: number,
): Record<Rating, { due: number; scheduledDays: number }> {
  const preview = {} as Record<Rating, { due: number; scheduledDays: number }>;
  for (const rating of RATINGS) {
    const next = schedule(card, rating, now);
    preview[rating] = { due: next.due, scheduledDays: next.scheduledDays };
  }
  return preview;
}

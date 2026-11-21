/**
 * 学习记录服务：把一次作答写进「用户词库 + FSRS 卡片」。
 *
 * 所有写入都走这里，保证：
 *  - 错词自动进错词本（mistakes++）
 *  - FSRS 状态只由 schedule() 演进，别处不准手改
 *  - 会话统计与成就检查在同一事务后触发
 */
import { db } from '@/db';
import type {
  UserWord,
  PracticeMode,
  PracticeSession,
  WordAttempt,
  WordEntry,
  SerializedCard,
  MistakeCounts,
} from '@/types';
import { createCard, schedule, type Rating } from '@/lib/fsrs';
import { computeAccuracy, computeWpm } from '@/lib/stats';

/**
 * 把用户的作答表现翻译成 FSRS 评分。
 *
 * 对**首次接触**的词刻意封顶为 Good（3）而不是 Easy（4）：
 * Easy 会直接跳过两个 learning 步进（1min / 10min）立刻毕业，
 * 意味着一轮里打对一次的词当天就再也不出现——对刚认识的词太宽松了。
 * 只有已经过 learning 阶段的老卡片，零失误才给 Easy。
 */
export function deriveRating(correct: boolean, mistakes: number, card?: SerializedCard): Rating {
  if (!correct) return 1; // 答错 → Again

  const inLearning = card ? card.state === 'new' || card.state === 'learning' : true;
  const base: Rating = mistakes === 0 ? 4 : mistakes <= 2 ? 3 : 2;

  // 学习阶段封顶 Good，保证新词至少走完两个步进
  if (inLearning && base === 4) return 3;
  return base;
}

export function wordKey(bankId: string, word: string): string {
  return `${bankId}:${word.toLowerCase()}`;
}

/**
 * 记录一个词的作答结果，返回更新后的 UserWord。
 * 未学过的新词会被创建。
 */
export async function recordAttempt(params: {
  entry: WordEntry;
  bankId: string;
  correct: boolean;
  mistakes: number;
  /** 本次错误的分类明细；没采集到就传 undefined（不是全零） */
  mistakeKinds?: MistakeCounts;
  now?: number;
}): Promise<UserWord> {
  const { entry, bankId, correct, mistakes, mistakeKinds } = params;
  const now = params.now ?? Date.now();
  const id = wordKey(bankId, entry.w);

  const existing = await db.userWords.get(id);
  const base: UserWord =
    existing ??
    ({
      id,
      bankId,
      word: entry.w,
      trans: entry.t,
      phonetic: entry.p,
      mistakes: 0,
      corrects: 0,
      favorite: false,
      mastered: false,
      card: createCard(now),
      createdAt: now,
      updatedAt: now,
    } satisfies UserWord);

  const rating = deriveRating(correct, mistakes, base.card);
  const card = schedule(base.card, rating, now);

  /**
   * 错误分类是累加而不是覆盖：错词本要回答的是「这个词历史上我在哪类错上栽得多」，
   * 单次作答的分类没有单独价值。
   *
   * 没传分类时（辨认模式、或老版本调用方）保留原值不动——
   * 写全零会被误读成「这个词从没错过这类错」，而实际是「没采集」。
   */
  const mergedKinds: MistakeCounts | undefined = mistakeKinds
    ? {
        order: (base.mistakeKinds?.order ?? 0) + mistakeKinds.order,
        adjacent: (base.mistakeKinds?.adjacent ?? 0) + mistakeKinds.adjacent,
        similar: (base.mistakeKinds?.similar ?? 0) + mistakeKinds.similar,
        unrelated: (base.mistakeKinds?.unrelated ?? 0) + mistakeKinds.unrelated,
      }
    : base.mistakeKinds;

  const next: UserWord = {
    ...base,
    // 释义/音标可能因为词库更新而变化，每次作答顺手刷新快照
    trans: entry.t || base.trans,
    phonetic: entry.p ?? base.phonetic,
    mistakes: base.mistakes + Math.max(mistakes, correct ? 0 : 1),
    ...(mergedKinds ? { mistakeKinds: mergedKinds } : {}),
    corrects: base.corrects + (correct ? 1 : 0),
    // 答对且卡片进入较长间隔时自动取消「已掌握」以外的标记不做处理
    card,
    updatedAt: now,
  };

  await db.userWords.put(next);
  return next;
}

/**
 * 会话结束后落库，并返回带 id 的会话。
 *
 * `activeMs` 是练习计时器累计的**活跃时长**（真实动过键盘的时间）。
 * 传了就用它算 WPM 与 durationSec；不传则退回墙钟时长，
 * 这样旧调用方（以及测试）仍然按原语义工作。
 *
 * 为什么两者必须分开：墙钟时长包含挂机与系统休眠，
 * 用它算 WPM 会把成绩稀释到接近 0。
 */
export async function saveSession(params: {
  mode: PracticeMode;
  bankId: string;
  startedAt: number;
  endedAt: number;
  attempts: WordAttempt[];
  /** 累计活跃毫秒；省略时用 endedAt - startedAt */
  activeMs?: number;
}): Promise<PracticeSession> {
  const { mode, bankId, startedAt, endedAt, attempts } = params;

  let keystrokes = 0;
  let correctKeystrokes = 0;
  let correct = 0;
  let perfect = 0;

  for (const a of attempts) {
    keystrokes += a.word.length + a.mistakes;
    correctKeystrokes += a.word.length;
    if (a.correct) correct++;
    if (a.correct && a.mistakes === 0) perfect++;
  }

  /**
   * 时长口径：
   *  - 有活跃时长就用它（排除挂机/休眠）
   *  - 否则退回墙钟，但至少 1ms，避免除零
   */
  const activeMs =
    typeof params.activeMs === 'number' && Number.isFinite(params.activeMs) && params.activeMs > 0
      ? params.activeMs
      : null;
  const durationMs = activeMs ?? Math.max(1, endedAt - startedAt);
  const session: PracticeSession = {
    startedAt,
    endedAt,
    mode,
    bankId,
    total: attempts.length,
    perfect,
    correct,
    keystrokes,
    correctKeystrokes,
    wpm: computeWpm(correctKeystrokes, durationMs),
    accuracy: computeAccuracy(correctKeystrokes, keystrokes),
    durationSec: Math.round(durationMs / 1000),
    // 只保留需要后续关注的词，避免 sessions 表膨胀
    words: attempts.filter((a) => !a.correct || a.mistakes > 0).map((a) => a.word),
  };

  const id = await db.sessions.add(session);
  return { ...session, id };
}

/** 标记收藏 / 取消收藏 */
export async function toggleFavorite(uw: UserWord): Promise<void> {
  await db.userWords.put({ ...uw, favorite: !uw.favorite, updatedAt: Date.now() });
}

/** 标记已掌握 / 取消 */
export async function toggleMastered(uw: UserWord): Promise<void> {
  await db.userWords.put({ ...uw, mastered: !uw.mastered, updatedAt: Date.now() });
}

/** 把一批词重置为「未学」，用于错词本「重新学」 */
export async function resetWords(ids: string[]): Promise<void> {
  await db.transaction('rw', db.userWords, async () => {
    for (const id of ids) {
      const uw = await db.userWords.get(id);
      if (!uw) continue;
      await db.userWords.put({ ...uw, card: createCard(Date.now()), updatedAt: Date.now() });
    }
  });
}

/** 今日已学新词数 / 已复习数（按本地日期判断） */
export async function todayCounts(
  now = Date.now(),
): Promise<{ todayNew: number; todayReviewed: number }> {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startTs = start.getTime();

  const words = await db.userWords.toArray();
  let todayNew = 0;
  let todayReviewed = 0;
  for (const w of words) {
    if (w.createdAt >= startTs) todayNew++;
    // reps > 0 且今天有更新，视为一次复习
    if (w.card.reps > 0 && w.updatedAt >= startTs && w.createdAt < startTs) todayReviewed++;
  }
  return { todayNew, todayReviewed };
}

/** 待复习数量 */
export async function dueCount(bankId?: string): Promise<number> {
  const now = Date.now();
  const words = bankId
    ? await db.userWords.where('bankId').equals(bankId).toArray()
    : await db.userWords.toArray();
  return words.filter((w) => !w.mastered && w.card.due <= now).length;
}

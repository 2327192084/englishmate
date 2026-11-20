/**
 * 出题队列：决定「这一轮练哪些词」。
 *
 * 优先级：
 *   1. 到期复习（FSRS due 已过）—— 最该先做
 *   2. 错词（在错词本里但还没到期）—— 提前干预
 *   3. 新词 —— 按每日目标限量
 *   4. 兜底：随机抽取，保证任何情况下都有词可练
 */
import type { UserWord, WordEntry, PracticeMode } from '@/types';
import { isDue } from '@/lib/fsrs';

export interface RoundPlan {
  entries: WordEntry[];
  /** 每个词进入本轮的原因，用于 UI 标注 */
  reasons: Map<string, 'review' | 'wrong' | 'new' | 'random' | 'favorite'>;
}

export interface BuildRoundOptions {
  bankId: string;
  /** 全部词条 */
  allWords: WordEntry[];
  /** 已学过的词（key = word 小写） */
  known: Map<string, UserWord>;
  /** 本轮词数 */
  size: number;
  /** 今日还可学的新词数 */
  newQuota: number;
  /**
   * 每日复习上限（设置项 dailyReviewLimit 的实际生效点）。
   * 超过上限的到期词顺延到明天，避免积压几十个到期词时一轮做不完。
   * 省略或 <=0 视为不限。
   */
  reviewLimit?: number;
  mode: PracticeMode;
  /** 随机种子，默认 Math.random；单测可注入 */
  rng?: () => number;
  now?: number;
}

/** 洗牌，Fisher–Yates */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 生成一轮练习计划。
 *
 * 关键不变量：返回的 entries 长度 <= size，且同一个词不会重复出现。
 */
export function buildRound(opts: BuildRoundOptions): RoundPlan {
  const { allWords, known, size, newQuota, mode } = opts;
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? Date.now();

  const reasons = new Map<string, 'review' | 'wrong' | 'new' | 'random' | 'favorite'>();
  const picked: WordEntry[] = [];

  // 辨认模式消耗低，给多一点；其余按 size
  const limit = mode === 'choice' ? Math.ceil(size * 1.5) : size;

  const seen = new Set<string>();
  const push = (entry: WordEntry, reason: 'review' | 'wrong' | 'new' | 'random' | 'favorite') => {
    const key = entry.w.toLowerCase();
    if (seen.has(key) || picked.length >= limit) return;
    seen.add(key);
    picked.push(entry);
    reasons.set(key, reason);
  };

  // 1) 到期复习
  const due: WordEntry[] = [];
  const wrong: WordEntry[] = [];
  for (const entry of allWords) {
    const uw = known.get(entry.w.toLowerCase());
    if (!uw) continue;
    if (uw.mastered) continue;
    if (isDue(uw.card, now)) {
      due.push(entry);
    } else if (uw.mistakes > 0) {
      wrong.push(entry);
    }
  }
  /**
   * 到期词的排序：**收藏优先，其次按到期时间**。
   *
   * 收藏此前只是个标记——能点星标、能筛选，但出题调度完全不看它，
   * 用户收藏了重点词却得不到任何复习倾斜，功能等于没有。
   * 现在让它真正起作用：到期词里收藏的排前面，用户想重点巩固的词先练。
   */
  due.sort((a, b) => {
    const ua = known.get(a.w.toLowerCase())!;
    const ub = known.get(b.w.toLowerCase())!;
    if (ua.favorite !== ub.favorite) return ua.favorite ? -1 : 1;
    return ua.card.due - ub.card.due;
  });

  /**
   * 每日复习上限：到期词再多，这一轮最多也只取 reviewLimit 个。
   * 剩余顺延到下一轮/第二天。这是设置里 dailyReviewLimit 的唯一生效点——
   * 之前它只是个能拖动但没人读的滑杆。
   */
  /**
   * 注意 0 是**有效值**（表示今天不再复习），不能用 `> 0` 判断。
   * 只有 undefined / null 才是"不限"。这里用 == null 判断，
   * 避免把 0 误当成"未设置"。
   */
  const reviewCap =
    opts.reviewLimit == null || Number.isNaN(opts.reviewLimit)
      ? Infinity
      : Math.max(0, opts.reviewLimit);
  let reviewTaken = 0;
  for (const e of due) {
    if (picked.length >= Math.ceil(limit * 0.7)) break;
    if (reviewTaken >= reviewCap) break;
    const before = picked.length;
    push(e, 'review');
    if (picked.length > before) reviewTaken++;
  }

  /**
   * 2) 收藏的词即使没到期也提前拉进来。
   *
   * 收藏的语义是"我要重点练这个词"。如果只等 FSRS 到期，
   * 用户收藏完可能要隔好几天才见到它，功能价值就被架空了。
   * 这里给收藏词一条"插队"通道：排在到期词之后、错词之前。
   */
  const favNotDue: WordEntry[] = [];
  for (const entry of allWords) {
    const uw = known.get(entry.w.toLowerCase());
    if (!uw || uw.mastered || !uw.favorite) continue;
    // 已经作为到期词入队的跳过，避免重复
    if (picked.some((p) => p.w.toLowerCase() === entry.w.toLowerCase())) continue;
    favNotDue.push(entry);
  }
  // 收藏词里也优先练错得多的
  favNotDue.sort((a, b) => {
    const ua = known.get(a.w.toLowerCase())!;
    const ub = known.get(b.w.toLowerCase())!;
    return ub.mistakes - ua.mistakes;
  });
  for (const e of favNotDue) {
    if (picked.length >= limit) break;
    push(e, 'favorite');
  }

  // 3) 错词提前干预（错得越多越优先）
  wrong.sort((a, b) => {
    const wa = known.get(a.w.toLowerCase())!.mistakes;
    const wb = known.get(b.w.toLowerCase())!.mistakes;
    return wb - wa;
  });
  for (const e of wrong) {
    if (picked.length >= limit) break;
    push(e, 'wrong');
  }

  // 4) 新词
  if (newQuota > 0) {
    const fresh = allWords.filter((e) => !known.has(e.w.toLowerCase()));
    const ordered = shuffle(fresh, rng);
    let added = 0;
    for (const e of ordered) {
      if (picked.length >= limit) break;
      if (added >= newQuota) break;
      const before = picked.length;
      push(e, 'new');
      if (picked.length > before) added++;
    }
  }

  /**
   * 5) 兜底补齐（比如复习都做完了、新词额度也用光了）
   *
   * 注意要排除已掌握的词。原实现只排了 `seen`（本轮已入队的），
   * 于是"标记为已掌握"的词会在兜底阶段被当成加练重新拉进来——
   * 用户明明标记了"不用再练"，却还是会出现。这是个一直存在的 bug，
   * 在做收藏优先级时被测试暴露出来。
   */
  if (picked.length < Math.min(limit, allWords.length)) {
    const rest = allWords.filter((e) => {
      if (seen.has(e.w.toLowerCase())) return false;
      const uw = known.get(e.w.toLowerCase());
      return !(uw && uw.mastered);
    });
    for (const e of shuffle(rest, rng)) {
      if (picked.length >= limit) break;
      push(e, 'random');
    }
  }

  return { entries: picked, reasons };
}

/** 给辨认模式生成干扰项（同词库内随机取 3 个不同释义） */
export function buildChoices(
  correct: WordEntry,
  pool: WordEntry[],
  rng: () => number = Math.random,
): { label: string; correct: boolean }[] {
  const used = new Set<string>([correct.t]);
  const distractors: string[] = [];
  const candidates = shuffle(pool, rng);
  for (const c of candidates) {
    if (distractors.length >= 3) break;
    if (c.w === correct.w) continue;
    if (used.has(c.t)) continue;
    // 释义完全一样（同义词/重复）会造成两个正确答案，跳过
    used.add(c.t);
    distractors.push(c.t);
  }
  const all = shuffle(
    [
      { label: correct.t, correct: true },
      ...distractors.map((d) => ({ label: d, correct: false })),
    ],
    rng,
  );
  return all;
}

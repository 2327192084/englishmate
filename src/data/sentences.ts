/**
 * 句子库：从词库的例句里取出可练习的句子。
 *
 * 为什么以「词条」为单位取句而不是把全库句子摊平：练习完毕要能说清
 * "这句来自哪个词"，也方便以后按词回链到词库详情。一个词最多取一句，
 * 否则一个高频词的几句例句会挤满一整轮。
 *
 * 为什么限长 100 字符：句子练习是"整句输入"，句子太长打字成本过高，
 * 用户会在中途就想放弃；长句属于文章练习的场景。
 */
import type { WordEntry } from '@/types';
import { db } from '@/db';
import { loadWords } from '@/data/wordbanks';
import { normalizeForCompare } from '@/lib/text';

export interface SentenceItem {
  en: string;
  zh: string;
  /** 这句例句归属的词条（原形，未归一化），用于回链与埋点 */
  word: string;
  bankId: string;
}

/** 超过这个长度就不收：整句输入的体验阈值 */
const MAX_SENTENCE_LEN = 100;

/**
 * 本地洗牌（Fisher–Yates）。
 *
 * 不直接复用 `src/data/round.ts` 的 `shuffle`：那个模块顺带拉进了
 * FSRS 出题逻辑，取数模块没必要为此建立依赖。这里只有十行，重复比耦合划算。
 */
function shuffleWith<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 词条里能用来练习的例句（非空、够短） */
function usableSentences(entry: WordEntry): { en: string; zh: string }[] {
  const list = entry.sentences;
  if (!Array.isArray(list)) return [];
  const out: { en: string; zh: string }[] = [];
  for (const s of list) {
    if (!s || typeof s.en !== 'string' || typeof s.zh !== 'string') continue;
    const en = s.en.trim();
    if (!en || en.length > MAX_SENTENCE_LEN) continue;
    out.push({ en, zh: s.zh });
  }
  return out;
}

/**
 * 从一批词条里抽例句。
 *
 * 顺序：先按词条顺序每个词随机取一句，再整体洗牌，最后截取 limit。
 * 先洗牌再截断会让"哪些词入选"也带随机性，但入选项本身是按词条顺序取的，
 * 高频词库里靠前的词会占满整轮——所以必须整体洗牌后才截断。
 */
export async function sentencesFromWords(
  words: WordEntry[],
  bankId: string,
  limit: number,
  rng: () => number = Math.random,
): Promise<SentenceItem[]> {
  if (!Array.isArray(words) || limit <= 0) return [];

  const picked: SentenceItem[] = [];
  for (const entry of words) {
    if (!entry || typeof entry.w !== 'string') continue;
    const usable = usableSentences(entry);
    if (usable.length === 0) continue;
    const s = usable[Math.floor(rng() * usable.length)];
    // usable 非空，这里的兜底只为类型收窄
    if (!s) continue;
    picked.push({ en: s.en, zh: s.zh, word: entry.w, bankId });
  }

  return shuffleWith(picked, rng).slice(0, limit);
}

/** 按词库抽例句；词库加载失败时返回空数组，不把错误抛给界面 */
export async function sentencesForBank(bankId: string, limit: number): Promise<SentenceItem[]> {
  if (!bankId) return [];
  try {
    const words = await loadWords(bankId);
    return await sentencesFromWords(words, bankId, limit);
  } catch {
    // 离线、词库被删、JSON 损坏都走这里：界面只该看到"没有句子"，不是白屏
    return [];
  }
}

/** 按归一化后的词形做匹配键：大小写、弯引号、省略号都不该影响配对 */
function wordKey(word: string): string {
  return normalizeForCompare(word).toLowerCase();
}

/**
 * 从错词本 / 收藏里抽例句。
 *
 * 为什么按 bankId 分组再加载：一个词库动辄几千词，没必要为了找十几个词
 * 把所有词库都读一遍；实际路径只会加载用户真正练过的那些词库。
 */
export async function sentencesForUserWords(
  kind: 'wrong' | 'favorite',
  limit: number,
): Promise<SentenceItem[]> {
  if (limit <= 0) return [];
  let rows;
  try {
    // favorite 是布尔字段：IndexedDB 的索引不接受布尔键，拿它做 where 查不到东西，
    // 所以这里整表读出再在内存里过滤（用户词条在万级以内，成本可接受）。
    rows = await db.userWords.toArray();
  } catch {
    return [];
  }

  const wanted = rows.filter((r) =>
    kind === 'wrong' ? r.mistakes > 0 : r.favorite === true,
  );
  if (wanted.length === 0) return [];

  // bankId -> 该词库里要取的词（保留原词形，方便按 key 匹配）
  const byBank = new Map<string, Set<string>>();
  for (const r of wanted) {
    if (!r.bankId || !r.word) continue;
    let set = byBank.get(r.bankId);
    if (!set) {
      set = new Set<string>();
      byBank.set(r.bankId, set);
    }
    set.add(wordKey(r.word));
  }
  if (byBank.size === 0) return [];

  const collected: SentenceItem[] = [];
  for (const [bankId, keys] of byBank) {
    let words: WordEntry[];
    try {
      words = await loadWords(bankId);
    } catch {
      // 单个词库坏掉不该连累其它来源
      continue;
    }
    const matched = words.filter((w) => typeof w.w === 'string' && keys.has(wordKey(w.w)));
    if (matched.length === 0) continue;
    collected.push(...(await sentencesFromWords(matched, bankId, matched.length)));
  }

  // 各词库内部已经各自洗过牌，跨词库还要再打散一次，否则错词多的词库会全占前排
  return shuffleWith(collected, Math.random).slice(0, limit);
}

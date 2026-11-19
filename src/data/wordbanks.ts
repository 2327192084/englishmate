/**
 * 词库访问层。
 *
 * 内置词库放在 public/dicts/*.json，按需 fetch + 内存缓存，
 * 首屏不需要把几万词全下载下来。自定义词库存在 IndexedDB。
 */
import { db, type CustomBank } from '@/db';
import type { WordbankMeta, WordEntry, WordbankCategory } from '@/types';

export interface WordbankIndex {
  generatedAt: string;
  banks: WordbankMeta[];
}

/** 内存缓存，避免同一词库反复 fetch */
const cache = new Map<string, WordEntry[]>();
const inflight = new Map<string, Promise<WordEntry[]>>();

export const BUILTIN_BANK_IDS = [
  'cet4',
  'cet6',
  'kaoyan',
  'ielts',
  'toefl',
  'gre',
  'gaokao',
  'linux',
] as const;

export type BuiltinBankId = (typeof BUILTIN_BANK_IDS)[number];

/** 内置词库的静态元信息；index.json 缺字段时用它兜底，避免 UI 空白 */
export const FALLBACK_BANKS: WordbankMeta[] = [
  {
    id: 'cet4',
    name: 'CET-4 · 四级核心',
    category: 'exam',
    description: '大学英语四级核心词汇，备考第一步',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/CET4_T.json',
  },
  {
    id: 'cet6',
    name: 'CET-6 · 六级核心',
    category: 'exam',
    description: '大学英语六级核心词汇',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/CET6_T.json',
  },
  {
    id: 'kaoyan',
    name: '考研 · 核心词',
    category: 'exam',
    description: '考研英语大纲核心词汇',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/KaoYan_2024.json',
  },
  {
    id: 'ielts',
    name: '雅思 IELTS',
    category: 'exam',
    description: '雅思听说读写高频词汇',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/IELTS_3_T.json',
  },
  {
    id: 'toefl',
    name: '托福 TOEFL',
    category: 'exam',
    description: '托福考试核心词汇',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/TOEFL_3_T.json',
  },
  {
    id: 'gre',
    name: 'GRE',
    category: 'exam',
    description: 'GRE 高阶词汇，词义辨析密集',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/GRE_3_T.json',
  },
  {
    id: 'gaokao',
    name: '高考 · 高中词汇',
    category: 'basic',
    description: '高中阶段全部重点词汇',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/GaoZhongluan_2_T.json',
  },
  {
    id: 'linux',
    name: '程序员 · Linux 命令',
    category: 'programming',
    description: '常用 Linux 命令与参数，练打字顺便记命令',
    count: 0,
    source: 'Qwerty Learner (MIT) · public/dicts/linux-command.json',
  },
];

export const CATEGORY_LABEL: Record<WordbankCategory, string> = {
  exam: '考试词库',
  programming: '程序员词库',
  basic: '基础词库',
};

/** 读内置词库索引；失败时退回静态元信息（count 未知） */
export async function loadBankIndex(): Promise<WordbankIndex> {
  try {
    const res = await fetch('/dicts/index.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as WordbankIndex;
    if (!Array.isArray(data.banks) || data.banks.length === 0) throw new Error('empty');
    return data;
  } catch {
    return { generatedAt: '', banks: FALLBACK_BANKS };
  }
}

/** 加载某个词库的词条（内置或自定义，靠 id 前缀区分） */
export async function loadWords(bankId: string): Promise<WordEntry[]> {
  const hit = cache.get(bankId);
  if (hit) return hit;
  const running = inflight.get(bankId);
  if (running) return running;

  const task = (async (): Promise<WordEntry[]> => {
    if (bankId.startsWith('custom:')) {
      const rawId = bankId.slice('custom:'.length);
      const bank = await db.customBanks.get(rawId);
      const words = bank?.words ?? [];
      cache.set(bankId, words);
      return words;
    }

    const res = await fetch(`/dicts/${bankId}.json`);
    if (!res.ok) throw new Error(`词库 ${bankId} 加载失败（${res.status}）`);
    const data = (await res.json()) as { meta: WordbankMeta; words: WordEntry[] };
    const words = Array.isArray(data.words) ? data.words : [];
    if (words.length === 0) throw new Error(`词库 ${bankId} 为空`);
    cache.set(bankId, words);
    return words;
  })();

  inflight.set(bankId, task);
  try {
    return await task;
  } finally {
    inflight.delete(bankId);
  }
}

/** 自定义词库列表 */
export async function listCustomBanks(): Promise<WordbankMeta[]> {
  const rows = await db.customBanks.orderBy('createdAt').reverse().toArray();
  return rows.map(customToMeta);
}

export function customToMeta(b: CustomBank): WordbankMeta {
  return {
    id: `custom:${b.id}`,
    name: b.name,
    category: 'basic',
    description: b.description || '自定义导入词库',
    count: b.words.length,
    source: '用户导入',
  };
}

/** 清空内存缓存（导入自定义词库后调用） */
export function invalidateCache(bankId?: string): void {
  if (bankId) cache.delete(bankId);
  else cache.clear();
}

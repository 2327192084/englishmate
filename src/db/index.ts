/**
 * EnglishMate · 本地数据库（IndexedDB / Dexie）
 *
 * 设计原则：离线优先。所有学习数据都在本地，不需要账号。
 * 只有「可选云同步」时才会把数据推给后端，本项目 MVP 不实现云同步。
 */
import Dexie, { type Table } from 'dexie';
import type { PracticeSession, Settings, UnlockedAchievement, UserWord } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

/** 自定义导入的词库，存在本地 */
export interface CustomBank {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  words: { w: string; t: string; p?: string }[];
}

/**
 * 用户自己导入的文章。
 *
 * 相比内置文章的 `Article`（`src/types.ts`）多一个 `createdAt`，
 * 用来在列表里按导入时间倒序排；其余字段一一对应，
 * 因此读出来直接能当 `Article` 用，练习逻辑（ArticlePlayer）不需要任何改动。
 */
export interface CustomArticle {
  id: string;
  title: string;
  titleZh: string;
  /** 难度标签：'CET-4' | 'CET-6' | '考研' | '雅思' */
  level: string;
  author: string;
  sentences: { en: string; zh: string }[];
  /** 来源与许可说明，导入时写成 "导入自 xxx.txt" */
  source: string;
  /** 导入时间戳，列表倒序 + 导出用 */
  createdAt: number;
}

/** 杂项键值（上次选择的词库、导入历史等） */
export interface MetaRow {
  key: string;
  value: unknown;
}

export class EnglishMateDB extends Dexie {
  userWords!: Table<UserWord, string>;
  sessions!: Table<PracticeSession, number>;
  settings!: Table<Settings, number>;
  achievements!: Table<UnlockedAchievement, string>;
  customBanks!: Table<CustomBank, string>;
  customArticles!: Table<CustomArticle, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('englishmate');

    this.version(1).stores({
      // 索引只放真正要查询的字段，其余走内存过滤（数据量在万级以内）
      userWords: 'id, bankId, word, favorite, mastered, updatedAt, mistakes',
      sessions: '++id, startedAt, mode, bankId',
      settings: 'id',
      achievements: 'id',
      customBanks: 'id, createdAt',
      meta: 'key',
    });

    /**
     * v2：新增自定义文章表。
     *
     * Dexie 的版本声明是「增量」的——只写本次新增/变更的表，
     * v1 里的其余表定义自动继承，**不要**在这里重复声明旧表，
     * 否则一旦旧表定义和 v1 有出入就会触发 SchemaError。
     */
    this.version(2).stores({
      customArticles: 'id, createdAt',
    });
  }
}

export const db = new EnglishMateDB();

/** 单用户设置：固定主键 1，读不到就落默认值 */
export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get(1);
  if (row) return { ...DEFAULT_SETTINGS, ...row };
  const fresh: Settings = { id: 1, ...DEFAULT_SETTINGS };
  await db.settings.put(fresh);
  return fresh;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, id: 1 };
  await db.settings.put(next);
  return next;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** 清空全部学习数据（设置保留） */
export async function clearAllData(): Promise<void> {
  /**
   * 表列表用**数组**传，不用可变参数。
   *
   * Dexie 的 transaction() 签名是 transaction(mode, table1, table2, ... , scope)，
   * 最多接 7 个表参数。这里已经有 6 张表，再按位置加一个就超出上限
   * （编译器报 Expected 3-7 arguments, but got 8），且传数组可读性更好。
   */
  await db.transaction(
    'rw',
    [db.userWords, db.sessions, db.achievements, db.customBanks, db.customArticles, db.meta],
    async () => {
      await db.userWords.clear();
      await db.sessions.clear();
      await db.achievements.clear();
      await db.customBanks.clear();
      await db.customArticles.clear();
      await db.meta.clear();
    },
  );
}

/** 导出全部数据为可下载的 JSON */
export async function exportAllData(): Promise<string> {
  const [userWords, sessions, settings, achievements, customBanks, customArticles] =
    await Promise.all([
      db.userWords.toArray(),
      db.sessions.toArray(),
      db.settings.toArray(),
      db.achievements.toArray(),
      db.customBanks.toArray(),
      db.customArticles.toArray(),
    ]);
  return JSON.stringify(
    {
      app: 'englishmate',
      version: 2,
      exportedAt: new Date().toISOString(),
      userWords,
      sessions,
      settings,
      achievements,
      customBanks,
      customArticles,
    },
    null,
    2,
  );
}

/** 从导出的 JSON 恢复（覆盖式） */
export async function importAllData(json: string): Promise<{ words: number; sessions: number }> {
  const data = JSON.parse(json) as {
    app?: string;
    version?: number;
    userWords?: UserWord[];
    sessions?: PracticeSession[];
    settings?: Settings[];
    achievements?: UnlockedAchievement[];
    customBanks?: CustomBank[];
    customArticles?: CustomArticle[];
  };
  if (data.app !== 'englishmate') {
    throw new Error('这不是 EnglishMate 导出的数据文件');
  }
  await db.transaction(
    'rw',
    [db.userWords, db.sessions, db.settings, db.achievements, db.customBanks, db.customArticles],
    async () => {
      await db.userWords.clear();
      await db.sessions.clear();
      if (data.userWords?.length) await db.userWords.bulkPut(data.userWords);
      if (data.sessions?.length) await db.sessions.bulkPut(data.sessions);
      if (data.achievements?.length) await db.achievements.bulkPut(data.achievements);
      if (data.customBanks?.length) await db.customBanks.bulkPut(data.customBanks);
      /**
       * customArticles 只在导出文件**确实带了这个字段**时才替换。
       *
       * 旧备份（version 1，2026-11-21 之前的导出）没有 customArticles 字段。
       * 若无条件 clear 再按存在性 bulkPut，从旧备份恢复会让用户
       * 现有的自定义文章凭空消失——而用户的本意只是恢复学习进度。
       * 「字段缺失」和「字段存在但为空」必须区别对待：
       * 前者是旧格式（保留现状），后者是用户确实清空过（跟着清空）。
       */
      if (data.customArticles) {
        await db.customArticles.clear();
        if (data.customArticles.length) await db.customArticles.bulkPut(data.customArticles);
      }
      if (data.settings?.length) {
        await db.settings.clear();
        await db.settings.bulkPut(data.settings);
      }
    },
  );
  return { words: data.userWords?.length ?? 0, sessions: data.sessions?.length ?? 0 };
}

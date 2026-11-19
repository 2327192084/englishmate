/**
 * TypeFlow · 本地数据库（IndexedDB / Dexie）
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

/** 杂项键值（上次选择的词库、导入历史等） */
export interface MetaRow {
  key: string;
  value: unknown;
}

export class TypeFlowDB extends Dexie {
  userWords!: Table<UserWord, string>;
  sessions!: Table<PracticeSession, number>;
  settings!: Table<Settings, number>;
  achievements!: Table<UnlockedAchievement, string>;
  customBanks!: Table<CustomBank, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('typeflow');

    this.version(1).stores({
      // 索引只放真正要查询的字段，其余走内存过滤（数据量在万级以内）
      userWords: 'id, bankId, word, favorite, mastered, updatedAt, mistakes',
      sessions: '++id, startedAt, mode, bankId',
      settings: 'id',
      achievements: 'id',
      customBanks: 'id, createdAt',
      meta: 'key',
    });
  }
}

export const db = new TypeFlowDB();

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
  await db.transaction(
    'rw',
    db.userWords,
    db.sessions,
    db.achievements,
    db.customBanks,
    db.meta,
    async () => {
      await db.userWords.clear();
      await db.sessions.clear();
      await db.achievements.clear();
      await db.customBanks.clear();
      await db.meta.clear();
    },
  );
}

/** 导出全部数据为可下载的 JSON */
export async function exportAllData(): Promise<string> {
  const [userWords, sessions, settings, achievements, customBanks] = await Promise.all([
    db.userWords.toArray(),
    db.sessions.toArray(),
    db.settings.toArray(),
    db.achievements.toArray(),
    db.customBanks.toArray(),
  ]);
  return JSON.stringify(
    {
      app: 'typeflow',
      version: 1,
      exportedAt: new Date().toISOString(),
      userWords,
      sessions,
      settings,
      achievements,
      customBanks,
    },
    null,
    2,
  );
}

/** 从导出的 JSON 恢复（覆盖式） */
export async function importAllData(json: string): Promise<{ words: number; sessions: number }> {
  const data = JSON.parse(json) as {
    app?: string;
    userWords?: UserWord[];
    sessions?: PracticeSession[];
    settings?: Settings[];
    achievements?: UnlockedAchievement[];
    customBanks?: CustomBank[];
  };
  if (data.app !== 'typeflow') {
    throw new Error('这不是 TypeFlow 导出的数据文件');
  }
  await db.transaction(
    'rw',
    db.userWords,
    db.sessions,
    db.settings,
    db.achievements,
    db.customBanks,
    async () => {
      await db.userWords.clear();
      await db.sessions.clear();
      if (data.userWords?.length) await db.userWords.bulkPut(data.userWords);
      if (data.sessions?.length) await db.sessions.bulkPut(data.sessions);
      if (data.achievements?.length) await db.achievements.bulkPut(data.achievements);
      if (data.customBanks?.length) await db.customBanks.bulkPut(data.customBanks);
      if (data.settings?.length) {
        await db.settings.clear();
        await db.settings.bulkPut(data.settings);
      }
    },
  );
  return { words: data.userWords?.length ?? 0, sessions: data.sessions?.length ?? 0 };
}

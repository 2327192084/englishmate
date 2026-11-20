import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, clearAllData } from '@/db';
import { checkAchievements, achievementProgress } from './achievements';
import { recordAttempt, saveSession } from './learning';
import { ACHIEVEMENTS } from '@/data/achievements';
import type { WordEntry } from '@/types';

const entry = (w: string): WordEntry => ({ w, t: `${w} 的释义` });

beforeEach(async () => {
  await clearAllData();
  await db.settings.clear();
});

describe('成就解锁', () => {
  it('全新用户不会解锁任何成就（还没练过）', async () => {
    const fresh = await checkAchievements();
    expect(fresh).toHaveLength(0);
  });

  it('完成第一次练习解锁「第一步」', async () => {
    await recordAttempt({ entry: entry('apple'), bankId: 'cet4', correct: true, mistakes: 0 });
    await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      attempts: [{ word: 'apple', correct: true, mistakes: 0, ms: 1000, bankId: 'cet4' }],
    });

    const fresh = await checkAchievements();
    expect(fresh).toContain('first-step');

    // 确实写进了数据库
    const saved = await db.achievements.get('first-step');
    expect(saved).toBeTruthy();
  });

  it('幂等：重复调用不会重复解锁', async () => {
    await recordAttempt({ entry: entry('apple'), bankId: 'cet4', correct: true, mistakes: 0 });
    await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      attempts: [{ word: 'apple', correct: true, mistakes: 0, ms: 1000, bankId: 'cet4' }],
    });

    const first = await checkAchievements();
    expect(first.length).toBeGreaterThan(0);

    const second = await checkAchievements();
    expect(second).toHaveLength(0);
  });

  it('进度查询返回正确总数', async () => {
    await recordAttempt({ entry: entry('apple'), bankId: 'cet4', correct: true, mistakes: 0 });
    await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      attempts: [{ word: 'apple', correct: true, mistakes: 0, ms: 1000, bankId: 'cet4' }],
    });
    await checkAchievements();

    const prog = await achievementProgress();
    expect(prog.total).toBe(ACHIEVEMENTS.length);
    expect(prog.unlocked).toBeGreaterThan(0);
    expect(prog.unlocked).toBeLessThanOrEqual(prog.total);
  });

  it('解锁的成就 id 必须都存在于定义表里', async () => {
    await recordAttempt({ entry: entry('apple'), bankId: 'cet4', correct: true, mistakes: 0 });
    await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      attempts: [{ word: 'apple', correct: true, mistakes: 0, ms: 1000, bankId: 'cet4' }],
    });
    const fresh = await checkAchievements();
    const known = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const id of fresh) expect(known.has(id)).toBe(true);
  });
});

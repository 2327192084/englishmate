/**
 * 集成测试：数据库 + 学习记录 + 出题队列的完整闭环。
 *
 * 这些测试跑在 fake-indexeddb 上，验证真实的数据流，
 * 而不是只看类型对不对——类型对了但逻辑错了的事太容易发生了。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getSettings, saveSettings, clearAllData, exportAllData, importAllData } from '@/db';
import {
  deriveRating,
  recordAttempt,
  saveSession,
  todayCounts,
  dueCount,
} from '@/services/learning';
import { buildRound } from '@/data/round';
import { createCard, isDue, schedule } from '@/lib/fsrs';
import type { WordEntry } from '@/types';

const entry = (w: string): WordEntry => ({ w, t: `${w} 的释义`, p: `/${w}/` });

beforeEach(async () => {
  await clearAllData();
  await db.settings.clear();
});

describe('设置持久化', () => {
  it('首次读取会写入默认值', async () => {
    const s = await getSettings();
    expect(s.id).toBe(1);
    expect(s.dailyNewTarget).toBe(20);
    const again = await getSettings();
    expect(again.dailyNewTarget).toBe(20);
  });

  it('更新后能读回，且不会丢其它字段', async () => {
    await saveSettings({ dailyNewTarget: 50, theme: 'light' });
    const s = await getSettings();
    expect(s.dailyNewTarget).toBe(50);
    expect(s.theme).toBe('light');
    expect(s.accent).toBe('en-US'); // 未改的字段保持默认
  });
});

describe('作答评分', () => {
  it('答错一律 Again', () => {
    expect(deriveRating(false, 0)).toBe(1);
    expect(deriveRating(false, 5)).toBe(1);
  });

  it('新词零失误封顶 Good，不会一步跳到 Easy', () => {
    // 新卡 state=new，Easy 会跳过 learning 步进，对刚认识的词太宽松
    const fresh = createCard(0);
    expect(deriveRating(true, 0, fresh)).toBe(3);
  });

  it('已进入 review 的卡片零失误给 Easy', () => {
    const reviewed = { ...createCard(0), state: 'review' as const, reps: 3 };
    expect(deriveRating(true, 0, reviewed)).toBe(4);
  });

  it('错误次数越多评分越低', () => {
    const reviewed = { ...createCard(0), state: 'review' as const, reps: 3 };
    expect(deriveRating(true, 1, reviewed)).toBe(3);
    expect(deriveRating(true, 3, reviewed)).toBe(2);
  });
});

describe('记录作答', () => {
  it('首次作答会建卡，并写入释义快照', async () => {
    const uw = await recordAttempt({
      entry: entry('apple'),
      bankId: 'cet4',
      correct: true,
      mistakes: 0,
    });
    expect(uw.id).toBe('cet4:apple');
    expect(uw.word).toBe('apple');
    expect(uw.trans).toBe('apple 的释义');
    expect(uw.phonetic).toBe('/apple/');
    expect(uw.corrects).toBe(1);
    expect(uw.mistakes).toBe(0);
    expect(uw.card.reps).toBe(1);
  });

  it('答错会累加 mistakes，是进错词本的依据', async () => {
    await recordAttempt({ entry: entry('banana'), bankId: 'cet4', correct: false, mistakes: 2 });
    const uw = await db.userWords.get('cet4:banana');
    expect(uw?.mistakes).toBeGreaterThan(0);
    expect(uw?.corrects).toBe(0);
  });

  it('多次作答会累积而不是覆盖', async () => {
    await recordAttempt({ entry: entry('cherry'), bankId: 'cet4', correct: true, mistakes: 0 });
    await recordAttempt({ entry: entry('cherry'), bankId: 'cet4', correct: true, mistakes: 0 });
    const uw = await db.userWords.get('cet4:cherry');
    expect(uw?.corrects).toBe(2);
    expect(uw?.card.reps).toBe(2);
  });

  it('同一个词在不同词库是两条独立记录', async () => {
    await recordAttempt({ entry: entry('order'), bankId: 'cet4', correct: true, mistakes: 0 });
    await recordAttempt({ entry: entry('order'), bankId: 'linux', correct: false, mistakes: 1 });
    expect(await db.userWords.count()).toBe(2);
    expect((await db.userWords.get('cet4:order'))?.mistakes).toBe(0);
    expect((await db.userWords.get('linux:order'))?.mistakes).toBeGreaterThan(0);
  });

  it('答对时把作答中的失误也计入 mistakes（用于错词本）', async () => {
    await recordAttempt({ entry: entry('grape'), bankId: 'cet4', correct: true, mistakes: 3 });
    const uw = await db.userWords.get('cet4:grape');
    // 打错过就该进错词本，即使最后答对
    expect(uw?.mistakes).toBe(3);
    expect(uw?.corrects).toBe(1);
  });

  it('错误分类跨次累加，而不是被最后一次覆盖', async () => {
    await recordAttempt({
      entry: entry('melon'),
      bankId: 'cet4',
      correct: false,
      mistakes: 2,
      mistakeKinds: { order: 1, adjacent: 1, similar: 0, unrelated: 0 },
    });
    await recordAttempt({
      entry: entry('melon'),
      bankId: 'cet4',
      correct: false,
      mistakes: 1,
      mistakeKinds: { order: 0, adjacent: 0, similar: 1, unrelated: 0 },
    });
    const uw = await db.userWords.get('cet4:melon');
    expect(uw?.mistakeKinds).toEqual({ order: 1, adjacent: 1, similar: 1, unrelated: 0 });
  });

  it('没传分类时保留已有分类，不写成全零', async () => {
    await recordAttempt({
      entry: entry('olive'),
      bankId: 'cet4',
      correct: false,
      mistakes: 1,
      mistakeKinds: { order: 0, adjacent: 2, similar: 0, unrelated: 0 },
    });
    // 辨认模式之类的作答没有字符级分类
    await recordAttempt({ entry: entry('olive'), bankId: 'cet4', correct: false, mistakes: 1 });
    const uw = await db.userWords.get('cet4:olive');
    expect(uw?.mistakeKinds?.adjacent).toBe(2);
  });

  it('老记录（没有 mistakeKinds 字段）也能正常累加分类', async () => {
    // 模拟本功能上线前写下的记录：先手工塞一条不带分类的
    const legacy = await recordAttempt({
      entry: entry('peach'),
      bankId: 'cet4',
      correct: false,
      mistakes: 1,
    });
    expect(legacy.mistakeKinds).toBeUndefined();
    await recordAttempt({
      entry: entry('peach'),
      bankId: 'cet4',
      correct: false,
      mistakes: 1,
      mistakeKinds: { order: 0, adjacent: 0, similar: 0, unrelated: 1 },
    });
    const uw = await db.userWords.get('cet4:peach');
    // 历史误差数保留，分类从 0 起算
    expect(uw?.mistakes).toBe(2);
    expect(uw?.mistakeKinds).toEqual({ order: 0, adjacent: 0, similar: 0, unrelated: 1 });
  });
});

describe('会话落库', () => {
  it('WPM / 正确率 / 一次通过数按击键算', async () => {
    const startedAt = 1_000_000;
    const s = await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt,
      endedAt: startedAt + 60_000,
      attempts: [
        // 5 字符、0 失误 → 干净通过
        { word: 'apple', correct: true, mistakes: 0, ms: 1000, bankId: 'cet4' },
        // 6 字符、2 失误 → 答对但不干净
        { word: 'banana', correct: true, mistakes: 2, ms: 1000, bankId: 'cet4' },
        // 7 字符、未答对
        { word: 'cherry', correct: false, mistakes: 1, ms: 1000, bankId: 'cet4' },
      ],
    });

    expect(s.total).toBe(3);
    expect(s.perfect).toBe(1);
    expect(s.correct).toBe(2);
    // 正确字符 5(apple)+6(banana)+6(cherry)=17，错误 0+2+1=3，总击键 20
    expect(s.correctKeystrokes).toBe(17);
    expect(s.keystrokes).toBe(20);
    expect(s.durationSec).toBe(60);
    // 17/5/1 = 3.4 → 向下取整 3
    expect(s.wpm).toBe(3);
    expect(s.accuracy).toBeCloseTo(17 / 20, 5);
    // 只有出问题的词进 words
    expect(s.words).toEqual(['banana', 'cherry']);
    expect(s.id).toBeGreaterThan(0);
  });

  it('同一时刻开始结束不会除零', async () => {
    const s = await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt: 1000,
      endedAt: 1000,
      attempts: [{ word: 'a', correct: true, mistakes: 0, ms: 1, bankId: 'cet4' }],
    });
    expect(Number.isFinite(s.wpm)).toBe(true);
    expect(s.wpm).toBeGreaterThanOrEqual(0);
  });
});

describe('今日统计', () => {
  it('新建的词算作今日新词', async () => {
    await recordAttempt({ entry: entry('today1'), bankId: 'cet4', correct: true, mistakes: 0 });
    await recordAttempt({ entry: entry('today2'), bankId: 'cet4', correct: true, mistakes: 0 });
    const c = await todayCounts();
    expect(c.todayNew).toBe(2);
  });

  it('昨天的词不算今日新词', async () => {
    const yesterday = Date.now() - 2 * 86400000;
    await recordAttempt({
      entry: entry('old'),
      bankId: 'cet4',
      correct: true,
      mistakes: 0,
      now: yesterday,
    });
    const c = await todayCounts();
    expect(c.todayNew).toBe(0);
  });
});

describe('到期统计', () => {
  it('只有卡片 due 已过的词算到期', async () => {
    const now = Date.now();
    // 一张立即到期的卡
    await db.userWords.put({
      id: 'cet4:dueWord',
      bankId: 'cet4',
      word: 'dueWord',
      trans: '到期',
      mistakes: 0,
      corrects: 0,
      favorite: false,
      mastered: false,
      card: { ...createCard(0), due: now - 1000 },
      createdAt: 0,
      updatedAt: 0,
    });
    // 一张远期才到期的卡
    await db.userWords.put({
      id: 'cet4:laterWord',
      bankId: 'cet4',
      word: 'laterWord',
      trans: '以后',
      mistakes: 0,
      corrects: 0,
      favorite: false,
      mastered: false,
      card: { ...createCard(0), due: now + 10 * 86400000 },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(await dueCount()).toBe(1);
    expect(await dueCount('cet4')).toBe(1);
    expect(await dueCount('gre')).toBe(0);
  });

  it('已掌握的词不算到期', async () => {
    await db.userWords.put({
      id: 'cet4:done',
      bankId: 'cet4',
      word: 'done',
      trans: '已掌握',
      mistakes: 0,
      corrects: 5,
      favorite: false,
      mastered: true,
      card: { ...createCard(0), due: 0 },
      createdAt: 0,
      updatedAt: 0,
    });
    expect(await dueCount()).toBe(0);
  });
});

describe('端到端：练习 → 落库 → 出题', () => {
  it('答错的词下一轮会被优先拉回来', async () => {
    // 模拟 8 个词的一轮，其中 3 个打错了
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
    const all = words.map(entry);
    const now = Date.now();

    for (let i = 0; i < words.length; i++) {
      const wrong = i < 3;
      await recordAttempt({
        entry: all[i],
        bankId: 'cet4',
        correct: !wrong,
        mistakes: wrong ? 2 : 0,
        now,
      });
    }

    const stored = await db.userWords.toArray();
    const known = new Map(stored.map((w) => [w.word.toLowerCase(), w]));
    const wrongOnes = stored.filter((w) => w.mistakes > 0).map((w) => w.word);
    expect(wrongOnes).toHaveLength(3);

    // 出题：错词额度为 0，但错词仍应被提前干预
    const plan = buildRound({
      bankId: 'cet4',
      allWords: all,
      known,
      size: 5,
      newQuota: 0,
      mode: 'typing',
      now,
    });

    const picked = plan.entries.map((e) => e.w);
    expect(picked.length).toBeGreaterThan(0);
    // 至少要有错词被捞回来
    const recovered = picked.filter((w) => wrongOnes.includes(w));
    expect(recovered.length).toBeGreaterThan(0);
  });

  it('答对的词不会立刻重新出现在新词队列里', async () => {
    const all = [entry('solo')];
    await recordAttempt({ entry: all[0], bankId: 'cet4', correct: true, mistakes: 0 });

    const stored = await db.userWords.toArray();
    const known = new Map(stored.map((w) => [w.word.toLowerCase(), w]));
    const plan = buildRound({
      bankId: 'cet4',
      allWords: all,
      known,
      size: 5,
      newQuota: 0,
      mode: 'typing',
      now: Date.now(),
    });
    // 已学且未到期，newQuota=0 → 不该作为新词出现
    expect(plan.reasons.get('solo')).not.toBe('new');
  });
});

describe('备份与恢复', () => {
  it('导出再导入能还原词与历史', async () => {
    await recordAttempt({ entry: entry('backup1'), bankId: 'cet4', correct: true, mistakes: 0 });
    await saveSession({
      mode: 'typing',
      bankId: 'cet4',
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      attempts: [{ word: 'backup1', correct: true, mistakes: 0, ms: 1000, bankId: 'cet4' }],
    });
    const json = await exportAllData();
    const before = await db.userWords.count();

    await clearAllData();
    expect(await db.userWords.count()).toBe(0);

    const r = await importAllData(json);
    expect(r.words).toBe(before);
    expect(await db.userWords.count()).toBe(before);
    expect((await db.userWords.get('cet4:backup1'))?.word).toBe('backup1');
  });

  it('拒绝非 EnglishMate 的备份文件', async () => {
    await expect(importAllData('{"app":"something-else"}')).rejects.toThrow();
    await expect(importAllData('not json')).rejects.toThrow();
  });

  /**
   * customArticles 曾经三处都没覆盖（clear / export / import），
   * 表现为：用户导入的文章在「导出→换机器恢复」后凭空消失，且没有任何报错。
   * 下面三条分别钉住这三处。
   */
  it('自定义文章参与导出与导入', async () => {
    await db.customArticles.put({
      id: 'art-1',
      title: 'My Article',
      titleZh: '我的文章',
      level: 'CET-4',
      author: '',
      sentences: [{ en: 'Hello world.', zh: '你好世界。' }],
      source: '导入自 test.txt',
      createdAt: Date.now(),
    });

    const json = await exportAllData();
    expect(JSON.parse(json).customArticles).toHaveLength(1);

    await clearAllData();
    expect(await db.customArticles.count()).toBe(0);

    await importAllData(json);
    expect(await db.customArticles.count()).toBe(1);
    expect((await db.customArticles.get('art-1'))?.titleZh).toBe('我的文章');
  });

  it('清空数据会一并清掉自定义文章', async () => {
    await db.customArticles.put({
      id: 'art-2',
      title: 'T',
      titleZh: 'T',
      level: 'CET-4',
      author: '',
      sentences: [],
      source: '',
      createdAt: Date.now(),
    });
    expect(await db.customArticles.count()).toBe(1);
    await clearAllData();
    expect(await db.customArticles.count()).toBe(0);
  });

  /**
   * 向后兼容：旧备份（version 1）没有 customArticles 字段。
   * 从旧备份恢复时不能把用户现有的自定义文章清掉——
   * 「字段缺失」（旧格式，保留现状）和「字段为空数组」（用户确实清空过）
   * 是两件不同的事，这条用例专门锁住这个区别。
   */
  it('从旧格式备份恢复时不会清掉现有的自定义文章', async () => {
    await db.customArticles.put({
      id: 'art-3',
      title: 'Keep me',
      titleZh: '留着我',
      level: 'CET-4',
      author: '',
      sentences: [],
      source: '',
      createdAt: Date.now(),
    });

    // 模拟 2026-11-21 之前的导出：有 app 标记，但没有 customArticles
    const legacy = JSON.stringify({
      app: 'englishmate',
      version: 1,
      exportedAt: new Date().toISOString(),
      userWords: [],
      sessions: [],
      settings: [],
      achievements: [],
      customBanks: [],
    });
    await importAllData(legacy);

    expect(await db.customArticles.count()).toBe(1);
    expect((await db.customArticles.get('art-3'))?.titleZh).toBe('留着我');
  });

  it('备份里 customArticles 是空数组时按"用户确实清空"处理', async () => {
    await db.customArticles.put({
      id: 'art-4',
      title: 'Drop me',
      titleZh: '删掉我',
      level: 'CET-4',
      author: '',
      sentences: [],
      source: '',
      createdAt: Date.now(),
    });
    const json = JSON.stringify({
      app: 'englishmate',
      version: 2,
      customArticles: [],
      userWords: [],
      sessions: [],
    });
    await importAllData(json);
    expect(await db.customArticles.count()).toBe(0);
  });
});

describe('FSRS 与记录联动', () => {
  it('连续答对会让间隔变长', async () => {
    let now = 1_000_000_000;
    let prevInterval = 0;
    const intervals: number[] = [];

    for (let i = 0; i < 5; i++) {
      await recordAttempt({
        entry: entry('growth'),
        bankId: 'cet4',
        correct: true,
        mistakes: 0,
        now,
      });
      const uw = await db.userWords.get('cet4:growth');
      if (!uw) throw new Error('卡丢了');
      const interval = (uw.card.due - now) / 86400000;
      if (i >= 1) {
        expect(interval).toBeGreaterThanOrEqual(prevInterval);
      }
      prevInterval = interval;
      intervals.push(interval);
      now = uw.card.due; // 到期后再复习
    }
    // 间隔整体是增长的：最后一次应显著大于第一次
    expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0]);
  });

  it('答错的词会进入 relearning 且 lapses 增加', async () => {
    const now = 1_000_000_000;
    // 先让它毕业到 review
    const graduated = schedule(schedule(createCard(now), 3, now), 3, now + 60_000);
    await db.userWords.put({
      id: 'cet4:lapse',
      bankId: 'cet4',
      word: 'lapse',
      trans: '遗忘',
      mistakes: 0,
      corrects: 3,
      favorite: false,
      mastered: false,
      card: { ...graduated, state: 'review' },
      createdAt: now,
      updatedAt: now,
    });

    await recordAttempt({
      entry: entry('lapse'),
      bankId: 'cet4',
      correct: false,
      mistakes: 1,
      now: now + 86400000,
    });
    const uw = await db.userWords.get('cet4:lapse');
    expect(uw?.card.lapses).toBeGreaterThan(0);
    expect(uw?.card.state).toBe('relearning');
  });

  it('任何作答后卡片都是有效的到期状态', async () => {
    const r = await recordAttempt({
      entry: entry('valid'),
      bankId: 'cet4',
      correct: true,
      mistakes: 0,
    });
    expect(Number.isFinite(r.card.due)).toBe(true);
    expect(r.card.stability).toBeGreaterThan(0);
    expect(r.card.difficulty).toBeGreaterThanOrEqual(1);
    expect(r.card.difficulty).toBeLessThanOrEqual(10);
    expect(typeof isDue(r.card)).toBe('boolean');
  });
});

/**
 * 成就系统。规则简单、可解释，不要做成隐藏成就那种玄学。
 */
import type { AchievementContext, AchievementDef } from '@/types';

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-step',
    name: '第一步',
    description: '完成第一次练习',
    icon: '🌱',
    check: (c) => c.totalSessions >= 1,
  },
  {
    id: 'hundred',
    name: '百词斩',
    description: '累计练习 100 个词次',
    icon: '💯',
    check: (c) => c.totalWords >= 100,
  },
  {
    id: 'thousand',
    name: '千词',
    description: '累计练习 1000 个词次',
    icon: '📚',
    check: (c) => c.totalWords >= 1000,
  },
  {
    id: 'streak-3',
    name: '三日不辍',
    description: '连续练习 3 天',
    icon: '🔥',
    check: (c) => c.streak >= 3,
  },
  {
    id: 'streak-7',
    name: '一周不断',
    description: '连续练习 7 天',
    icon: '🔥',
    check: (c) => c.streak >= 7,
  },
  {
    id: 'streak-30',
    name: '月度养成',
    description: '连续练习 30 天',
    icon: '🏅',
    check: (c) => c.streak >= 30,
  },
  {
    id: 'wpm-40',
    name: '手感来了',
    description: '最佳 WPM 达到 40',
    icon: '⌨️',
    check: (c) => c.bestWpm >= 40,
  },
  {
    id: 'wpm-60',
    name: '快过脑子',
    description: '最佳 WPM 达到 60',
    icon: '⚡',
    check: (c) => c.bestWpm >= 60,
  },
  {
    id: 'wpm-80',
    name: '键盘手',
    description: '最佳 WPM 达到 80',
    icon: '🚀',
    check: (c) => c.bestWpm >= 80,
  },
  {
    id: 'accuracy-95',
    name: '一丝不苟',
    description: '单轮正确率达到 95%',
    icon: '🎯',
    /**
     * 判定条件有三重，缺一不可：
     *  1. 至少练过一轮 —— 没有练习时 accuracy 按约定返回 1（避免除零），
     *     不判这个的话全新用户一打开 App 就白得成就；
     *  2. 累计至少 100 词次 —— 只练 5 个词全对就发"一丝不苟"太廉价，
     *     这类成就的意义是"长期稳定"，需要足够样本量支撑；
     *  3. 正确率 ≥ 95%。
     */
    check: (c) => c.totalSessions > 0 && c.totalWords >= 100 && c.accuracy >= 0.95,
  },
  {
    id: 'mastered-50',
    name: '滚瓜烂熟',
    description: '掌握 50 个词',
    icon: '🌳',
    check: (c) => c.masteredCount >= 50,
  },
  {
    id: 'mastered-500',
    name: '词海泛舟',
    description: '掌握 500 个词',
    icon: '🌊',
    check: (c) => c.masteredCount >= 500,
  },
  {
    id: 'keys-10000',
    name: '万键',
    description: '累计击键 10000 次',
    icon: '✋',
    check: (c) => c.totalKeystrokes >= 10000,
  },
  {
    id: 'keys-100000',
    name: '十万键',
    description: '累计击键 100000 次',
    icon: '🏆',
    check: (c) => c.totalKeystrokes >= 100000,
  },
];

export const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** 返回本次新解锁的成就 id 列表 */
export function evaluate(ctx: AchievementContext, unlocked: Set<string>): string[] {
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.id)) continue;
    if (a.check(ctx)) fresh.push(a.id);
  }
  return fresh;
}

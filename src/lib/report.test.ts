import { describe, expect, it } from 'vitest';
import { renderReportFromRaw, renderReportSvg, type ReportData } from './report';
import type { PracticeSession, UserWord } from '@/types';

const T0 = 1_700_000_000_000;

function session(over: Partial<PracticeSession> = {}): PracticeSession {
  return {
    startedAt: T0,
    endedAt: T0 + 60_000,
    mode: 'typing',
    bankId: 'cet4',
    total: 10,
    perfect: 8,
    correct: 9,
    keystrokes: 100,
    correctKeystrokes: 90,
    wpm: 30,
    accuracy: 0.9,
    durationSec: 60,
    words: [],
    ...over,
  };
}

function userWord(word: string, over: Partial<UserWord> = {}): UserWord {
  return {
    id: `cet4:${word}`,
    bankId: 'cet4',
    word,
    trans: '释义',
    mistakes: 0,
    corrects: 1,
    favorite: false,
    mastered: false,
    card: {
      due: T0,
      stability: 1,
      difficulty: 5,
      scheduledDays: 1,
      reps: 1,
      lapses: 0,
      state: 'review',
      lastReview: T0,
      learningStep: 0,
    },
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

const emptyData: ReportData = {
  overview: {
    totalSessions: 0,
    totalWords: 0,
    totalKeystrokes: 0,
    bestWpm: 0,
    avgWpm: 0,
    accuracy: 1,
    streak: 0,
    longestStreak: 0,
    masteredCount: 0,
    wrongCount: 0,
    favoriteCount: 0,
    dueCount: 0,
    todayNew: 0,
    todayReviewed: 0,
  },
  daily: [],
  streak: 0,
  longestStreak: 0,
  generatedAt: T0,
  bankTop: [],
  learnedWords: 0,
};

describe('学习报告 SVG', () => {
  it('无数据时也能生成合法 SVG，且提示"还没有练习记录"', () => {
    const svg = renderReportSvg(emptyData);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
    expect(svg).toContain('还没有练习记录');
    // 标签配对粗略校验
    expect((svg.match(/<svg/g) || []).length).toBe(1);
  });

  it('含核心指标文本', () => {
    const svg = renderReportFromRaw([session()], [userWord('apple')]);
    expect(svg).toContain('EnglishMate · 学习报告');
    expect(svg).toContain('连续天数');
    expect(svg).toContain('最佳 WPM');
    expect(svg).toContain('正确率');
    expect(svg).toContain('累计练习');
  });

  it('有进度时渲染趋势曲线', () => {
    const sessions = [
      session({ startedAt: T0, endedAt: T0 + 60_000, wpm: 20 }),
      session({ startedAt: T0 + 86400000, endedAt: T0 + 86400000 + 60_000, wpm: 35 }),
    ];
    const svg = renderReportFromRaw(sessions, [userWord('apple')]);
    // 曲线用 path 表示
    expect(svg).toContain('<path d="M');
    expect(svg).toContain('峰值');
  });

  it('XML 特殊字符被转义，不会破坏结构', () => {
    const data: ReportData = {
      ...emptyData,
      bankTop: [{ bankId: 'a<b>&"c', learned: 5, mastered: 1 }],
    };
    const svg = renderReportSvg(data);
    // 原始尖括号不该出现在文本内容里
    expect(svg).not.toContain('a<b>');
    // 转义后应该存在
    expect(svg).toContain('&lt;');
    // 仍然是一个闭合的 SVG
    expect(svg).toContain('</svg>');
  });

  it('自定义词库显示为"自定义"而非长 id', () => {
    const data: ReportData = {
      ...emptyData,
      bankTop: [{ bankId: 'custom:u1234567890abcdef', learned: 3, mastered: 0 }],
    };
    const svg = renderReportSvg(data);
    expect(svg).toContain('自定义');
    expect(svg).not.toContain('u1234567890abcdef');
  });

  it('只有一轮数据时曲线也能画（单点不除零）', () => {
    const svg = renderReportFromRaw([session()], []);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    // 不该出现 NaN
    expect(svg).not.toContain('NaN');
  });

  it('空数据不产生 NaN', () => {
    const svg = renderReportSvg(emptyData);
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });

  it('大量会话不会让数值溢出', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      session({
        startedAt: T0 + i * 86400000,
        endedAt: T0 + i * 86400000 + 120_000,
        wpm: 20 + (i % 40),
      }),
    );
    const svg = renderReportFromRaw(many, []);
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('最近 30 天');
  });

  it('掌握率用学过的总词数作分母，不是「已掌握+错词」', () => {
    // 场景：学过 100 词，其中 40 已掌握、0 个错词
    // 错误实现会算出 40/(40+0)=100%；正确应为 40/100=40%
    const words = Array.from({ length: 100 }, (_, i) => userWord('w' + i, { mastered: i < 40 }));
    const data: ReportData = {
      ...emptyData,
      overview: { ...emptyData.overview, masteredCount: 40, wrongCount: 0 },
      learnedWords: 100,
    };
    const svg = renderReportSvg(data);
    // 掌握进度处应是 40%（注意：正确率那块空数据时也是 100%，所以
    // 只验证"存在 40%"和底部文案，不全局否定 100%）
    expect(svg).toContain('40%');
    expect(svg).toContain('学过 100');
    expect(svg).toContain('已掌握 40');
    void words;
  });
});

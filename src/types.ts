/**
 * EnglishMate · 全局共享类型
 *
 * 约定：本文件是全项目的类型契约，任何模块都从这里取类型，避免循环依赖。
 */

/** ---------- 词库 ---------- */

/** 单个词条。字段刻意用短名，词库 JSON 体积可小一半。 */
export interface WordEntry {
  /** 单词本身，如 "cancel" */
  w: string;
  /** 释义，多条用 "；" 连接，如 "取消，撤销；删去" */
  t: string;
  /** 音标（美音优先），可能是空字符串 */
  p?: string;

  /* ── 以下为可选富字段 ─────────────────────────────────────────────
   * 全部可选：旧词库只有 w/t/p 也能正常用，界面按存在性决定显示什么。
   * 这样"内容增强"是渐进式的，不会因为某个词库数据不全就崩掉。
   */

  /** 英式音标（与 p 并列时 p 视为美音） */
  pUk?: string;
  /** 词性 + 释义的细分，比 t 更精确 */
  defs?: WordDef[];
  /** 例句（含译文） */
  sentences?: WordPair[];
  /** 短语搭配 */
  phrases?: WordPair[];
  /** 近义词 */
  synos?: WordSyno[];
  /** 同根词 */
  relWords?: string[];
}

/**
 * 词关系（来自 word-graph.json，由 build-word-graph.mjs 从 ECDICT 挖出，
 * 覆盖约 1.5 万词）。
 *
 * 为什么不塞进 WordEntry：词库是按需加载的，把这份关系复制进 16 个词库
 * 文件会让体积翻几倍且大量重复。独立文件只下载一次，所有词库共用。
 *
 * 字段用单字母纯粹是为了控制文件体积。
 */
export interface WordRelation {
  /** 词形变化：abandon → abandoned / abandoning / abandons */
  f?: string[];
  /** 形近易混词：adapt → adopt / adept */
  l?: string[];
}

/** 一条带词性的释义 */
export interface WordDef {
  /** 词性，如 n. / v. / adj. */
  pos: string;
  /** 中文释义 */
  cn: string;
}

/** 英文 + 中文的成对内容（例句、短语） */
export interface WordPair {
  /** 英文原文 */
  en: string;
  /** 中文译文 */
  zh: string;
}

/** 近义词组 */
export interface WordSyno {
  pos: string;
  cn: string;
  words: string[];
}

/** 词条是否具备富内容（用于界面判断要不要显示"详情"入口） */
export function hasRichContent(entry: WordEntry): boolean {
  return !!(
    entry.defs?.length ||
    entry.sentences?.length ||
    entry.phrases?.length ||
    entry.synos?.length ||
    entry.relWords?.length
  );
}

export type WordbankCategory = 'exam' | 'programming' | 'basic';

export interface WordbankMeta {
  /** 稳定 id，如 "cet4"，用于路由与本地存储 */
  id: string;
  /** 显示名，如 "CET-4 四级核心" */
  name: string;
  category: WordbankCategory;
  /** 一句话描述 */
  description: string;
  /** 词条数量 */
  count: number;
  /** 数据来源说明（许可与出处，开源项目必须标清楚） */
  source: string;
}

/** ---------- 练习 ---------- */

/**
 * 四种练习模式：
 * - typing     跟打：看单词 + 释义，逐字符敲出来
 * - dictation  听写：只放发音，听音拼写
 * - recall     默写：只给中文释义，写出单词
 * - choice     辨认：四选一快速过词（不计 WPM，计正确率）
 */
export type PracticeMode = 'typing' | 'dictation' | 'recall' | 'choice';

/**
 * 练习方式（原来叫"流程模板"）。
 *
 * 这是**唯一**的练法选择器，取代了原先并列的「练习模式」+「练习流程」。
 * 每个方式都是一条完整练法，由 1~3 个步骤组成：
 *
 *   组合式（同一批词层层抽线索，推荐）
 *     listenWrite   跟打 → 默写
 *     fullChain     跟打 → 默写 → 听写
 *   单一式（整批词过一遍）
 *     followOnly    只跟打
 *     dictationOnly 只听写
 *     recallOnly    只默写
 *     choice        只辨认（四选一）
 */
export type FlowPresetId =
  'followOnly' | 'listenWrite' | 'fullChain' | 'dictationOnly' | 'recallOnly' | 'choice';

export interface ModeMeta {
  id: PracticeMode;
  name: string;
  /** 卡片上的一句话说明 */
  hint: string;
  /** 是否统计打字速度 */
  tracksSpeed: boolean;
}

/** ---------- 单次练习会话 ---------- */

/** 一次练习中单个词的作答记录 */
export interface WordAttempt {
  word: string;
  /** 是否正确（默写/听写/辨认口径：最终是否答对） */
  correct: boolean;
  /** 本次错误按键次数 */
  mistakes: number;
  /** 作答耗时，毫秒 */
  ms: number;
  /** 该词所属词库 */
  bankId: string;
}

/** 一次完整的练习会话，落库后用于统计与历史 */
export interface PracticeSession {
  /** 自增主键 */
  id?: number;
  /** 开始时间戳 */
  startedAt: number;
  /** 结束时间戳 */
  endedAt: number;
  mode: PracticeMode;
  bankId: string;
  /** 练习词数 */
  total: number;
  /** 一次通过（无错误）的词数 */
  perfect: number;
  /** 最终答对的词数 */
  correct: number;
  /** 总计击键数（正确 + 错误） */
  keystrokes: number;
  /** 正确击键数 */
  correctKeystrokes: number;
  /** 每分钟词数 */
  wpm: number;
  /** 正确率 0..1 */
  accuracy: number;
  /** 秒 */
  durationSec: number;
  /** 涉及到的词（只存答错的和首次学习的，避免数据膨胀） */
  words: string[];
}

/** ---------- 学习状态（与 FSRS 卡片合并存储） ---------- */

export type WordStage = 'new' | 'learning' | 'review' | 'mastered';

export interface UserWord {
  /** 主键：`${bankId}:${word}` */
  id: string;
  bankId: string;
  word: string;
  /** 释义快照，错词本列表用 */
  trans: string;
  /** 音标快照 */
  phonetic?: string;
  /** 累计错误次数（> 0 即视为进错词本） */
  mistakes: number;
  /** 答对次数 */
  corrects: number;
  /** 是否收藏 */
  favorite: boolean;
  /** 是否手动标记已掌握 */
  mastered: boolean;
  /** FSRS 卡片状态（序列化后存） */
  card: SerializedCard;
  /** 首次学习时间 */
  createdAt: number;
  /** 最后一次作答时间 */
  updatedAt: number;
}

/** FSRS 卡片的可序列化形态（day 均为毫秒时间戳） */
export interface SerializedCard {
  /** 到期时间戳 */
  due: number;
  /** 稳定度（天） */
  stability: number;
  /** 难度 1..10 */
  difficulty: number;
  /** 上次复习后的间隔（天） */
  scheduledDays: number;
  /** 复习次数 */
  reps: number;
  /** 遗忘次数 */
  lapses: number;
  /** 状态机 */
  state: 'new' | 'learning' | 'review' | 'relearning';
  /** 上次复习时间戳，null 表示从未复习 */
  lastReview: number | null;
  /** 学习阶段的步进索引 */
  learningStep: number;
}

/** ---------- 设置 ---------- */

export type Accent = 'en-US' | 'en-GB';

export interface Settings {
  /** 主键，固定 1（单用户） */
  id?: number;
  /** 每日新词目标 */
  dailyNewTarget: number;
  /** 每日复习上限 */
  dailyReviewLimit: number;
  /** 发音口音 */
  accent: Accent;
  /** 语速 0.5..1.5 */
  speechRate: number;
  /** 键盘音效 */
  keySound: boolean;
  /** 音效音量 0..1 */
  keyVolume: number;
  /** 自动发音（进入每个词时朗读） */
  autoSpeak: boolean;
  /** 主题 */
  theme: 'dark' | 'light';
  /** 练习时是否强制纠正错误（错误必须退格改对才能继续） */
  strictCorrection: boolean;
  /** 每轮词数 */
  roundSize: number;
  /**
   * 练习流程模板。
   * 默认 listenWrite：一组词先跟打、立刻默写，比"每个词只过一遍"记得牢。
   */
  flowPreset: FlowPresetId;
  /** 分组大小（流程为分组循环时生效），默认 7 */
  groupSize: number;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'id'> = {
  dailyNewTarget: 20,
  dailyReviewLimit: 100,
  accent: 'en-US',
  speechRate: 0.9,
  keySound: false,
  keyVolume: 0.3,
  autoSpeak: true,
  theme: 'dark',
  strictCorrection: true,
  roundSize: 20,
  flowPreset: 'listenWrite',
  groupSize: 7,
};

/** ---------- 文章 ---------- */

export interface ArticleSentence {
  /** 英文原句 */
  en: string;
  /** 中文译文 */
  zh: string;
}

export interface Article {
  id: string;
  title: string;
  /** 中文标题 */
  titleZh: string;
  /** 难度标签，如 "CET-4" */
  level: string;
  /** 作者 / 出处 */
  author: string;
  sentences: ArticleSentence[];
  /** 来源与许可说明 */
  source: string;
}

/** ---------- 成就 ---------- */

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** 一个 emoji 就够，不引图标库 */
  icon: string;
  /** 达成判定 */
  check: (ctx: AchievementContext) => boolean;
}

export interface AchievementContext {
  totalSessions: number;
  totalWords: number;
  streak: number;
  bestWpm: number;
  accuracy: number;
  masteredCount: number;
  totalKeystrokes: number;
}

export interface UnlockedAchievement {
  id: string;
  unlockedAt: number;
}

/** ---------- 统计聚合 ---------- */

export interface DailyStat {
  /** YYYY-MM-DD（本地时区） */
  date: string;
  /** 当日练习会话数 */
  sessions: number;
  /** 当日练习词数 */
  words: number;
  /** 当日击键数 */
  keystrokes: number;
  /** 当日最佳 WPM */
  bestWpm: number;
  /** 当日正确率 */
  accuracy: number;
  /** 当日学习分钟数 */
  minutes: number;
}

export interface OverviewStats {
  totalSessions: number;
  totalWords: number;
  totalKeystrokes: number;
  bestWpm: number;
  avgWpm: number;
  accuracy: number;
  streak: number;
  longestStreak: number;
  masteredCount: number;
  wrongCount: number;
  favoriteCount: number;
  /** 待复习数量 */
  dueCount: number;
  /** 今日已学新词 */
  todayNew: number;
  /** 今日已复习 */
  todayReviewed: number;
}

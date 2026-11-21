/**
 * 窄式精听：同一批句子反复听，每轮抽掉一层提示，最后做一次考核。
 *
 * ── 为什么是这个形态（而不是 100LS）──────────────────────────────────────
 * 100LS 唯一有机制的部分是「前三遍的字幕梯度」：先无字幕、再中文字幕、
 * 再英文字幕。它的失败点在于把这个梯度绑在「一部电影 100 遍」上——
 * 素材门槛高（要用户先找一部 2GB 的电影）、完成率极低（多数人在第 10 遍放弃）。
 *
 * 这里保留梯度、去掉「100 遍」这个营销数字：
 * 用应用里**现成的**句子里挑一批，按 4 轮走完梯度。一批 10 句、4 轮 = 40 次播放，
 * 一次会话做完，不存在「永远到不了的终点」。
 *
 * ── 为什么是「同一批反复听」而不是「听很多不同的句子」────────────────────
 * 这是窄式输入（narrow input）的核心：同一主题/同一批材料的词汇和句式反复复现，
 * 理解难度下降而习得上升。换来换去地听新材料，每句都是新的词汇负担。
 *
 * ── 为什么不能自动翻页 ──────────────────────────────────────────────────
 * Web Speech 没有「查这段要播多久」的 API（见 learning-method-plan 1.3 的实测），
 * 所以无法知道一轮播放何时结束。翻页只能由用户点「下一句」驱动。
 * 这不是偷懒，是平台能力的硬边界——别试图用 setTimeout 猜时长。
 *
 * ── 关于考核的诚实边界（重要，别"优化"掉）───────────────────────────────
 * 考核有两种作答：**写英文原文** 与 **写中文翻译**。
 *
 *  - 英文原文：可以**客观判分**。用 `lib/sentenceDiff` 逐词对比，
 *    大小写/两端标点/撇号已按既有口径放宽，结果可信。
 *  - 中文翻译：**不能判分**。翻译有「信达雅」的性质，
 *    同一个句子十个译者十个说法，用字符串相似度判对错必然误伤
 *    （「他走了」与「他离开了」意思相同，重合度却是 0）。
 *
 * 所以中文模式下我们**只给参考译文 + 一个字符重合度作参考**，判对错交给用户自评。
 * `translationOverlap` 的返回值明确标成 `advisory`，
 * 调用方不许把它当判定用。将来接入 AI 判分时，
 * 把 `gradeQuiz` 的 `manual` 分支换成 `auto` 即可，上层不用改。
 *
 * 本文件是纯函数，不许引入 React / Dexie / speech 依赖。
 */
import { diffSentence, mistakeCount } from './sentenceDiff';

/**
 * 提示层级：这一轮里用户能看见什么。
 *  - none 看不到任何文字（盲听）
 *  - zh   只有中文译文
 *  - en   只有英文原文
 *  - both 中英并列
 */
export type CueLevel = 'none' | 'zh' | 'en' | 'both';

export interface ListenPass {
  /** 第几轮，0 起 */
  pass: number;
  cue: CueLevel;
  label: string;
  /** 界面上给用户的一句说明 */
  hint: string;
}

/**
 * 默认梯度。
 *
 * 顺序是刻意的：先盲听（逼大脑处理声音），再给中文（确认意思），
 * 再给英文（把声音和拼写对上），最后中英并列（建立一对一的映射）。
 * 反过来先给英文会让用户直接读，耳朵就没事可做了。
 */
export const DEFAULT_CUES: CueLevel[] = ['none', 'zh', 'en', 'both'];

const CUE_META: Record<CueLevel, { label: string; hint: string }> = {
  none: { label: '盲听', hint: '先不看文字，只听声音。听不懂没关系，这一轮的任务是让耳朵熟悉它。' },
  zh: { label: '看中文', hint: '现在给出中文。刚才没听清的地方，对照看看是不是你猜的那个意思。' },
  en: { label: '看英文', hint: '现在给出英文原文。把听到的声音和拼写对上。' },
  both: {
    label: '中英对照',
    hint: '最后一遍，中英并列。逐段核对「这句话是这个意思」——听懂靠的是这个映射，不是单词量。',
  },
};

/**
 * 生成轮次计划。
 *
 * rounds 小于 1 时按 1 处理：调用方传 0 是没有意义的，静默给出最少一轮
 * 比返回空数组更安全（空数组会让播放器出现「第 1/0 轮」这种界面）。
 */
export function buildPassPlan(rounds: number = DEFAULT_CUES.length): ListenPass[] {
  const total = Number.isFinite(rounds) ? Math.floor(rounds) : DEFAULT_CUES.length;
  const count = Math.max(1, total);
  const plan: ListenPass[] = [];
  for (let i = 0; i < count; i++) {
    const cue = DEFAULT_CUES[i % DEFAULT_CUES.length] ?? 'none';
    const meta = CUE_META[cue];
    plan.push({ pass: i, cue, label: meta.label, hint: meta.hint });
  }
  return plan;
}

/** 这一轮该显示什么文字。空串表示"有这一层但内容是空的"，null 表示"这一轮不给" */
export interface VisibleCue {
  en: string | null;
  zh: string | null;
}

/**
 * 按提示层级给出可见文字。
 *
 * 返回结构而不再是单个字符串：加了 both 之后必须能同时给出两层，
 * 单值返回做不到（拼在一起调用方就没法分别排版了）。
 */
export function visibleText(cue: CueLevel, en: string, zh: string): VisibleCue {
  switch (cue) {
    case 'en':
      return { en: en || '', zh: null };
    case 'zh':
      return { en: null, zh: zh || '' };
    case 'both':
      return { en: en || '', zh: zh || '' };
    default:
      return { en: null, zh: null };
  }
}

export interface ListenPosition {
  /** 第几轮，0 起 */
  pass: number;
  /** 本轮第几句，0 起 */
  index: number;
}

/**
 * 推进到下一句；本轮走完就回到第一句、进入下一轮。
 *
 * 返回 null 表示**整批已经听完**——调用方据此进入考核或结算。
 * 用 null 而不是抛错或返回特殊标记：调用方本来就要处理「听完了」这个分支。
 */
export function advance(
  pos: ListenPosition,
  sentenceCount: number,
  passCount: number,
): ListenPosition | null {
  if (sentenceCount <= 0 || passCount <= 0) return null;

  const nextIndex = pos.index + 1;
  if (nextIndex < sentenceCount) {
    return { pass: pos.pass, index: nextIndex };
  }
  const nextPass = pos.pass + 1;
  if (nextPass < passCount) {
    return { pass: nextPass, index: 0 };
  }
  return null;
}

/** 是否已经全部听完（用于界面判断，与 advance 的 null 保持同一口径） */
export function isFinished(pos: ListenPosition, sentenceCount: number, passCount: number): boolean {
  if (sentenceCount <= 0 || passCount <= 0) return true;
  return pos.pass >= passCount;
}

/**
 * 整批的完成度 0..100。
 *
 * 按「已播次数 / 总播次数」算，而不是按轮次算：4 轮里做完 3 轮多 3 句，
 * 按轮次算会显示 75%（看起来还剩一整轮），按次数算才是准确的 82.5%。
 */
export function progressPercent(
  pos: ListenPosition,
  sentenceCount: number,
  passCount: number,
): number {
  if (sentenceCount <= 0 || passCount <= 0) return 0;
  const total = sentenceCount * passCount;
  const done = pos.pass * sentenceCount + pos.index;
  return Math.min(100, Math.max(0, (done / total) * 100));
}

/**
 * 统计「这一句听了几遍」。
 *
 * 不限制次数（限制没有意义），只如实累加，供结算页展示——它是过程指标，不是目标。
 */
export function countListens(
  stats: Record<string, number>,
  pass: number,
  index: number,
): Record<string, number> {
  const key = `${pass}:${index}`;
  return { ...stats, [key]: (stats[key] ?? 0) + 1 };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 考核
 * ══════════════════════════════════════════════════════════════════════════ */

/** 考核作答方式：写英文原文 / 写中文翻译 */
export type QuizKind = 'en' | 'zh';

export const QUIZ_META: Record<QuizKind, { label: string; hint: string; placeholder: string }> = {
  en: {
    label: '写英文原文',
    hint: '听一句，把英文原句写出来。可以逐词判分，拼错会指出来。',
    placeholder: '听写这句英文，Enter 提交…',
  },
  zh: {
    label: '写中文翻译',
    hint: '听一句，用自己的话写下意思。翻译没有唯一答案，提交后对照参考译文自评。',
    placeholder: '写下你听到的意思，Enter 提交…',
  },
};

/**
 * 生成考核顺序：**打乱**。
 *
 * 按听的时候的顺序考，用户会靠记忆里「上一句是哪个」来猜，考不出听懂没有。
 * 打乱后每句都要独立处理声音。用传入的 rng 保证测试可复现。
 */
export function buildQuizOrder(count: number, rng: () => number = Math.random): number[] {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return [];
  const order = Array.from({ length: n }, (_, i) => i);
  // Fisher–Yates
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * 中文译文与参考译文的字符重合度（0..1）。
 *
 * ⚠️ **这不是判定，只是参考信息。**
 *
 * ── 算法与它为什么只能当参考 ─────────────────────────────────────────────
 * 先去掉标点、空白与**高频功能字**（的/了/是/在/我/你/他…），
 * 再看用户答案覆盖了多少参考译文里的字，以参考为分母
 * （多说了无关内容不该比漏掉核心词更严重——听力场景下漏核心词才是没听懂）。
 *
 * 滤掉功能字是必要的：不滤的话「他离开了」vs「他走了」会因为共用了
 * 「他」「了」而得到 0.67 的高分，看起来像"理解对了"，
 * 其实两个实词（离开/走）完全没重合。那种虚高比给 0 更误导。
 *
 * 即便如此，它依然**不能判对错**：翻译有信达雅，
 * 「他走了」与「他已经离开了」意思相同，字面重合度却是 0。
 * 拿它判错会持续误伤正确理解者。所以 `gradeQuiz` 只在 zh 模式
 * 把它当 `overlap` 参考值返回，判定交给用户自评。
 */
const ZH_STOP_CHARS = new Set(
  '的了着过是在有我你他她它们这那和与就都也还很太更最不没会能要可以一个些什么怎样吗呢吧啊把被给对从向到为以所之其而并且但如果因所以'.split(
    '',
  ),
);

export function translationOverlap(userText: string, refText: string): number {
  const pick = (s: string): Set<string> => {
    if (typeof s !== 'string') return new Set();
    const chars = s.replace(/[^\p{Script=Han}A-Za-z]/gu, '').toLowerCase();
    const out = new Set<string>();
    for (const ch of chars) {
      // 英文按字符算没有意义，但去重后仍能反映"提到了哪些字母"
      if (/\p{Script=Han}/u.test(ch) && ZH_STOP_CHARS.has(ch)) continue;
      out.add(ch);
    }
    return out;
  };
  const ref = pick(refText);
  if (ref.size === 0) return 0;
  const got = pick(userText);
  let hit = 0;
  for (const ch of ref) if (got.has(ch)) hit += 1;
  return hit / ref.size;
}

/**
 * 考核判定结果。
 *
 * 用可辨识联合而不是一个布尔：两种作答方式的可判定程度根本不同，
 * 硬塞进同一形状会让调用方误以为 zh 的结果和 en 一样可信。
 * 将来接入 AI 判分时，zh 也能返回 `auto`，上层代码不用改。
 */
export type QuizOutcome =
  | {
      kind: 'auto';
      correct: boolean;
      /** 逐词对比里判错的词数（en 模式有值） */
      mistakes: number;
    }
  | {
      kind: 'manual';
      /** 字符重合度 0..1，**仅供参照**，不是对错 */
      overlap: number;
      /** 界面必须原样展示这句提示，不能省略或改写 */
      note: string;
    };

const MANUAL_NOTE = '翻译没有唯一答案，参考译文只是其中一种。这次算不算听懂，由你自己判断。';

/**
 * 判分。
 *
 * en → 客观判分（复用 sentenceDiff 的既有口径：大小写、两端标点、撇号都放宽）
 * zh → 只算重合度，返回 manual，由用户自评
 */
export function gradeQuiz(
  kind: QuizKind,
  answer: string,
  item: { en: string; zh: string },
): QuizOutcome {
  const safe = typeof answer === 'string' ? answer : '';
  if (kind === 'en') {
    const diffs = diffSentence(item?.en ?? '', safe);
    const mistakes = mistakeCount(diffs);
    return { kind: 'auto', correct: mistakes === 0, mistakes };
  }
  return {
    kind: 'manual',
    overlap: translationOverlap(safe, item?.zh ?? ''),
    note: MANUAL_NOTE,
  };
}

/** 考核进度 0..100（按已答 / 总题数） */
export function quizProgress(answered: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const done = Math.max(0, Math.min(total, Number.isFinite(answered) ? answered : 0));
  return (done / total) * 100;
}

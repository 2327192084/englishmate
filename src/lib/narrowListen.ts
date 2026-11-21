/**
 * 窄式精听：同一批句子反复听，每轮抽掉一层提示。
 *
 * ── 为什么是这个形态（而不是 100LS）──────────────────────────────────────
 * 100LS 唯一有机制的部分是「前三遍的字幕梯度」：先无字幕、再中文字幕、
 * 再英文字幕。它的失败点在于把这个梯度绑在「一部电影 100 遍」上——
 * 素材门槛高（要用户先找一部 2GB 的电影）、完成率极低（多数人在第 10 遍放弃）。
 *
 * 这里保留梯度、去掉「100 遍」这个营销数字：
 * 用应用里**现成的**句子里挑一批，按 3 轮走完梯度。一批 10 句、3 轮 = 30 次播放，
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
 * 本文件是纯函数，不许引入 React / Dexie / speech 依赖。
 */

/**
 * 提示层级：这一轮里用户能看见什么。
 *  - none 只看/听不到任何文字（盲听）
 *  - zh   给中文译文
 *  - en   给英文原文
 */
export type CueLevel = 'none' | 'zh' | 'en';

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
 * 最后给英文（把声音和拼写对上）。反过来先给英文会让用户直接读，
 * 耳朵就没事可做了。
 */
export const DEFAULT_CUES: CueLevel[] = ['none', 'zh', 'en'];

const CUE_META: Record<CueLevel, { label: string; hint: string }> = {
  none: { label: '盲听', hint: '先不看文字，只听声音。听不懂没关系，这一轮的任务是让耳朵熟悉它。' },
  zh: { label: '看中文', hint: '现在给出中文。刚才没听清的地方，对照看看是不是你猜的那个意思。' },
  en: { label: '看英文', hint: '最后给出英文原文。把听到的声音和拼写对上，这是收尾的一轮。' },
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

/** 这一轮该显示什么文字；盲听返回 null */
export function visibleText(cue: CueLevel, en: string, zh: string): string | null {
  if (cue === 'en') return en || '';
  if (cue === 'zh') return zh || '';
  return null;
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
 * 返回 null 表示**整批已经听完**——调用方据此进入结算页。
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
 * 按「已播次数 / 总播次数」算，而不是按轮次算：3 轮里做完 2 轮多 3 句，
 * 按轮次算会显示 66%（看起来还剩一整轮），按次数算才是准确的 76%。
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
 * 本轮的播放次数上限保护。
 *
 * 用户可能反复点「再听一遍」。这个函数不限制次数（限制没有意义），
 * 只把「听了几遍」如实累加，供结算页展示——它是过程指标，不是目标。
 */
export function countListens(
  stats: Record<string, number>,
  pass: number,
  index: number,
): Record<string, number> {
  const key = `${pass}:${index}`;
  return { ...stats, [key]: (stats[key] ?? 0) + 1 };
}

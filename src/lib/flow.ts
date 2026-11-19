/**
 * 练习流程引擎 —— 纯逻辑，零 DOM 依赖。
 *
 * ── 为什么要"流程"而不是"单一模式" ─────────────────────────────────────────
 * 只跟打一遍的记忆留存很差：手指刚打过，靠的是短时工作记忆，
 * 关掉页面十分钟就忘了。参考产品验证有效的做法是**同一批词分层练**：
 *
 *   跟写（看词打） → 默写（看释义写） → 听写（听音写）
 *
 * 每上一层抽掉一条线索，逼大脑真正提取。而且**同一批词连续练完再换下一批**
 * （分组循环），比"30 个词各练一遍"效果好得多——这就是 7 词一组的由来。
 *
 * 本模块只负责"接下来该练哪个词、用什么模式"，不碰 UI 也不碰存储。
 */
import type { PracticeMode, WordEntry } from '@/types';

/** 一个练习步骤：整批词用同一种模式过一遍 */
export interface FlowStep {
  /** 步骤标识，用于 UI 展示与调试 */
  id: string;
  mode: PracticeMode;
  /** 这一步骤对哪些词生效（索引指向 group 内的词） */
  scope: 'group' | 'all';
  /** 展示给用户的名字 */
  label: string;
  /** 一句话说明这一步要做什么 */
  hint: string;
}

/** 一组练习任务：group 内的词按 steps 依次过一遍 */
export interface FlowGroup {
  /** 组序号（0 起） */
  index: number;
  /** 本组的词 */
  words: WordEntry[];
}

/** 完整计划：分组 + 每个分组要走的步骤 */
export interface PracticePlan {
  groups: FlowGroup[];
  steps: FlowStep[];
  /** 分组大小 */
  groupSize: number;
  /** 总词数 */
  totalWords: number;
}

/** 当前进度指针 */
export interface PlanCursor {
  groupIndex: number;
  stepIndex: number;
  /** 组内已完成的词数（用于 step 内部推进） */
  wordIndex: number;
}

/** 预设流程模板 */
export type FlowPreset = 'followOnly' | 'listenWrite' | 'fullChain';

export const FLOW_PRESETS: Record<
  FlowPreset,
  { name: string; hint: string; steps: FlowStep[]; loopInGroup: boolean }
> = {
  followOnly: {
    name: '只跟打',
    hint: '看词打字，最快过一遍，适合快速扩充词汇面',
    loopInGroup: false,
    steps: [{ id: 'followWrite', mode: 'typing', scope: 'all', label: '跟打', hint: '照着打出来' }],
  },
  listenWrite: {
    name: '跟打 + 默写',
    hint: '一组词先跟打，立刻默写同一批，趁记忆还热提取一次',
    loopInGroup: true,
    steps: [
      { id: 'followWrite', mode: 'typing', scope: 'group', label: '跟打', hint: '照着打出来' },
      { id: 'recall', mode: 'recall', scope: 'group', label: '默写', hint: '看释义写出单词' },
    ],
  },
  fullChain: {
    name: '跟打 + 默写 + 听写',
    hint: '三层递进：每条线索依次抽掉，最深的一层是只听音',
    loopInGroup: true,
    steps: [
      { id: 'followWrite', mode: 'typing', scope: 'group', label: '跟打', hint: '照着打出来' },
      { id: 'recall', mode: 'recall', scope: 'group', label: '默写', hint: '看释义写出单词' },
      { id: 'dictation', mode: 'dictation', scope: 'group', label: '听写', hint: '听发音拼写' },
    ],
  },
};

export const DEFAULT_GROUP_SIZE = 7;

/**
 * 生成练习计划。
 *
 * @param words    本轮全部词（调用方已经从出题队列拿好）
 * @param preset   流程模板
 * @param groupSize 每组词数；单模式流程时无效（整批当一组）
 */
export function buildPlan(
  words: WordEntry[],
  preset: FlowPreset = 'listenWrite',
  groupSize = DEFAULT_GROUP_SIZE,
): PracticePlan {
  const tpl = FLOW_PRESETS[preset] ?? FLOW_PRESETS.listenWrite;
  const size = tpl.loopInGroup ? Math.max(1, Math.floor(groupSize)) : Math.max(1, words.length);

  const groups: FlowGroup[] = [];
  for (let i = 0; i < words.length; i += size) {
    groups.push({ index: groups.length, words: words.slice(i, i + size) });
  }

  return {
    groups,
    steps: tpl.steps,
    groupSize: size,
    totalWords: words.length,
  };
}

/** 初始指针 */
export function initCursor(): PlanCursor {
  return { groupIndex: 0, stepIndex: 0, wordIndex: 0 };
}

/** 当前步骤定义 */
export function currentStep(plan: PracticePlan, cursor: PlanCursor): FlowStep | null {
  return plan.steps[cursor.stepIndex] ?? null;
}

/** 当前组的词 */
export function currentGroup(plan: PracticePlan, cursor: PlanCursor): FlowGroup | null {
  return plan.groups[cursor.groupIndex] ?? null;
}

/** 当前应该练的词；流程走完返回 null */
export function currentWord(plan: PracticePlan, cursor: PlanCursor): WordEntry | null {
  const group = currentGroup(plan, cursor);
  if (!group) return null;
  return group.words[cursor.wordIndex] ?? null;
}

/**
 * 推进到下一个词。
 *
 * 规则（对应分组循环）：
 *  - 组内还有词 → wordIndex+1
 *  - 组内走完 → stepIndex+1（同一批词换个模式再来）
 *  - 步骤走完 → groupIndex+1，回到第一步
 *  - 全部走完 → 返回 { done: true }
 *
 * @returns 新指针；done 表示整轮结束
 */
export function advance(plan: PracticePlan, cursor: PlanCursor): PlanCursor & { done: boolean } {
  const group = plan.groups[cursor.groupIndex];
  if (!group) return { ...cursor, done: true };

  // 1) 组内还有词
  if (cursor.wordIndex + 1 < group.words.length) {
    return { ...cursor, wordIndex: cursor.wordIndex + 1, done: false };
  }

  // 2) 本组这个词走完所有步骤了吗
  const step = plan.steps[cursor.stepIndex];
  const stepIsGroupScoped = step?.scope === 'group';

  if (cursor.stepIndex + 1 < plan.steps.length) {
    // group 作用域的步骤：同一组词换下一个模式 → 词索引归零
    if (stepIsGroupScoped) {
      return { ...cursor, stepIndex: cursor.stepIndex + 1, wordIndex: 0, done: false };
    }
    // all 作用域的步骤：词已经练完，直接跳去下一个步骤（理论上不会走到这里）
    return { ...cursor, stepIndex: cursor.stepIndex + 1, wordIndex: 0, done: false };
  }

  // 3) 本组所有步骤走完 → 下一组
  if (cursor.groupIndex + 1 < plan.groups.length) {
    return { groupIndex: cursor.groupIndex + 1, stepIndex: 0, wordIndex: 0, done: false };
  }

  /**
   * 全部走完：把指针移到最后一项**之后**。
   *
   * 这样 cursor 永远表示"当前正在进行的位置"，走到末尾即越界；
   * currentWord 自然返回 null，进度也能正确算出 100%。
   * 如果让指针停在最后一个词上，外面就无法区分"正要练最后一个词"
   * 和"已经练完最后一个词"。
   */
  return { groupIndex: plan.groups.length, stepIndex: 0, wordIndex: 0, done: true };
}

/** 整体进度 0..1，用于进度条 */
export function planProgress(plan: PracticePlan, cursor: PlanCursor): number {
  if (plan.totalWords === 0 || plan.groups.length === 0) return 0;
  const perGroup = plan.steps.length;
  const totalSteps = plan.groups.length * perGroup;
  if (totalSteps === 0) return 0;

  // 已完成的项目数：之前各组的所有步骤 + 当前组已完成的步骤
  const doneItems =
    cursor.groupIndex * perGroup * plan.groupSize + cursor.stepIndex * plan.groupSize;

  // 当前步骤里已完成的词
  const group = plan.groups[cursor.groupIndex];
  const inner = group ? cursor.wordIndex : 0;
  const totalItems = plan.totalWords * perGroup;

  return Math.max(0, Math.min(1, (doneItems + inner) / totalItems));
}

/**
 * 把计划展开成线性队列。
 *
 * 便于复用现有的"队列 + 索引"练习界面：展开后每个元素是
 * "这个词、用这个模式练一次"。分组循环的语义完全保留，
 * 只是把嵌套结构摊平了。
 */
export interface PlannedItem {
  entry: WordEntry;
  mode: PracticeMode;
  /** 第几组 */
  groupIndex: number;
  /** 第几步 */
  stepIndex: number;
  /** 这一步的名字，UI 可以显示"默写 3/7" */
  stepLabel: string;
}

export function flattenPlan(plan: PracticePlan): PlannedItem[] {
  const out: PlannedItem[] = [];
  for (const group of plan.groups) {
    for (let s = 0; s < plan.steps.length; s++) {
      const step = plan.steps[s];
      for (const entry of group.words) {
        out.push({
          entry,
          mode: step.mode,
          groupIndex: group.index,
          stepIndex: s,
          stepLabel: step.label,
        });
      }
    }
  }
  return out;
}

/** 汇总统计，用于结算页展示"每组平均错误"这类信息 */
export function summarizePlan(plan: PracticePlan): {
  groups: number;
  stepsPerGroup: number;
  totalItems: number;
} {
  return {
    groups: plan.groups.length,
    stepsPerGroup: plan.steps.length,
    totalItems: plan.totalWords * plan.steps.length,
  };
}

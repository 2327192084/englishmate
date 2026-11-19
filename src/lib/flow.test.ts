import { describe, expect, it } from 'vitest';
import {
  buildPlan,
  initCursor,
  advance,
  currentWord,
  currentStep,
  planProgress,
  flattenPlan,
  summarizePlan,
  FLOW_PRESETS,
  DEFAULT_GROUP_SIZE,
} from './flow';
import type { WordEntry } from '@/types';

const makeWords = (n: number): WordEntry[] =>
  Array.from({ length: n }, (_, i) => ({ w: `word${i}`, t: `释义${i}` }));

describe('计划生成', () => {
  it('分组循环模板按 groupSize 切分', () => {
    const plan = buildPlan(makeWords(15), 'listenWrite', 7);
    expect(plan.groups).toHaveLength(3); // 7 + 7 + 1
    expect(plan.groups[0].words).toHaveLength(7);
    expect(plan.groups[2].words).toHaveLength(1);
    expect(plan.groupSize).toBe(7);
  });

  it('单模式模板整批当一组', () => {
    const plan = buildPlan(makeWords(20), 'followOnly', 7);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].words).toHaveLength(20);
  });

  it('空词表不崩', () => {
    const plan = buildPlan([], 'listenWrite');
    expect(plan.groups).toHaveLength(0);
    expect(plan.totalWords).toBe(0);
    expect(flattenPlan(plan)).toEqual([]);
  });

  it('词数少于组大小时只有一组', () => {
    const plan = buildPlan(makeWords(3), 'fullChain', 7);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].words).toHaveLength(3);
  });

  it('非法组大小被纠正为至少 1', () => {
    const plan = buildPlan(makeWords(5), 'listenWrite', 0);
    expect(plan.groupSize).toBeGreaterThanOrEqual(1);
    expect(plan.groups.length).toBeGreaterThan(0);
  });
});

describe('cursor 推进（分组循环的核心）', () => {
  it('组内依次推进', () => {
    const plan = buildPlan(makeWords(3), 'listenWrite', 7);
    let c = initCursor();
    expect(currentWord(plan, c)?.w).toBe('word0');
    c = advance(plan, c);
    expect(currentWord(plan, c)?.w).toBe('word1');
    c = advance(plan, c);
    expect(currentWord(plan, c)?.w).toBe('word2');
  });

  it('组内走完后回到组首、进入下一个步骤（同一批词换模式）', () => {
    const plan = buildPlan(makeWords(3), 'listenWrite', 7);
    let c = initCursor();
    // 走完第一组的 3 个词
    c = advance(plan, c);
    c = advance(plan, c);
    c = advance(plan, c);

    expect(c.stepIndex).toBe(1); // 进入默写
    expect(c.wordIndex).toBe(0); // 回到组首
    expect(c.groupIndex).toBe(0); // 还是同一组
    expect(currentWord(plan, c)?.w).toBe('word0'); // 练的是同一批词

    const step = currentStep(plan, c);
    expect(step?.mode).toBe('recall');
  });

  it('一组所有步骤走完才换下一组', () => {
    const plan = buildPlan(makeWords(5), 'listenWrite', 3); // 3 + 2
    let c = initCursor();
    // 第一组：跟打 3 词 + 默写 3 词 = 6 次推进
    for (let i = 0; i < 6; i++) c = advance(plan, c);

    expect(c.groupIndex).toBe(1);
    expect(c.stepIndex).toBe(0);
    expect(c.wordIndex).toBe(0);
    expect(currentWord(plan, c)?.w).toBe('word3');
  });

  it('全部走完返回 done', () => {
    const plan = buildPlan(makeWords(2), 'listenWrite', 2); // 1 组 × 2 步 × 2 词 = 4 次
    let c = initCursor();
    let steps = 0;
    let done = false;
    while (steps < 10) {
      const next = advance(plan, c);
      c = next;
      done = next.done;
      steps++;
      if (done) break;
    }
    expect(done).toBe(true);
    expect(steps).toBe(4);
  });

  it('三步骤模板：每组走 3 轮', () => {
    const plan = buildPlan(makeWords(2), 'fullChain', 7);
    const items = flattenPlan(plan);
    // 2 词 × 3 步 = 6
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.mode)).toEqual([
      'typing',
      'typing',
      'recall',
      'recall',
      'dictation',
      'dictation',
    ]);
  });
});

describe('flattenPlan（供线性界面复用）', () => {
  it('展开后保留分组循环顺序：同组内按步骤、步骤内按词', () => {
    const words = makeWords(4);
    const plan = buildPlan(words, 'listenWrite', 2); // 组1:[w0,w1] 组2:[w2,w3]
    const items = flattenPlan(plan);

    expect(items).toHaveLength(8); // 4 词 × 2 步
    // 第一组跟打
    expect(items[0]).toMatchObject({ entry: { w: 'word0' }, mode: 'typing', groupIndex: 0 });
    expect(items[1]).toMatchObject({ entry: { w: 'word1' }, mode: 'typing', groupIndex: 0 });
    // 第一组默写
    expect(items[2]).toMatchObject({ entry: { w: 'word0' }, mode: 'recall', groupIndex: 0 });
    expect(items[3]).toMatchObject({ entry: { w: 'word1' }, mode: 'recall', groupIndex: 0 });
    // 第二组跟打
    expect(items[4]).toMatchObject({ entry: { w: 'word2' }, mode: 'typing', groupIndex: 1 });
  });

  it('每项带步骤标签', () => {
    const plan = buildPlan(makeWords(2), 'fullChain', 7);
    const items = flattenPlan(plan);
    const labels = new Set(items.map((i) => i.stepLabel));
    expect(labels).toEqual(new Set(['跟打', '默写', '听写']));
  });
});

describe('进度计算', () => {
  it('起点为 0，终点为 1', () => {
    const plan = buildPlan(makeWords(4), 'listenWrite', 2);
    expect(planProgress(plan, initCursor())).toBe(0);

    let c = initCursor();
    for (let i = 0; i < 100; i++) {
      const next = advance(plan, c);
      c = next;
      if (next.done) break;
    }
    expect(planProgress(plan, c)).toBeCloseTo(1, 5);
  });

  it('空计划进度为 0，不除零', () => {
    const plan = buildPlan([], 'listenWrite');
    expect(planProgress(plan, initCursor())).toBe(0);
    expect(Number.isFinite(planProgress(plan, initCursor()))).toBe(true);
  });

  it('进度单调不减', () => {
    const plan = buildPlan(makeWords(6), 'fullChain', 3);
    let c = initCursor();
    let prev = planProgress(plan, c);
    for (let i = 0; i < 30; i++) {
      const next = advance(plan, c);
      c = next;
      const p = planProgress(plan, c);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = p;
      if (next.done) break;
    }
  });
});

describe('模板定义', () => {
  it('三个预设都存在且有步骤', () => {
    for (const key of ['followOnly', 'listenWrite', 'fullChain'] as const) {
      expect(FLOW_PRESETS[key].steps.length).toBeGreaterThan(0);
      expect(FLOW_PRESETS[key].name).toBeTruthy();
    }
  });

  it('只有单模式模板不分组循环', () => {
    expect(FLOW_PRESETS.followOnly.loopInGroup).toBe(false);
    expect(FLOW_PRESETS.listenWrite.loopInGroup).toBe(true);
    expect(FLOW_PRESETS.fullChain.loopInGroup).toBe(true);
  });

  it('默认组大小为 7', () => {
    expect(DEFAULT_GROUP_SIZE).toBe(7);
  });

  it('summarizePlan 给出总数', () => {
    const plan = buildPlan(makeWords(14), 'fullChain', 7);
    const s = summarizePlan(plan);
    expect(s.groups).toBe(2);
    expect(s.stepsPerGroup).toBe(3);
    expect(s.totalItems).toBe(42); // 14 × 3
  });
});

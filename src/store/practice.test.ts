/**
 * 练习 store 的错误分类采集。
 *
 * 单独测 store 而不是只测 classifyMistake：分类函数对了但没接上采集点，
 * 功能一样是坏的——这类「逻辑对、接线错」的 bug 只能靠端到端才看得见。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePractice } from '@/store/practice';
import type { WordEntry } from '@/types';

function entry(w: string): WordEntry {
  return { w, t: `${w} 的释义` };
}

/** 起一轮只有指定几个词的练习 */
function startRound(words: string[]) {
  usePractice.getState().reset();
  usePractice.getState().start({
    mode: 'typing',
    bankId: 'cet4',
    queue: words.map(entry),
    reasons: new Map(),
  });
}

/** 逐字符输入（走 store 的真实 input 通路） */
function type(text: string) {
  for (const ch of text) usePractice.getState().input(ch, true);
}

describe('错误分类采集', () => {
  beforeEach(() => {
    usePractice.getState().reset();
  });

  it('一次没错时不产生分类', () => {
    startRound(['cat']);
    type('cat');
    expect(usePractice.getState().wordMistakes).toBe(0);
    expect(usePractice.getState().wordMistakeKinds).toEqual({
      order: 0,
      adjacent: 0,
      similar: 0,
      unrelated: 0,
    });
  });

  it('邻键误触记到 adjacent 上', () => {
    startRound(['cat']);
    usePractice.getState().input('c', true);
    // 该打 a，按成 s（a 与 s 同行相邻）
    usePractice.getState().input('s', true);
    const s = usePractice.getState();
    expect(s.wordMistakes).toBe(1);
    expect(s.wordMistakeKinds.adjacent).toBe(1);
    expect(s.wordMistakeKinds.order).toBe(0);
  });

  it('形近混淆记到 similar 上', () => {
    startRound(['bad']);
    usePractice.getState().input('b', true);
    usePractice.getState().input('a', true);
    // 该打 d，按成 b（镜像对）
    usePractice.getState().input('b', true);
    expect(usePractice.getState().wordMistakeKinds.similar).toBe(1);
  });

  it('同一个词的多类错误分别累加', () => {
    startRound(['cat']);
    usePractice.getState().input('c', true);
    usePractice.getState().input('s', true); // 邻键
    usePractice.getState().input('a', true);
    usePractice.getState().input('o', true); // 该打 t，打了个不相干的
    const kinds = usePractice.getState().wordMistakeKinds;
    expect(kinds.adjacent).toBe(1);
    expect(kinds.unrelated).toBe(1);
    expect(kinds.order + kinds.similar).toBe(0);
  });

  it('进入下一个词时分类清零', () => {
    startRound(['cat', 'dog']);
    usePractice.getState().input('c', true);
    usePractice.getState().input('s', true); // 邻键错
    type('at');
    usePractice.getState().next();
    expect(usePractice.getState().wordMistakeKinds.adjacent).toBe(0);
    expect(usePractice.getState().wordMistakes).toBe(0);
  });

  it('next 把分类带进 attempts', () => {
    startRound(['cat']);
    usePractice.getState().input('c', true);
    usePractice.getState().input('s', true);
    type('at');
    usePractice.getState().next();
    const attempts = usePractice.getState().attempts;
    expect(attempts).toHaveLength(1);
    expect(attempts[0].mistakeKinds?.adjacent).toBe(1);
  });

  it('一次没错的作答不带分类字段（区分「没采集」和「采集到 0」）', () => {
    startRound(['cat']);
    type('cat');
    usePractice.getState().next();
    const attempts = usePractice.getState().attempts;
    expect(attempts[0].mistakes).toBe(0);
    expect(attempts[0].mistakeKinds).toBeUndefined();
  });
});

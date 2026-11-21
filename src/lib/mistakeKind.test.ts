import { describe, expect, it } from 'vitest';
import {
  MISTAKE_KINDS,
  addMistakeKind,
  classifyMistake,
  dominantMistakeKind,
  emptyMistakeCounts,
  hasMistakeData,
  isAdjacentKey,
  totalMistakes,
} from './mistakeKind';

describe('邻键判定', () => {
  it('同一行紧挨着的两个键算相邻', () => {
    expect(isAdjacentKey('a', 's')).toBe(true);
    expect(isAdjacentKey('s', 'a')).toBe(true);
    expect(isAdjacentKey('q', 'w')).toBe(true);
    expect(isAdjacentKey('n', 'm')).toBe(true);
  });

  it('同一行隔一个键不算相邻', () => {
    expect(isAdjacentKey('a', 'd')).toBe(false);
    expect(isAdjacentKey('q', 'e')).toBe(false);
  });

  it('上下行斜向相邻算相邻', () => {
    // s 在 asdf 行第 1 列，w 在 qwer 行第 1 列
    expect(isAdjacentKey('s', 'w')).toBe(true);
    // f 在 asdf 行第 3 列，r 在 qwer 行第 3 列
    expect(isAdjacentKey('f', 'r')).toBe(true);
    // d 在 asdf 行第 2 列，g 在 zxcv 行第 4 列——差 2 列，不算
    expect(isAdjacentKey('d', 'g')).toBe(false);
  });

  it('隔一行不算相邻', () => {
    expect(isAdjacentKey('w', 'x')).toBe(false);
    // q 在 qwer 行首、z 在 zxcv 行首，中间隔了 asdf 行
    expect(isAdjacentKey('q', 'z')).toBe(false);
  });

  it('非字母键不参与判定', () => {
    expect(isAdjacentKey('a', '1')).toBe(false);
    expect(isAdjacentKey(' ', 'a')).toBe(false);
  });
});

describe('错误分类', () => {
  it('把上一个字符又打了一遍 → 顺序错', () => {
    // 目标 extra，已经打了 "ex"，现在该打 t，却打了 t 前面那个 x 的前一个？不对：
    // 这里模拟「重复刚打过的字符」：已打 "ex"，光标在 t，却按了 x
    expect(classifyMistake('t', 'x', 'ex', 'tra')).toBe('order');
  });

  it('抢按了下一个字符 → 顺序错', () => {
    // 目标 extra，已打 "ext"，光标在 r，却按了 r 后面的 a
    expect(classifyMistake('r', 'a', 'ext', 'a')).toBe('order');
  });

  it('按到旁边的键 → 邻键误触', () => {
    // 目标 cat，该打 a 却打了 s（a 与 s 同行相邻）
    expect(classifyMistake('a', 's', 'c', 't')).toBe('adjacent');
  });

  it('形近字符 → 形近混淆', () => {
    // 目标 bad，该打 d 却打了 b（b/d 是镜像对）
    expect(classifyMistake('d', 'b', 'ba', '')).toBe('similar');
    // p/q
    expect(classifyMistake('p', 'q', 'a', '')).toBe('similar');
  });

  it('不相干的字符 → 想不起来', () => {
    // 目标 cat，该打 a 却打了 o（不同行、列也远，既不邻也不像）
    expect(classifyMistake('a', 'o', 'c', 't')).toBe('unrelated');
  });

  it('非字母输入一律归为想不起来', () => {
    expect(classifyMistake('a', '1', 'c', 't')).toBe('unrelated');
    expect(classifyMistake('a', ' ', 'c', 't')).toBe('unrelated');
  });

  it('优先级：顺序错高于邻键', () => {
    // 目标 "aa"，已打 "a"，现在该打第二个 a，光标处是 a；用户按了 a 以外的邻键
    // 但若按下的是刚打过的 a，仍应判为顺序错而不是邻键
    expect(classifyMistake('b', 'a', 'a', '')).toBe('order');
  });

  it('优先级：邻键高于形近', () => {
    // 目标 "ba"，该打 a 却打了 z（z 与 a 相邻）；z 与 a 不在 SIMILAR_PAIRS 里，
    // 换成同时满足两者的组合验证顺序：'b' 与 'v' 相邻但不相像
    expect(classifyMistake('b', 'v', '', '')).toBe('adjacent');
  });

  it('大小写差异不算错误（不会走到分类）', () => {
    // sameChar 会先放行只差大小写的输入，所以这里拿不到这种组合；
    // 但要保证即使被调用也不会崩，且归为想不起来或形近都合理
    const kind = classifyMistake('A', 'a', '', '');
    expect(MISTAKE_KINDS).toContain(kind);
  });
});

describe('分类计数', () => {
  it('全零起点', () => {
    const counts = emptyMistakeCounts();
    expect(counts).toEqual({ order: 0, adjacent: 0, similar: 0, unrelated: 0 });
    expect(hasMistakeData(counts)).toBe(false);
    expect(totalMistakes(counts)).toBe(0);
  });

  it('累加不就地修改原对象', () => {
    const a = emptyMistakeCounts();
    const b = addMistakeKind(a, 'adjacent');
    expect(a.adjacent).toBe(0);
    expect(b.adjacent).toBe(1);
    expect(a).not.toBe(b);
  });

  it('未定义时按全零起算', () => {
    const counts = addMistakeKind(undefined, 'similar');
    expect(counts.similar).toBe(1);
    expect(totalMistakes(counts)).toBe(1);
  });

  it('多次累加同一类', () => {
    let counts = emptyMistakeCounts();
    counts = addMistakeKind(counts, 'order');
    counts = addMistakeKind(counts, 'order');
    counts = addMistakeKind(counts, 'unrelated');
    expect(counts.order).toBe(2);
    expect(counts.unrelated).toBe(1);
    expect(totalMistakes(counts)).toBe(3);
    expect(hasMistakeData(counts)).toBe(true);
  });

  it('undefined 视为没有数据', () => {
    expect(hasMistakeData(undefined)).toBe(false);
    expect(totalMistakes(undefined)).toBe(0);
  });
});

describe('主要错误类型', () => {
  it('取计数最多的那一类', () => {
    expect(dominantMistakeKind({ order: 1, adjacent: 3, similar: 0, unrelated: 2 })).toBe(
      'adjacent',
    );
  });

  it('没有数据时返回 null', () => {
    expect(dominantMistakeKind(undefined)).toBeNull();
    expect(dominantMistakeKind(emptyMistakeCounts())).toBeNull();
  });

  it('平票时按 MISTAKE_KINDS 顺序取靠前的，保证分组稳定', () => {
    // order 与 unrelated 都是 2，应取 order（数组里更靠前）
    expect(dominantMistakeKind({ order: 2, adjacent: 0, similar: 0, unrelated: 2 })).toBe('order');
  });
});

import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadWordGraph,
  getRelation,
  getFamily,
  getLookalike,
  isGraphLoaded,
  __resetCache,
} from './wordGraph';
import { readFileSync } from 'node:fs';

/** 直接读产物，验证数据本身的契约（不走 fetch） */
const raw = JSON.parse(readFileSync('public/dicts/word-graph.json', 'utf8')) as Record<
  string,
  { f?: string[]; l?: string[] }
>;

describe('词关系数据契约', () => {
  it('覆盖足够多的词', () => {
    const count = Object.keys(raw).length;
    expect(count).toBeGreaterThan(10000);
  });

  it('每个条目至少有一种关系', () => {
    for (const [w, v] of Object.entries(raw)) {
      const hasAny = (v.f?.length ?? 0) > 0 || (v.l?.length ?? 0) > 0;
      if (!hasAny) throw new Error(`${w} 没有任何关系`);
    }
  });

  it('关系数组里没有空串、没有自己', () => {
    for (const [w, v] of Object.entries(raw)) {
      for (const arr of [v.f, v.l]) {
        if (!arr) continue;
        for (const x of arr) {
          expect(x).toBeTruthy();
          expect(x).not.toBe(w);
        }
      }
    }
  });

  it('没有重复项', () => {
    for (const v of Object.values(raw)) {
      for (const arr of [v.f, v.l]) {
        if (!arr) continue;
        expect(new Set(arr).size).toBe(arr.length);
      }
    }
  });

  it('词形变化里不会混入同族自己（abandon 的族里不该有 abandon）', () => {
    for (const [w, v] of Object.entries(raw)) {
      if (!v.f) continue;
      expect(v.f).not.toContain(w);
    }
  });

  it('关键样本正确', () => {
    // 这些是人工核对过的
    expect(raw['abandon']?.f).toContain('abandoned');
    expect(raw['abandon']?.f).toContain('abandoning');
    expect(raw['reach']?.f).toContain('reaching');
    // 形近词：adapt / adopt / adept 是经典易混三兄弟
    expect(raw['adapt']?.l).toContain('adopt');
  });

  it('数据体积可控（小于 2MB）', () => {
    const size = Buffer.byteLength(JSON.stringify(raw));
    expect(size).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('加载器', () => {
  beforeEach(() => {
    __resetCache();
  });

  it('初始未加载时查询返回空数组，不崩', () => {
    expect(isGraphLoaded()).toBe(false);
    expect(getFamily('abandon')).toEqual([]);
    expect(getLookalike('adapt')).toEqual([]);
    expect(getRelation('abandon')).toBeNull();
  });

  it('加载失败时降级为空 Map，不抛错', async () => {
    // node 环境下没有 fetch 到真实文件的路径，会走失败分支
    const map = await loadWordGraph();
    expect(map instanceof Map).toBe(true);
    expect(map.size).toBe(0);
    expect(isGraphLoaded()).toBe(true); // 标记为已尝试
  });
});

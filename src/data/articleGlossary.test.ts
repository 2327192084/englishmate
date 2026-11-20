import { describe, expect, it } from 'vitest';
import raw from '../../public/dicts/article-glossary.json';
import {
  __resetCache,
  isGlossaryLoaded,
  loadArticleGlossary,
  lookupArticleWord,
  lookupInGlossary,
  tokenForms,
  type ArticleGlossary,
} from './articleGlossary';

/**
 * 产物契约测试。
 *
 * 和 wordGraph.test.ts 同一思路：数据是构建脚本离线算的，这里守住
 * 「产物结构没被改坏」与「加载/降级行为符合界面假设」两条底线。
 */
interface RawGlossary {
  generatedAt: string;
  entries: Record<string, Record<string, unknown>>;
  variants: Record<string, string>;
}

const glossary = raw as unknown as RawGlossary;

describe('article-glossary.json 产物契约', () => {
  it('有生成日期与足够的词条', () => {
    expect(glossary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(glossary.entries).length).toBeGreaterThan(1200);
  });

  it('词条 key 全是小写且与原始大小写一致或带 w 覆盖', () => {
    for (const [key] of Object.entries(glossary.entries)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('每个词条至少有一种释义来源（defs 或 t）', () => {
    for (const [key, entry] of Object.entries(glossary.entries)) {
      const hasDefs = Array.isArray(entry.defs) && entry.defs.length > 0;
      const hasT = typeof entry.t === 'string' && entry.t.trim().length > 0;
      expect(hasDefs || hasT, `词条 ${key} 既无 defs 也无 t`).toBe(true);
    }
  });

  it('defs 是 [pos, cn] 二元组（省体积的编码，前端按此解包）', () => {
    for (const [key, entry] of Object.entries(glossary.entries)) {
      if (entry.defs === undefined) continue;
      const defs = entry.defs as unknown[];
      expect(Array.isArray(defs)).toBe(true);
      for (const d of defs) {
        expect(Array.isArray(d), `${key} 的 defs 项不是数组`).toBe(true);
        const [pos, cn] = d as [unknown, unknown];
        expect(typeof pos).toBe('string');
        expect(typeof cn).toBe('string');
        expect((cn as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('sentences 是 [en, zh] 二元组', () => {
    for (const [key, entry] of Object.entries(glossary.entries)) {
      if (entry.sentences === undefined) continue;
      for (const s of entry.sentences as unknown[]) {
        const [en, zh] = s as [unknown, unknown];
        expect(typeof en, `${key} 例句英文非字符串`).toBe('string');
        expect(typeof zh, `${key} 例句中文非字符串`).toBe('string');
        expect((en as string).trim()).not.toBe('');
        expect((zh as string).trim()).not.toBe('');
      }
    }
  });

  it('体积受控：原始 JSON 小于 400KB（超了说明编码退化，前端加载会变慢）', () => {
    const bytes = Buffer.byteLength(JSON.stringify(glossary));
    expect(bytes).toBeLessThan(400 * 1024);
  });

  it('variants 全部指向存在的词条，且不含自己', () => {
    const entries = glossary.entries;
    for (const [form, base] of Object.entries(glossary.variants)) {
      expect(form, '变体应是小写').toBe(form.toLowerCase());
      expect(form).not.toBe(base);
      expect(entries[base], `变体 ${form} 指向不存在的原形 ${base}`).toBeTruthy();
    }
  });

  it('变体不是空表（词形反查是点词体验的关键一环）', () => {
    expect(Object.keys(glossary.variants).length).toBeGreaterThan(300);
  });
});

describe('tokenForms', () => {
  it('普通词只返回自身', () => {
    expect(tokenForms('apple')).toEqual(['apple']);
  });

  it('剥掉首尾标点与大小写', () => {
    expect(tokenForms('"Apple,"')).toEqual(['apple']);
  });

  it('don\'t 会拆出 do', () => {
    expect(tokenForms("don't")).toContain('do');
  });

  it('连字符词会尝试去掉连字符与首末段', () => {
    const forms = tokenForms('battle-field');
    expect(forms).toContain('battlefield');
    expect(forms).toContain('battle');
    expect(forms).toContain('field');
  });

  it('词尾撇号（Gutenberg 吞引号）被剥掉', () => {
    expect(tokenForms("machine'")).toContain('machine');
  });

  it('纯标点返回空数组', () => {
    expect(tokenForms('—')).toEqual([]);
    expect(tokenForms('   ')).toEqual([]);
  });
});

describe('lookupInGlossary', () => {
  const fake: ArticleGlossary = {
    generatedAt: '2026-01-01',
    entries: new Map([
      ['run', { w: 'run', t: '跑', defs: [{ pos: 'v.', cn: '跑' }], sentences: [{ en: 'I run.', zh: '我跑。' }] }],
    ]),
    variants: new Map([['running', 'run']]),
  };

  it('直接命中原形', () => {
    expect(lookupInGlossary(fake, 'run')?.t).toBe('跑');
  });

  it('经变体表命中', () => {
    expect(lookupInGlossary(fake, 'running')?.w).toBe('run');
  });

  it('大小写不敏感', () => {
    expect(lookupInGlossary(fake, 'RUN')?.w).toBe('run');
  });

  it('带标点也能命中', () => {
    expect(lookupInGlossary(fake, 'running,')?.w).toBe('run');
  });

  it('未收录返回 null（界面据此不做可点）', () => {
    expect(lookupInGlossary(fake, 'hath')).toBeNull();
  });
});

describe('加载器降级', () => {
  it('未加载时同步查询返回 null 且 isGlossaryLoaded 为 false', () => {
    __resetCache();
    expect(isGlossaryLoaded()).toBe(false);
    expect(lookupArticleWord('run')).toBeNull();
  });

  it('node 环境下 fetch 失败时返回 null 而不是抛错', async () => {
    __resetCache();
    await expect(loadArticleGlossary()).resolves.toBeNull();
    // 失败后仍视为「已尝试」，同步查询保持 null，界面退回纯文本
    expect(lookupArticleWord('run')).toBeNull();
  });
});

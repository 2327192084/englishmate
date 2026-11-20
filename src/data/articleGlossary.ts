/**
 * 文章点词释义表加载器。
 *
 * 数据由 `scripts/build-article-glossary.mjs` 离线算好，产物是
 * `public/dicts/article-glossary.json`（约 294KB，gzip 120KB）。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────────
 * 词库是按需加载的：读一篇文章时点到一个词，它可能只在 tem8(2.87MB) 或
 * gre(1.2MB) 里。为一个词下载整本词库不划算。文章语料是固定的，所以把
 * 「文章里出现过的词」的释义离线压成一个小文件，进文章页时一次加载即可。
 *
 * 文件里只有 w/p/defs/t/sentences —— 短语、近义词、同根词这些词库里本来
 * 就少的字段不在产物里，WordDetail 会按字段存在性自动跳过对应区块。
 */
import type { WordDef, WordEntry, WordPair } from '@/types';

const GLOSSARY_PATH = '/dicts/article-glossary.json';

/** 产物里词条的精简形态（defs/sentences 用二元组省体积） */
interface RawGlossEntry {
  w?: string;
  p?: string;
  defs?: [string, string][];
  t?: string;
  sentences?: [string, string][];
}

interface RawGlossary {
  generatedAt: string;
  entries: Record<string, RawGlossEntry>;
  variants: Record<string, string>;
}

export interface ArticleGlossary {
  generatedAt: string;
  /** 原形（小写）→ 词条 */
  entries: Map<string, WordEntry>;
  /** 词形变体（小写）→ 原形 */
  variants: Map<string, string>;
}

/** 内存缓存，只下载一次 */
let cache: ArticleGlossary | null = null;
let loading: Promise<ArticleGlossary | null> | null = null;

/** 拼出资源 URL（兼容 Web 的 / 与桌面版 file:// 的相对路径） */
function glossaryUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  if (base === './' || base === '') {
    // file:// 场景：相对当前文档解析
    return new URL(GLOSSARY_PATH.replace(/^\//, ''), window.location.href).toString();
  }
  return base.replace(/\/$/, '') + GLOSSARY_PATH;
}

/** 精简结构 → WordEntry（补上 WordDetail 需要的字段形态） */
function toWordEntry(raw: RawGlossEntry, key: string): WordEntry {
  const defs: WordDef[] | undefined = raw.defs?.map(([pos, cn]) => ({ pos, cn }));
  const sentences: WordPair[] | undefined = raw.sentences?.map(([en, zh]) => ({ en, zh }));
  const entry: WordEntry = {
    w: raw.w ?? key,
    // 有 defs 时产物省略了 t，这里拼回去，保证 t 永远非空
    t: raw.t ?? defs?.map((d) => d.cn).join('；') ?? '',
  };
  if (raw.p) entry.p = raw.p;
  if (defs?.length) entry.defs = defs;
  if (sentences?.length) entry.sentences = sentences;
  return entry;
}

/**
 * 加载点词释义表。
 * 失败时返回 null —— 点词是增强功能，缺了文章照样能练。
 */
export async function loadArticleGlossary(): Promise<ArticleGlossary | null> {
  if (cache) return cache;
  if (loading) return loading;

  loading = (async () => {
    try {
      const res = await fetch(glossaryUrl());
      if (!res.ok) throw new Error(String(res.status));
      const raw = (await res.json()) as RawGlossary;
      const entries = new Map<string, WordEntry>();
      for (const [key, value] of Object.entries(raw.entries ?? {})) {
        entries.set(key, toWordEntry(value, key));
      }
      cache = {
        generatedAt: raw.generatedAt,
        entries,
        variants: new Map(Object.entries(raw.variants ?? {})),
      };
      return cache;
    } catch {
      cache = null;
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/**
 * 一个 token 的所有候选词形（按优先级）。
 *
 * 文章里的 token 不是干净的词形：Gutenberg 文本有 `battle-field`、
 * `machine'`（引号被吞进词里）、`don't`、`shan't`。按从「最原样」
 * 到「最激进拆分」的顺序试，先命中先用。
 *
 * 纯函数，便于单测。
 */
export function tokenForms(token: string): string[] {
  const lower = token.toLowerCase().replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  if (!lower) return [];

  const out = [lower];
  const noTrail = lower.replace(/['’]+$/, '');
  if (noTrail && noTrail !== lower) out.push(noTrail);
  // don't → do / shan't → sha（后者查不到，无害）
  const noNt = noTrail.replace(/n['’]t$/, '');
  if (noNt && noNt !== noTrail) out.push(noNt);
  const beforeApos = noTrail.split(/['’]/)[0];
  if (beforeApos && beforeApos !== noTrail) out.push(beforeApos);
  if (noTrail.includes('-')) {
    out.push(noTrail.replace(/-/g, ''));
    out.push(noTrail.split('-')[0]);
    out.push(noTrail.split('-').pop() ?? '');
  }

  const seen = new Set<string>();
  const forms: string[] = [];
  for (const form of out) {
    if (!form || seen.has(form)) continue;
    seen.add(form);
    forms.push(form);
  }
  return forms;
}

/**
 * 在已加载的释义表里查一个 token（纯函数，便于单测）。
 * 返回 null 表示「文章里的这个词暂未收录」，界面据此不做可点。
 */
export function lookupInGlossary(glossary: ArticleGlossary, token: string): WordEntry | null {
  for (const form of tokenForms(token)) {
    const direct = glossary.entries.get(form);
    if (direct) return direct;
    const base = glossary.variants.get(form);
    if (base) {
      const viaVariant = glossary.entries.get(base);
      if (viaVariant) return viaVariant;
    }
  }
  return null;
}

/** 同步查询（需先 await loadArticleGlossary 一次并拿到结果） */
export function lookupArticleWord(token: string): WordEntry | null {
  if (!cache) return null;
  return lookupInGlossary(cache, token);
}

/** 是否已加载（界面据此决定要不要把词渲染成可点） */
export function isGlossaryLoaded(): boolean {
  return cache !== null;
}

/** 仅供测试：清空缓存 */
export function __resetCache(): void {
  cache = null;
  loading = null;
}

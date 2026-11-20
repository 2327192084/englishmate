/**
 * 词关系加载器。
 *
 * 数据由 `scripts/build-word-graph.mjs` 从 ECDICT 挖出，产物是
 * `public/dicts/word-graph.json`（约 0.78MB，覆盖 1.5 万词）。
 *
 * ── 为什么不塞进每个词库 JSON ─────────────────────────────────────────────
 * 词库是按需加载的（选哪个词库才下载哪个）。如果把这 0.78MB 的关系
 * 复制进 16 个词库文件，体积会翻好几倍且大量重复。独立文件只下载一次，
 * 所有词库共用。
 */
import type { WordRelation } from '@/types';

const GRAPH_PATH = '/dicts/word-graph.json';

/** 内存缓存，只下载一次 */
let cache: Map<string, WordRelation> | null = null;
let loading: Promise<Map<string, WordRelation>> | null = null;

/** 拼出资源 URL（兼容 Web 的 / 与桌面版 file:// 的相对路径） */
function graphUrl(): string {
  const base = import.meta.env.BASE_URL || '/';
  if (base === './' || base === '') {
    // file:// 场景：相对当前文档解析
    return new URL(GRAPH_PATH.replace(/^\//, ''), window.location.href).toString();
  }
  return base.replace(/\/$/, '') + GRAPH_PATH;
}

/**
 * 加载全部词关系。
 * 失败时返回空 Map —— 词关系是增强信息，缺了不影响练习。
 */
export async function loadWordGraph(): Promise<Map<string, WordRelation>> {
  if (cache) return cache;
  if (loading) return loading;

  loading = (async () => {
    try {
      const res = await fetch(graphUrl());
      if (!res.ok) throw new Error(String(res.status));
      const raw = (await res.json()) as Record<string, WordRelation>;
      cache = new Map(Object.entries(raw));
      return cache;
    } catch {
      cache = new Map();
      return cache;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** 同步查询（需先 await loadWordGraph 一次） */
export function getRelation(word: string): WordRelation | null {
  if (!cache) return null;
  return cache.get(word.toLowerCase()) ?? null;
}

/** 词形变化（原形 → abandoned / abandoning / abandons） */
export function getFamily(word: string): string[] {
  return getRelation(word)?.f ?? [];
}

/** 形近易混词（adapt → adopt / adept） */
export function getLookalike(word: string): string[] {
  return getRelation(word)?.l ?? [];
}

/** 是否已加载（界面据此决定要不要显示相关区块） */
export function isGraphLoaded(): boolean {
  return cache !== null;
}

/** 仅供测试：清空缓存 */
export function __resetCache(): void {
  cache = null;
  loading = null;
}

/**
 * 窄式精听的「批次」构造。
 *
 * ── 为什么不是按词汇相似度聚类（这是实测否掉的方案）──────────────────────
 * 一开始的想法是：把语义相近的句子聚成一批，凑成「窄式」主题。
 * 实测之后放弃了，两个原因：
 *
 * 1. **真正的同一主题文本，词汇重叠本来就极低**。量过：
 *    同一篇文章内部，任意两句平均只共享 0.11–0.36 个内容词；
 *    跨文章随机两句是 0.06。也就是说「词汇重叠」区分不出主题。
 * 2. 按重叠度贪心聚出来的簇，实际聚在 `own` / `like` / `dont` 这类**高频词**上，
 *    而不是主题上（`dont` 那种还是撇号被切成 `doesn` + `t` 的 bug 造成的）。
 *    簇里甚至会混进完全重复的句子。数值上「提升 68 倍」，实际是垃圾。
 *
 * ── 真正可行的窄式来源：整篇文章 ────────────────────────────────────────
 * 75 篇文章每篇 4–10 句、平均 6.5 句，本身就是同一作者、同一主题、
 * 同一语域的自然批次。用它当「窄式单元」不需要任何算法，
 * 而且「反复听同一篇文章的几句话」正是窄式输入想要的形态。
 *
 * 本文件是纯逻辑 + 数据装配，不许引入 React。
 */
import type { Article } from '@/types';
import { ARTICLES } from './articles';
import type { SentenceItem } from './sentences';

/** 一个窄式批次：同一主题的一小批句子 */
export interface NarrowBatch {
  /** 批次 id（目前是文章 id） */
  id: string;
  /** 批次标题，用于列表与播放界面 */
  title: string;
  /** 中文标题 */
  titleZh: string;
  /** 难度标签 */
  level: string;
  /** 作者 / 出处 */
  author: string;
  /** 这一批的句子，已转成精听用的统一结构 */
  items: SentenceItem[];
}

/** 精听默认每批的句数上限：太多会让「同一批听三轮」变成负担 */
export const BATCH_SIZE = 10;

/**
 * 把一篇文章转成一个窄式批次。
 *
 * 句数超过上限时**从开头截取**而不是随机抽：文章是有顺序的，
 * 从中间抽会让上下文断裂——而上下文正是窄式输入的价值所在。
 */
export function batchFromArticle(article: Article, limit = BATCH_SIZE): NarrowBatch | null {
  if (!article || typeof article !== 'object') return null;
  if (!Array.isArray(article.sentences) || article.sentences.length === 0) return null;

  const sentences = article.sentences
    .filter((s) => s && typeof s.en === 'string' && s.en.trim().length > 0)
    .slice(0, Math.max(1, limit));
  if (sentences.length === 0) return null;

  const items: SentenceItem[] = sentences.map((s) => ({
    en: s.en.trim(),
    zh: typeof s.zh === 'string' ? s.zh : '',
    /**
     * 文章句子不对应某个词条，但下游（精听界面、session 记录）
     * 都要读 word 字段。用文章标题而不是空串：
     * 结算页显示「来自词条 xxx」时才不会是一行空白。
     */
    word: article.titleZh || article.title || article.id,
    bankId: `article:${article.id}`,
    trans: article.titleZh || article.title || '',
  }));

  return {
    id: article.id,
    title: article.title,
    titleZh: article.titleZh,
    level: article.level,
    author: article.author,
    items,
  };
}

/**
 * 全部可用的窄式批次。
 *
 * 排序刻意按「难度 → 标题」而不是语料顺序：用户是在一堆文章里挑，
 * 按难度分层更好找，同时保证同一难度内的顺序稳定（不会每次进页面都变）。
 */
export function listNarrowBatches(
  articles: Article[] = ARTICLES,
  limit = BATCH_SIZE,
): NarrowBatch[] {
  if (!Array.isArray(articles)) return [];
  const levelOrder = ['CET-4', 'CET-6', '考研', '雅思'];
  const rank = (lv: string) => {
    const i = levelOrder.indexOf(lv);
    return i === -1 ? levelOrder.length : i;
  };

  return articles
    .map((a) => batchFromArticle(a, limit))
    .filter((b): b is NarrowBatch => b !== null)
    .sort((a, b) => {
      const d = rank(a.level) - rank(b.level);
      if (d !== 0) return d;
      return a.title.localeCompare(b.title);
    });
}

/**
 * 按 id 取一个批次。
 * 找不到返回 null 而不是抛错：URL 里的 id 可能来自旧链接或手改。
 */
export function getNarrowBatch(id: string, articles: Article[] = ARTICLES): NarrowBatch | null {
  if (!id) return null;
  const found = articles.find((a) => a && a.id === id);
  return found ? batchFromArticle(found) : null;
}

/**
 * 把一批句子按「整批听」的方式打包（用于来源不是文章、而是错词本/词库的情况）。
 *
 * 与 batchFromArticle 的区别：这里没有主题可言，只是给一个统一的批次外壳，
 * 让播放器不必区分「来自文章」和「来自例句库」。
 */
export function batchFromSentences(
  items: SentenceItem[],
  id = 'mixed',
  title = '例句混合',
): NarrowBatch {
  return {
    id,
    title,
    titleZh: title,
    level: '',
    author: '',
    items: Array.isArray(items) ? items.slice(0, BATCH_SIZE) : [],
  };
}

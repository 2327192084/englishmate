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
 * 按 id 取一个批次，包含同作者合集。
 *
 * id 约定：以 `author:` 开头的是同作者合集（见 batchFromAuthor），
 * 其余按文章 id 查。只给 batchFromArticle 会取不到合集，
 * 表现为「选了合集却提示没有可用句子」。
 */
export function getNarrowBatch(id: string, articles: Article[] = ARTICLES): NarrowBatch | null {
  if (!id) return null;
  if (id.startsWith('author:')) {
    return batchFromAuthor(id.slice('author:'.length), articles);
  }
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

/**
 * 把同一作者的**多篇**文章合成一个批次。
 *
 * ── 为什么这比单篇更「窄」──────────────────────────────────────────────
 * 窄式输入的核心是「同一批材料的词汇与句式反复复现」。单篇已经具备
 * 同主题、同语域；同作者多篇在此基础上再叠加一层：同一个人的用词习惯、
 * 句长节奏、叙事套路都会重复出现。Aesop 的 69 篇寓言尤其明显——
 * 结构几乎都是「某动物 + 遇到某事 + 寓意」，读第二篇时前一篇的词汇还在。
 *
 * ── 为什么按顺序交替取而不是先取完第一篇 ────────────────────────────────
 * 若逐篇取满再取下一篇，第 11 句之后就换篇了，「跨篇复现」根本没发生。
 * 这里改成**轮流取**（每篇取 1 句，循环），让相邻句子来自不同篇，
 * 而同一篇的句子在批次里被摊开——复现发生在「不同篇之间」，
 * 这正是同作者批次想利用的那一层。
 *
 * 注意：这不改变「每篇内部有上下文」的事实。想读完整一篇时用
 * batchFromArticle；想跨篇强化词汇复现时用这个。
 */
export function batchFromAuthor(
  author: string,
  articles: Article[] = ARTICLES,
  limit = BATCH_SIZE,
): NarrowBatch | null {
  if (!author || !Array.isArray(articles)) return null;

  const mine = articles.filter((a) => a && a.author === author);
  if (mine.length === 0) return null;

  // 每篇先各自取出可用句子，再轮流取，见上面的取舍说明
  const perArticle = mine
    .map((a) =>
      (a.sentences || [])
        .filter((s) => s && typeof s.en === 'string' && s.en.trim().length > 0)
        .map((s) => ({ article: a, en: s.en.trim(), zh: typeof s.zh === 'string' ? s.zh : '' })),
    )
    .filter((list) => list.length > 0);
  if (perArticle.length === 0) return null;

  const target = Math.max(1, limit);
  const picked: { article: Article; en: string; zh: string }[] = [];
  let round = 0;
  // 轮流取：第 round 轮从每篇各取第 round 句
  while (picked.length < target) {
    let progressed = false;
    for (const list of perArticle) {
      if (picked.length >= target) break;
      const s = list[round];
      if (!s) continue;
      picked.push(s);
      progressed = true;
    }
    if (!progressed) break;
    round++;
  }
  if (picked.length === 0) return null;

  const items: SentenceItem[] = picked.map((p) => ({
    en: p.en,
    zh: p.zh,
    /**
     * 同作者批次里 word 用「篇名」而不是作者名：
     * 用户听到某句想知道它出自哪一篇，作者名对每一句都一样，没有信息量。
     */
    word: p.article.titleZh || p.article.title || p.article.id,
    bankId: `article:${p.article.id}`,
    trans: p.article.titleZh || p.article.title || '',
  }));

  // 难度取这些篇里最常见的那一档，供列表分组用
  const levelCount = new Map<string, number>();
  for (const a of mine) {
    if (a.level) levelCount.set(a.level, (levelCount.get(a.level) ?? 0) + 1);
  }
  const level = [...levelCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  return {
    id: `author:${author}`,
    title: author,
    titleZh: `${author}（${mine.length} 篇合集）`,
    level,
    author,
    items,
  };
}

/**
 * 所有「同作者多篇」批次，按篇数从多到少。
 *
 * 只有超过一篇的作者才会出现：单篇作者拼不出「多篇复现」，
 * 列出来只会让用户困惑（点进去发现和单篇一模一样）。
 */
export function listAuthorBatches(
  articles: Article[] = ARTICLES,
  limit = BATCH_SIZE,
): NarrowBatch[] {
  if (!Array.isArray(articles)) return [];
  const count = new Map<string, number>();
  for (const a of articles) {
    if (!a || !a.author) continue;
    count.set(a.author, (count.get(a.author) ?? 0) + 1);
  }

  return [...count.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([author]) => batchFromAuthor(author, articles, limit))
    .filter((b): b is NarrowBatch => b !== null);
}

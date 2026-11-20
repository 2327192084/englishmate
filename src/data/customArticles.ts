/**
 * 自定义文章 —— 解析用户导入的文本 / JSON，并读写 IndexedDB。
 *
 * 为什么单独放一个模块：文章列表页（ArticlesPage）只需要「读列表 + 解析 + 存」，
 * 解析规则里有一堆边界（编码、双语对齐、长句截断），放页面里会变成一坨难以测试的
 * effect。这里全部是纯函数 + 三个薄的 DB 包装，单测可以直接覆盖。
 *
 * 支持的三种格式见 parseArticleTextDetailed 的注释。
 */
import { db, type CustomArticle } from '@/db';
import type { Article, ArticleSentence } from '@/types';

/* ---------- 常量 ---------- */

/**
 * 单句英文最多多少字符。
 * 与内置语料同一个口径（见 src/data/articles.ts 的选文原则第 4 条）：
 * 超过 140 字符的句子逐字符跟打体验太差。
 */
export const MAX_SENTENCE_CHARS = 140;

/** 少于这么多句就不让导入——一句话的"文章"没有练习价值 */
export const MIN_SENTENCE_COUNT = 3;

/**
 * 替换字符 U+FFFD 的占比阈值。
 * GBK 文件用 UTF-8 解出来，每个汉字会变成 1~3 个 U+FFFD，
 * 正常 UTF-8 文本里几乎不会出现这个字符，所以 1% 已经非常灵敏。
 */
const REPLACEMENT_CHAR_RATIO = 0.01;

/** 四个难度标签，与内置文章保持一致 */
export const ARTICLE_LEVELS = ['CET-4', 'CET-6', '考研', '雅思'] as const;
export type ArticleLevel = (typeof ARTICLE_LEVELS)[number];

/** 自定义文章 id 前缀（形如 u1a2b3c） */
const CUSTOM_ID_PREFIX = 'u';

/* ---------- 错误类型 ---------- */

export type ArticleImportErrorCode =
  | 'empty'
  /** 编码不对（多半是 GBK 被当成 UTF-8 读） */
  | 'encoding'
  /** 句数不够 */
  | 'too-few-sentences'
  /** JSON 语法错误 */
  | 'invalid-json'
  /** 解析不出任何句子 */
  | 'no-sentences';

/**
 * 导入失败。
 * 带 code 是为了让界面能按类型给不同提示（编码错误要提示"另存为 UTF-8"），
 * message 本身就是可以直接弹给用户看的中文。
 */
export class ArticleImportError extends Error {
  readonly code: ArticleImportErrorCode;

  constructor(code: ArticleImportErrorCode, message: string) {
    super(message);
    this.name = 'ArticleImportError';
    this.code = code;
  }
}

/* ---------- 解析结果 ---------- */

export interface ParsedArticle {
  article: Article;
  /** 非致命提示：有长句被截断、译文缺失、自动转换了编码…… */
  warnings: string[];
}

/* ---------- 对外：文本解析 ---------- */

/**
 * 解析导入的文本，返回文章 + 若干提示。
 *
 * 三种格式：
 *  1. 双语对照：英文行 / 中文行交替（含"英文<TAB>中文"单行写法）；
 *  2. 只有英文：按句末标点切句，zh 留空串；
 *  3. JSON：完整 Article，或 `{ title, sentences: [{ en, zh }] }` 简写。
 *
 * 失败时抛 ArticleImportError（编码错 / JSON 错 / 句数太少 / 解析不出句子）。
 */
export function parseArticleTextDetailed(text: string, filename: string): ParsedArticle {
  assertNotMojibake(text);

  const stripped = text.replace(/^\uFEFF/, '').trim();
  if (!stripped) {
    throw new ArticleImportError('empty', '文件是空的，没有可导入的内容。');
  }

  const warnings: string[] = [];
  const parsed = looksLikeJson(stripped)
    ? parseJsonSource(stripped, warnings)
    : parsePlainSource(stripped, warnings);

  return finishArticle(parsed, filename, warnings);
}

/** 只要文章、不关心提示时的便捷入口（任务约定的签名） */
export function parseArticleText(text: string, filename: string): Article {
  return parseArticleTextDetailed(text, filename).article;
}

/* ---------- 对外：文件读取（编码兜底） ---------- */

export interface DecodedFile {
  text: string;
  /** 实际使用的编码，gbk 时界面应告诉用户"已自动转换" */
  encoding: 'utf-8' | 'gbk';
}

/**
 * 把文件字节解成字符串：优先严格 UTF-8，失败再试 GBK。
 *
 * 为什么不用 `file.text()`：它固定按 UTF-8 解，GBK 文件会得到一整篇乱码。
 * 这里直接拿字节，严格 UTF-8 解不通就说明不是 UTF-8，再试 GBK（浏览器和
 * Node 都支持这个 label）；GBK 也解不出来就退回宽松 UTF-8，让后面的
 * U+FFFD 检测去提示用户"请用 UTF-8 保存"。
 */
export function decodeArticleBytes(bytes: Uint8Array): DecodedFile {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // 不是合法 UTF-8，接着试 GBK
  }
  try {
    const gbk = new TextDecoder('gbk', { fatal: true }).decode(bytes);
    if (!gbk.includes('\uFFFD')) return { text: gbk, encoding: 'gbk' };
  } catch {
    // 环境不支持 gbk，或字节也不是合法 GBK
  }
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
}

/** 读文件（浏览器 File / Blob），返回文本与实际编码 */
export async function readArticleFile(file: Blob): Promise<DecodedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeArticleBytes(bytes);
}

/* ---------- 对外：DB ---------- */

/** 自定义文章列表（按导入时间倒序，最近导入的排前面） */
export async function listCustomArticles(): Promise<Article[]> {
  const rows = await db.customArticles.orderBy('createdAt').reverse().toArray();
  return rows.map(rowToArticle);
}

/**
 * 保存（新增或覆盖）一篇文章。
 * 覆盖时保留原 createdAt，避免"编辑一下标题，列表顺序就跳了"。
 */
export async function saveCustomArticle(article: Article): Promise<void> {
  const sentences = article.sentences
    .map((s) => ({ en: s.en.trim(), zh: s.zh.trim() }))
    .filter((s) => s.en.length > 0);
  if (sentences.length < MIN_SENTENCE_COUNT) {
    throw new ArticleImportError(
      'too-few-sentences',
      `只有 ${sentences.length} 句，至少需要 ${MIN_SENTENCE_COUNT} 句才能保存。`,
    );
  }

  const id = article.id.trim() || makeCustomArticleId();
  const existed = await db.customArticles.get(id);
  const row: CustomArticle = {
    id,
    title: article.title.trim(),
    titleZh: article.titleZh.trim(),
    level: article.level,
    author: article.author,
    sentences,
    source: article.source,
    createdAt: existed?.createdAt ?? Date.now(),
  };
  await db.customArticles.put(row);
}

/** 删除一篇文章（练习记录不动，与自定义词库的删除口径一致） */
export async function deleteCustomArticle(id: string): Promise<void> {
  await db.customArticles.delete(id);
}

/** 生成一个自定义文章 id：u + base36 时间戳 + 3 位随机，够短也可读 */
export function makeCustomArticleId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 5).padEnd(3, '0');
  return `${CUSTOM_ID_PREFIX}${ts}${rand}`;
}

/* ---------- 内部：DB 行 → Article ---------- */

function rowToArticle(row: CustomArticle): Article {
  return {
    id: row.id,
    title: row.title,
    titleZh: row.titleZh,
    level: row.level,
    author: row.author,
    sentences: row.sentences.map((s) => ({ en: s.en, zh: s.zh })),
    source: row.source,
  };
}

/* ---------- 内部：编码检测 ---------- */

/** 大量替换字符 = 编码不对，直接拒绝（继续解析只会得到一堆问号） */
function assertNotMojibake(text: string): void {
  if (!text.length) return;
  const broken = text.match(/\uFFFD/g)?.length ?? 0;
  if (broken === 0) return;
  if (broken / text.length > REPLACEMENT_CHAR_RATIO) {
    throw new ArticleImportError(
      'encoding',
      '这个文件不是 UTF-8 编码（看起来是 GBK），转出来是乱码。请用记事本 / VSCode 把文件另存为 UTF-8 再导入。',
    );
  }
}

/* ---------- 内部：格式识别 ---------- */

function looksLikeJson(text: string): boolean {
  return text.startsWith('{') || text.startsWith('[');
}

const CJK_RE = /[\u4e00-\u9fff]/;

/** 含汉字就当中文行 */
function hasCjk(s: string): boolean {
  return CJK_RE.test(s);
}

/* ---------- 内部：普通文本 ---------- */

/** 纯文本解析的中间产物（标题等元信息可能缺） */
interface ArticleDraft {
  title?: string;
  titleZh?: string;
  level?: string;
  author?: string;
  source?: string;
  sentences: ArticleSentence[];
}

function parsePlainSource(text: string, warnings: string[]): ArticleDraft {
  const { body, title, titleZh } = stripTitleLines(text);
  const lines = body.split(/\r?\n/).map((l) => l.trim());

  // 空行是段落边界：同一段内才允许"英文行 + 中文行"配对
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);

  const sentences: ArticleSentence[] = [];
  for (const block of blocks) {
    if (!block.some(hasCjk)) {
      // 整段只有英文：按句末标点切句，凑不成对的换行（硬折行）先合并
      const units = mergeWrappedLines(block, 'en');
      for (const unit of units) {
        for (const s of splitEnglishSentences(unit)) sentences.push({ en: s, zh: '' });
      }
      continue;
    }
    sentences.push(...parseBilingualBlock(block, warnings));
  }

  return { title, titleZh, sentences };
}

/**
 * 摘掉标题行。
 *
 * 支持 markdown 标题 `# xxx` 与 `标题：xxx` / `Title: xxx` 两种写法，
 * 最多各取一条（英文标题 + 中文标题）。
 */
function stripTitleLines(text: string): { body: string; title?: string; titleZh?: string } {
  let title: string | undefined;
  let titleZh: string | undefined;
  const body: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const found = pickTitleText(line);
    if (found) {
      if (hasCjk(found)) {
        if (!titleZh) {
          titleZh = found;
          continue;
        }
      } else if (!title) {
        title = found;
        continue;
      }
    }
    body.push(line);
  }
  return { body: body.join('\n'), title, titleZh };
}

function pickTitleText(line: string): string | undefined {
  if (!line) return undefined;
  const heading = /^#{1,6}\s+(.+)$/.exec(line);
  if (heading?.[1]) return heading[1].trim();
  const tagged = /^(?:title|标题)\s*[:：]\s*(.+)$/i.exec(line);
  if (tagged?.[1]) return tagged[1].trim();
  return undefined;
}

/** 块内的行类型：已经能成对的双语行 / 英文行 / 中文行 */
type LineToken =
  | { type: 'pair'; pair: ArticleSentence }
  | { type: 'en'; text: string }
  | { type: 'zh'; text: string };

function parseBilingualBlock(lines: string[], warnings: string[]): ArticleSentence[] {
  const tokens: LineToken[] = lines.map((line) => {
    const pair = splitTabLine(line);
    if (pair) return { type: 'pair', pair };
    return { type: hasCjk(line) ? 'zh' : 'en', text: line };
  });

  const out: ArticleSentence[] = [];
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i]!;
    if (head.type === 'pair') {
      out.push(head.pair);
      i += 1;
      continue;
    }

    // 先吃掉同类型的连续行，再看后面是不是另一种语言的连续行
    const first = collectRun(tokens, i, head.type);
    i = first.next;
    const secondType = head.type === 'en' ? 'zh' : 'en';
    const second = collectRun(tokens, i, secondType);
    i = second.next;

    const enLines = head.type === 'en' ? first.lines : second.lines;
    const zhLines = head.type === 'en' ? second.lines : first.lines;
    if (!enLines.length) {
      warnings.push('有一段中文找不到对应的英文，已跳过。');
      continue;
    }
    out.push(...pairRuns(enLines, zhLines, warnings));
  }
  return out;
}

function collectRun(
  tokens: LineToken[],
  from: number,
  type: 'en' | 'zh',
): { lines: string[]; next: number } {
  const lines: string[] = [];
  let i = from;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.type !== type) break;
    lines.push(token.text);
    i += 1;
  }
  return { lines, next: i };
}

/** 单行内 "英文<TAB>中文"：按是否含汉字把列分成两边 */
function splitTabLine(line: string): ArticleSentence | null {
  if (!line.includes('\t')) return null;
  const cells = line
    .split('\t')
    .map((c) => c.trim())
    .filter(Boolean)
    // 行号列（"12" / "12."）不是正文
    .filter((c) => !/^\d+[.)]?$/.test(c));
  if (cells.length < 2) return null;

  const zh = cells.filter(hasCjk);
  const en = cells.filter((c) => !hasCjk(c));
  if (!zh.length || !en.length) return null;
  return { en: en.join(' ').trim(), zh: zh.join(' ').trim() };
}

/**
 * 把英文行 / 中文行配成句子。
 *
 * 行数相等就一一对应（最常见）；只有一行译文就整段共用；
 * 对不上的部分英文保留、译文留空，并给一条提示——宁可有缺译文，也不丢句子。
 */
function pairRuns(enLines: string[], zhLines: string[], warnings: string[]): ArticleSentence[] {
  const enUnits = mergeWrappedLines(enLines, 'en');
  if (!enUnits.length) return [];
  const zhUnits = mergeWrappedLines(zhLines, 'zh');

  if (!zhUnits.length) {
    // 没有译文：一行里可能挤了好几句，再按句末标点切一遍
    const out: ArticleSentence[] = [];
    for (const unit of enUnits) {
      for (const s of splitEnglishSentences(unit)) out.push({ en: s, zh: '' });
    }
    return out;
  }

  if (enUnits.length === zhUnits.length) {
    return enUnits.map((en, k) => ({ en, zh: zhUnits[k]! }));
  }
  if (enUnits.length === 1) {
    return [{ en: enUnits[0]!, zh: zhUnits.join(' ') }];
  }
  if (zhUnits.length === 1) {
    return [{ en: enUnits.join(' '), zh: zhUnits[0]! }];
  }

  const paired = Math.min(enUnits.length, zhUnits.length);
  const out: ArticleSentence[] = [];
  for (let k = 0; k < paired; k += 1) out.push({ en: enUnits[k]!, zh: zhUnits[k]! });
  for (let k = paired; k < enUnits.length; k += 1) out.push({ en: enUnits[k]!, zh: '' });
  warnings.push('英文句数和译文行数对不上，多出来的句子译文已留空，建议检查一下原文。');
  return out;
}

/**
 * 硬折行的文本：上一行没有句末标点，就和下一行拼成一句。
 * 不做这件事的话，一次回车换行就会被当成一个"句子"。
 */
function mergeWrappedLines(lines: string[], lang: 'en' | 'zh'): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && !endsWithTerminal(prev, lang)) {
      out[out.length - 1] = lang === 'zh' ? `${prev}${line}` : `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out;
}

/** 去掉结尾引号/括号后，看是否以句末标点收尾 */
function endsWithTerminal(s: string, lang: 'en' | 'zh'): boolean {
  const bare = s
    .trim()
    .replace(/["'”’」』）)\]】]+$/, '')
    .trimEnd();
  if (lang === 'zh') return /[。！？…；;!?]$/.test(bare);
  return /[.!?…;:]$/.test(bare);
}

/* ---------- 内部：断句 ---------- */

/** 句号但不是句末的常见缩写（点号已经去掉） */
const ABBREVIATIONS = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'jr',
  'sr',
  'vs',
  'etc',
  'inc',
  'ltd',
  'co',
  'no',
  'fig',
  'cf',
  'al',
  'approx',
  'e.g',
  'i.e',
  'u.s',
  'a.m',
  'p.m',
  'a.d',
  'b.c',
  'ph.d',
]);

/**
 * 按句末标点切句。
 * 只在 `.!?…` 后面的空白处切；`Mr.` `e.g.` `J.` 这类不是句末的点号会被判为误切并拼回去。
 */
export function splitEnglishSentences(text: string): string[] {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return [];

  const pieces = flat.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  for (const piece of pieces) {
    const seg = piece.trim();
    if (!seg) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && isFalseBreak(prev)) {
      out[out.length - 1] = `${prev} ${seg}`;
    } else {
      out.push(seg);
    }
  }
  return out;
}

/** 这个"句号"其实不是句末（缩写或姓名首字母） */
function isFalseBreak(sentence: string): boolean {
  const bare = sentence.trim().replace(/["'”’)\]]+$/, '');
  const m = /([A-Za-z][A-Za-z.]*)\.$/.exec(bare);
  if (!m) return false;
  const word = m[1]!.toLowerCase();
  // 单字母大写（"J." 这种姓名首字母）
  if (word.length === 1) return true;
  return ABBREVIATIONS.has(word);
}

/* ---------- 内部：JSON ---------- */

function parseJsonSource(text: string, warnings: string[]): ArticleDraft {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new ArticleImportError('invalid-json', 'JSON 解析失败，请检查文件内容是否完整。');
  }

  // 数组：[{ en, zh }] 或 ["英文", ...]
  if (Array.isArray(raw)) {
    return { sentences: raw.map(toSentence).filter((s): s is ArticleSentence => !!s) };
  }
  if (!raw || typeof raw !== 'object') {
    throw new ArticleImportError('invalid-json', 'JSON 内容不是一个对象或数组，无法识别。');
  }

  const obj = raw as Record<string, unknown>;
  const list = obj.sentences ?? obj.paragraphs ?? obj.lines;
  if (!Array.isArray(list)) {
    throw new ArticleImportError(
      'invalid-json',
      'JSON 里没有找到 sentences 数组。需要 { "title": "...", "sentences": [{ "en": "...", "zh": "..." }] } 这种结构。',
    );
  }

  const draft: ArticleDraft = {
    sentences: list.map(toSentence).filter((s): s is ArticleSentence => !!s),
  };
  draft.title = str(obj.title) ?? str(obj.name);
  draft.titleZh = str(obj.titleZh) ?? str(obj.titleCn) ?? str(obj.title_zh);
  draft.level = str(obj.level) ?? str(obj.difficulty);
  draft.author = str(obj.author) ?? str(obj.source);
  draft.source = str(obj.source);

  // 兼容 sentences 是字符串数组时，顶层给了整段译文的情况（少见，不猜）
  if (!draft.sentences.length) warnings.push('JSON 里没有解析出句子。');

  return draft;
}

/** 取字符串字段（空白视为没有） */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/** 一条句子：兼容 { en, zh } / { text, cn } / 纯字符串 */
function toSentence(raw: unknown): ArticleSentence | null {
  if (typeof raw === 'string') {
    const en = raw.trim();
    return en ? { en, zh: '' } : null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const en = str(o.en) ?? str(o.text) ?? str(o.english) ?? str(o.sentence);
  if (!en) return null;
  const zh = str(o.zh) ?? str(o.cn) ?? str(o.chinese) ?? str(o.translation) ?? '';
  return { en, zh };
}

/* ---------- 内部：收尾（清洗 / 截断 / 校验 / 元信息） ---------- */

function finishArticle(draft: ArticleDraft, filename: string, warnings: string[]): ParsedArticle {
  const sentences: ArticleSentence[] = [];
  let truncated = 0;

  for (const s of draft.sentences) {
    const en = s.en.replace(/\s+/g, ' ').trim();
    if (!en) continue;
    const zh = s.zh.replace(/\s+/g, ' ').trim();
    if (en.length > MAX_SENTENCE_CHARS) {
      truncated += 1;
      sentences.push({ en: truncateSentence(en), zh });
    } else {
      sentences.push({ en, zh });
    }
  }

  if (truncated > 0) {
    warnings.push(
      `有 ${truncated} 句超过 ${MAX_SENTENCE_CHARS} 字符，已在词边界截断并补「…」（长句逐字符跟打太难受）。`,
    );
  }
  if (sentences.length && sentences.every((s) => !s.zh)) {
    warnings.push('没有找到中文译文，练习时会只显示英文。');
  }

  if (!sentences.length) {
    throw new ArticleImportError(
      'no-sentences',
      '没有解析出任何句子。请确认文件是「英文行 + 中文行」交替，或是带 sentences 数组的 JSON。',
    );
  }
  if (sentences.length < MIN_SENTENCE_COUNT) {
    throw new ArticleImportError(
      'too-few-sentences',
      `只解析出 ${sentences.length} 句，至少需要 ${MIN_SENTENCE_COUNT} 句——太短的文章练不出效果。`,
    );
  }

  const fallbackTitle = titleFromFilename(filename);
  const article: Article = {
    id: makeCustomArticleId(),
    title: (draft.title ?? fallbackTitle).slice(0, 120),
    titleZh: (draft.titleZh ?? '').slice(0, 120),
    level: normalizeLevel(draft.level, filename),
    author: (draft.author ?? '用户导入').slice(0, 80),
    sentences,
    source: (draft.source ?? `导入自 ${filename || '剪贴板'}`).slice(0, 200),
  };
  return { article, warnings };
}

/** 超长句在词边界截断，补「…」表示后文被略去（与内置语料的标记法一致） */
export function truncateSentence(en: string, max = MAX_SENTENCE_CHARS): string {
  if (en.length <= max) return en;
  const cut = en.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  // 词边界太靠前（比如一长串没有空格的字符）就不硬找了
  const body = space > cut.length * 0.6 ? cut.slice(0, space) : cut;
  return `${body.trimEnd()}…`;
}

/** 文件名 → 标题："cet4_the-old-man.txt" → "cet4 the old man" */
export function titleFromFilename(filename: string): string {
  const base = filename
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base.slice(0, 120) || '自定义文章';
}

/** 难度标签归一化：先认显式值，再从文件名里猜，最后落到 CET-4 */
export function normalizeLevel(raw?: string, filename = ''): ArticleLevel {
  const explicit = matchLevel(raw ?? '');
  if (explicit) return explicit;
  const fromName = matchLevel(filename);
  if (fromName) return fromName;
  return 'CET-4';
}

function matchLevel(text: string): ArticleLevel | null {
  const s = text.toLowerCase();
  if (!s) return null;
  if (/cet[-\s_]?6|六级/.test(s)) return 'CET-6';
  if (/cet[-\s_]?4|四级/.test(s)) return 'CET-4';
  if (/考研|kaoyan|postgrad/.test(s)) return '考研';
  if (/雅思|ielts/.test(s)) return '雅思';
  return null;
}

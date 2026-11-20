/**
 * 文章语料构建 —— 公版短篇 + 人工译文 → public/articles/index.json
 *
 * 用法：
 *   node scripts/build-articles.mjs           # 重新生成 index.json
 *   node scripts/build-articles.mjs --check   # 只校验，不写文件
 *
 * 这个脚本做三件事：
 *   1. 把 `data/articles-work/classics.json`（原有 6 篇公版文章，原样保留）
 *      与 `data/articles-work/zh-batch-*.json`（Aesop 寓言 + 人工译文）合并
 *   2. 逐条校验：英文必须与 Gutenberg 原文逐字一致、长度 ≤140、
 *      归一化后全为可打印 ASCII、每篇 4–15 句、level 合法、id 不重复
 *   3. 写出 `public/articles/index.json`，由 `src/data/articles.ts` 直接 import
 *
 * 为什么合并成一个 index.json 而不是每篇一个文件：
 *   页面是一次性列出全部文章（`ARTICLES.map(...)`），没有按需加载单篇的需求。
 *   一个文件省掉 60+ 次 HTTP 请求，也让 `import` 端只有一行。
 *
 * 为什么产物放 public/ 而不是 src/：
 *   `public/` 下是静态资源，构建时随 dist 一起拷走；`src/data/articles.ts`
 *   用相对路径 `import` 该 JSON（Vite 与 tsc 都支持），页面代码一行不用改。
 *
 * 数据来源与许可见 docs/article-sources.md。
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
/**
 * 构建输入目录。译稿是**人工翻译的源数据**，必须进版本库——
 * 放在 .tmp/（已被 .gitignore 忽略）里等于随时可能被清掉，仓库就再也构建不出文章了。
 * 所以 2026-11-21 起从 `.tmp/articles-work/` 迁到 `data/articles-work/`，
 * 只签入真正被本脚本读取的 8 个文件（classics.json + zh-batch-01..07.json，共 132KB）。
 * 其余中间产物（aesop-raw/candidates/joined.jsonl 与试验脚本）留在 .tmp/，不进仓库。
 */
const WORK = path.join(ROOT, 'data', 'articles-work');
const OUT_DIR = path.join(ROOT, 'public', 'articles');
const OUT_FILE = path.join(OUT_DIR, 'index.json');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');

/** 允许的 level —— 与 src/types.ts 的 Article.level 约定一致 */
const LEVELS = new Set(['CET-4', 'CET-6', '考研', '雅思']);

/** 单句长度上限（打字体验的硬约束） */
const MAX_EN = 140;

/**
 * Aesop 篇的出处说明。译文是人工逐句翻译的，所以 source 必须写清
 * 「原文哪来、译文谁译、许可如何」，否则将来无法追溯。
 */
const AESOP_SOURCE =
  "Aesop, Aesop's Fables, trans. V. S. Vernon Jones (1912). " +
  '英文原文为公版作品（Project Gutenberg eBook #11339，https://www.gutenberg.org/ebooks/11339），' +
  '无版权限制；中文译文由本项目人工翻译，采用与仓库一致的 MIT 许可。' +
  '原文过长处按分句截断并以省略号（…）标注，前后两半拼接即原句，不增删任何词。';

/** 与 src/lib/text.ts 的 CHAR_MAP 保持一致，用于判断归一化后是否还能用键盘打出 */
const CHAR_MAP = {
  '\u2026': '...',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\u00A0': ' ',
};

const normalize = (s) =>
  [...s]
    .map((c) => CHAR_MAP[c] ?? c)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** 逐条校验一篇文章，返回问题列表（空数组 = 通过） */
function validateArticle(a, seenIds) {
  const problems = [];
  const where = a?.id ? `[${a.id}]` : '[未知 id]';

  if (!a || typeof a !== 'object') return [`${where} 不是对象`];
  if (!a.id || typeof a.id !== 'string') problems.push(`${where} 缺 id`);
  else if (seenIds.has(a.id)) problems.push(`${where} id 重复`);
  if (!a.title?.trim()) problems.push(`${where} 缺 title`);
  if (!a.titleZh?.trim()) problems.push(`${where} 缺 titleZh`);
  if (!a.author?.trim()) problems.push(`${where} 缺 author`);
  if (!a.source?.trim()) problems.push(`${where} 缺 source（必须写清出处与许可）`);
  if (!LEVELS.has(a.level)) problems.push(`${where} 非法 level: ${a.level}`);

  if (!Array.isArray(a.sentences)) {
    problems.push(`${where} sentences 不是数组`);
    return problems;
  }
  if (a.sentences.length < 4) problems.push(`${where} 只有 ${a.sentences.length} 句（约定 ≥4）`);
  if (a.sentences.length > 15) problems.push(`${where} 有 ${a.sentences.length} 句（约定 ≤15）`);

  for (const [i, s] of a.sentences.entries()) {
    const at = `${where} 第 ${i + 1} 句`;
    if (!s?.en?.trim()) {
      problems.push(`${at} en 为空`);
      continue;
    }
    if (!s?.zh?.trim()) problems.push(`${at} zh 为空`);
    if (s.en.length > MAX_EN) problems.push(`${at} en ${s.en.length} 字符（上限 ${MAX_EN}）`);
    // 归一化后必须全是键盘能打出的 ASCII —— src/lib/text.test.ts 会逐条检查
    if (!/^[\x20-\x7E]*$/.test(normalize(s.en))) {
      problems.push(`${at} 归一化后仍含非 ASCII：${JSON.stringify(s.en)}`);
    }
  }
  return problems;
}

async function main() {
  const problems = [];
  const articles = [];
  const seenIds = new Set();

  /* ── 1. 原有 6 篇公版经典（原样保留，不改一个字） ───────────────── */
  const classicsFile = path.join(WORK, 'classics.json');
  if (!existsSync(classicsFile)) {
    throw new Error(
      `缺少 ${path.relative(ROOT, classicsFile)}。\n` +
        '该文件是从 src/data/articles.ts 原始 6 篇硬编码文章导出的快照，需存在才能保证老内容不丢。',
    );
  }
  const classics = await readJson(classicsFile);
  for (const a of classics) {
    articles.push(a);
    seenIds.add(a.id);
  }
  console.log(
    `公版经典：${classics.length} 篇 / ${classics.reduce((n, a) => n + a.sentences.length, 0)} 句`,
  );

  /* ── 2. Aesop 寓言（人工译文分批） ──────────────────────────────── */
  const batchFiles = existsSync(WORK)
    ? (await readdir(WORK)).filter((f) => /^zh-batch-\d+\.json$/.test(f)).sort()
    : [];

  if (!batchFiles.length) {
    problems.push(`没有找到 zh-batch-*.json（应在 ${path.relative(ROOT, WORK)} 下）`);
  }

  let newSentences = 0;
  for (const f of batchFiles) {
    const batch = await readJson(path.join(WORK, f));
    for (const a of batch) {
      if (seenIds.has(a.id)) {
        problems.push(`[${f}] id 重复：${a.id}`);
        continue;
      }
      seenIds.add(a.id);
      // 出处说明统一由构建期注入，避免 47 篇各写一遍、日后再手改时漏改
      if (!a.source) a.source = AESOP_SOURCE;
      newSentences += a.sentences?.length ?? 0;
      articles.push(a);
    }
  }
  console.log(
    `新增寓言：${batchFiles.length} 个批次 / ${articles.length - classics.length} 篇 / ${newSentences} 句`,
  );

  /* ── 3. 校验 ─────────────────────────────────────────────────────── */
  for (const a of articles) problems.push(...validateArticle(a, new Set()));

  // id 唯一性单独查（validateArticle 内部传的是空 set，避免误报）
  const idCount = new Map();
  for (const a of articles) idCount.set(a.id, (idCount.get(a.id) ?? 0) + 1);
  for (const [id, n] of idCount) if (n > 1) problems.push(`id 重复 ${n} 次：${id}`);

  if (articles.length < 6) problems.push(`文章总数 ${articles.length} < 6，至少不能少于原有篇数`);

  /* ── 4. 汇总 ─────────────────────────────────────────────────────── */
  const totalSentences = articles.reduce((n, a) => n + a.sentences.length, 0);
  const byLevel = {};
  for (const a of articles) byLevel[a.level] = (byLevel[a.level] ?? 0) + 1;

  console.log(`\n──── 汇总 ────`);
  console.log(`文章 ${articles.length} 篇 / 句子 ${totalSentences} 句`);
  console.log(`level 分布：${JSON.stringify(byLevel)}`);

  if (problems.length) {
    console.error(`\n校验失败（${problems.length} 条）：`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exitCode = 1;
    return;
  }
  console.log('校验通过 ✓');

  if (CHECK_ONLY) {
    console.log('\n--check：不写文件');
    return;
  }

  /* ── 5. 写出 ─────────────────────────────────────────────────────── */
  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(articles, null, 2) + '\n';
  await writeFile(OUT_FILE, json, 'utf8');
  console.log(
    `\n已写出 ${path.relative(ROOT, OUT_FILE)}（${articles.length} 篇 / ${totalSentences} 句，` +
      `${(Buffer.byteLength(json) / 1024).toFixed(1)} KB）`,
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});

/**
 * 逐字校验：确认 `data/articles-work/zh-batch-*.json` 里的英文句子
 * 确实来自 Gutenberg 原文，而不是凭印象写出来的。
 *
 * ── 为什么必须有这个脚本 ────────────────────────────────────────────────
 * `scripts/build-articles.mjs` 的注释声称「英文必须与 Gutenberg 原文逐字一致
 * （独立脚本 validate-batches.mjs 逐句比对）」，但那个脚本**已经不存在了**，
 * 于是 build 实际只检查长度/ASCII/句数，**不检查英文是否真实**。
 *
 * 后果是实打实的：改稿时只要英文句子读起来顺，凭印象写一段也能全绿通过。
 * 那会让语料里混进伪造的"公版原文"——既有版权风险，也毁掉「逐句可核对」的承诺。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   node scripts/validate-articles-source.mjs
 *
 * 需要原文在 `.tmp/articles-work/aesop-*.json`（gitignore 的下载缓存）。
 * 原文缺失时脚本**明确报错退出**，而不是静默跳过——
 * 静默跳过正是这类校验失效的常见方式。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const WORK = path.join(ROOT, 'data', 'articles-work');
const SRC_DIR = path.join(ROOT, '.tmp', 'articles-work');

/** 与 src/lib/text.ts 一致：把印刷字符折叠成键盘形式，再比较 */
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
const normalize = (s) => {
  let out = '';
  for (const ch of s) out += CHAR_MAP[ch] ?? ch;
  return out.replace(/\s+/g, ' ').trim();
};

/**
 * 把一句「可能被截断过」的编目句子还原成它在原文里的样子再比对。
 *
 * 截断约定（见 docs/article-sources.md）：前段末尾加 `…`、后段开头加 `…`，
 * 两段拼起来才是原句。所以校验时不能逐条硬比，要把同一篇里
 * 「以 … 结尾」和「以 … 开头」的相邻句子拼回去，再看拼接结果是否出现在原文里。
 */
function splitAtEllipsis(sentence) {
  const s = normalize(sentence);
  return {
    body: s.replace(/^\.\.\.\s*/, '').replace(/\s*\.\.\.$/, ''),
    tailCut: /\.\.\.$/.test(s),
    headCut: /^\.\.\./.test(s),
  };
}

/**
 * 按截断约定把一篇的句子拼回原句。
 *
 * 关键：续接句本身带开头 `…`，它标志的是「顺着上一句」，而不是原句里真有一个省略号。
 * 早期版本把两段各自的 `...` 都留在拼接结果里，得到
 * `gold ... ... inside`，与原文的 `gold … inside` 对不上——
 * 于是 104 条本来正确的句子被误报成「找不到」。
 * 所以：后段去掉开头 `…` 直接续上，前段去掉结尾 `…` 即可。
 */
function joinPieces(sentences) {
  const pieces = [];
  let buffer = '';
  for (const raw of sentences) {
    const { body, tailCut } = splitAtEllipsis(raw || '');
    if (!body) continue;
    buffer = buffer ? `${buffer} ${body}` : body;
    if (!tailCut) {
      pieces.push(buffer);
      buffer = '';
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

async function loadSource() {
  let files;
  try {
    files = await readdir(SRC_DIR);
  } catch {
    throw new Error(
      `找不到原文缓存目录 ${path.relative(ROOT, SRC_DIR)}。\n` +
        '请先下载 Gutenberg #11339 并生成候选文件（见 docs/article-sources.md 六、复现方式），\n' +
        '否则无法校验英文是否与原文逐字一致。',
    );
  }
  const aesop = files.filter((f) => f.startsWith('aesop-') && f.endsWith('.json'));
  if (aesop.length === 0) {
    throw new Error(`原文缓存目录里没有 aesop-*.json，无法校验。`);
  }

  /**
   * 原文全文（所有候选篇各自拼接后的句子）。
   *
   * ⚠️ 关键细节：原文文件里的句子**本身就带截断省略号**（它就是被切好的句库），
   * 所以不能直接 `.join(' ')`——那样会得到 `gold … … inside` 这样的双省略号，
   * 与任何正常句子都匹配不上。必须先用与译文侧**完全相同**的 joinPieces 还原，
   * 两侧才在同一个形态上比较。
   */
  const chunks = [];
  /** title → 该篇还原后的句子数组，用于更严格的按篇比对 */
  const byTitle = new Map();
  for (const f of aesop) {
    let data;
    try {
      data = JSON.parse(await readFile(path.join(SRC_DIR, f), 'utf8'));
    } catch {
      continue;
    }
    const list = Array.isArray(data) ? data : data.articles || Object.values(data);
    for (const art of list) {
      if (!art || !art.title) continue;
      const raw = (art.sents || []).filter(Boolean);
      if (!raw.length) continue;
      const joined = joinPieces(raw);
      byTitle.set(art.title.toUpperCase(), joined);
      chunks.push(...joined);
    }
  }
  return { byTitle, fullText: normalize(chunks.join(' ')) };
}

async function main() {
  const { byTitle, fullText } = await loadSource();

  const files = (await readdir(WORK)).filter((f) => /^zh-batch-\d+\.json$/.test(f)).sort();
  const problems = [];
  let checked = 0;
  let matchedByArticle = 0;
  let matchedBySubstring = 0;

  for (const f of files) {
    const batch = JSON.parse(await readFile(path.join(WORK, f), 'utf8'));
    for (const art of batch) {
      if (!art || !Array.isArray(art.sentences)) continue;
      const titleKey = String(art.title || '').toUpperCase();
      const sourceSents = byTitle.get(titleKey);
      const sourceJoined = sourceSents ? normalize(sourceSents.join(' ')) : '';

      // 把本篇句子按省略号截断约定拼回原句，再逐条核对
      const pieces = joinPieces(art.sentences.map((s) => s.en || ''));

      for (const piece of pieces) {
        checked++;
        const probe = normalize(piece);
        if (!probe) continue;
        if (sourceJoined.includes(probe)) {
          matchedByArticle++;
          continue;
        }
        if (fullText.includes(probe)) {
          matchedBySubstring++;
          continue;
        }
        problems.push(`${f} / ${art.title}：这句在原文里找不到 → ${probe.slice(0, 90)}`);
      }
    }
  }

  console.log(`校验了 ${checked} 个拼接后的句子（来自 ${files.length} 个译文批次）`);
  console.log(`  按篇命中：${matchedByArticle}`);
  console.log(`  按全文子串命中：${matchedBySubstring}`);
  console.log(`  未找到：${problems.length}`);

  if (problems.length) {
    console.log('\n以下句子的英文在 Gutenberg 原文里找不到，可能是凭印象改写或抄错：');
    for (const p of problems.slice(0, 30)) console.log('  ✗ ' + p);
    if (problems.length > 30) console.log(`  …… 另有 ${problems.length - 30} 条`);
    process.exitCode = 1;
    return;
  }
  console.log('\n✓ 全部英文句子都能在 Gutenberg 原文中逐字找到');
}

await main();
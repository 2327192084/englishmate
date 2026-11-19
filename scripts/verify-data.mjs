#!/usr/bin/env node
/**
 * TypeFlow · 数据产物自检
 * ------------------------------------------------------------------
 * 校验 scripts/build-dicts.mjs 的产物与 src/data/articles.ts 是否满足契约：
 *
 *  A. 词库 public/dicts/<id>.json + index.json
 *     - 文件存在且能被 JSON.parse
 *     - words.length === meta.count
 *     - meta 六个字段齐全、类型正确、id 与文件名一致
 *     - 无重复 w（大小写不敏感）、无空 t、w 长度 1–64 且不含换行
 *     - p 若有则形如 /…/，且不含空内容
 *     - index.json 的 banks 与各文件 meta 一致
 *
 *  B. 文章 src/data/articles.ts
 *     - 6 篇，id 为 gettysburg/turing/einstein/shakespeare/jobs/orwell
 *     - level 只能是 CET-4 / CET-6 / 考研 / 雅思
 *     - 每篇 6–10 句，每句 en ≤ 120 字符、zh 非空
 *     - 用 esbuild 真实转译执行，不是正则扫文本
 *
 * 用法：node scripts/verify-data.mjs
 * 退出码：0 全通过，1 有失败项（便于 CI / pre-commit 挂接）
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');

/**
 * 词库清单**从 index.json 动态读取**，不再硬编码。
 *
 * 原来这里写死了 8 个 id，每加一个词库就要改脚本，且断言 "banks 应为 8 项"
 * 会误报。改为以 index.json 为准，脚本只校验「索引与实际文件是否一致」。
 */
let BANK_IDS = [];
const META_KEYS = ['category', 'count', 'description', 'id', 'name', 'source'];
const CATEGORIES = new Set(['exam', 'programming', 'basic']);
const MIN_WORDS = 100;
const MAX_WORD_LEN = 64;

const ARTICLE_IDS = ['gettysburg', 'turing', 'einstein', 'shakespeare', 'jobs', 'orwell'];
const LEVELS = new Set(['CET-4', 'CET-6', '考研', '雅思']);
const MAX_EN = 120;

const problems = [];
const fail = (scope, message) => problems.push(`[${scope}] ${message}`);

/* ------------------------------ A. 词库 ------------------------------ */

async function loadBankIds() {
  try {
    const raw = await readFile(path.join(DICT_DIR, 'index.json'), 'utf8');
    const idx = JSON.parse(raw);
    BANK_IDS = (idx.banks || []).map((b) => b.id);
    return idx;
  } catch (e) {
    fail('index', `无法读取 index.json：${e.message}`);
    return null;
  }
}

async function checkDicts() {
  console.log('■ 词库产物');
  await loadBankIds();
  if (BANK_IDS.length === 0) {
    fail('index', 'index.json 里没有任何词库');
    return;
  }
  const metas = new Map();
  let totalWords = 0;
  let totalBytes = 0;

  for (const id of BANK_IDS) {
    const file = path.join(DICT_DIR, `${id}.json`);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      fail(id, '文件不存在或不可读');
      continue;
    }
    totalBytes += Buffer.byteLength(text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      fail(id, `不是合法 JSON（${err.message}）`);
      continue;
    }

    const meta = data?.meta;
    const words = data?.words;
    if (!meta || typeof meta !== 'object') {
      fail(id, '缺 meta');
      continue;
    }
    if (!Array.isArray(words)) {
      fail(id, 'words 不是数组');
      continue;
    }

    // meta 字段完整性
    const keys = Object.keys(meta).sort();
    if (keys.join(',') !== META_KEYS.join(',')) {
      fail(id, `meta 字段应为 ${META_KEYS.join(',')}，实际 ${keys.join(',')}`);
    }
    if (meta.id !== id) fail(id, `meta.id=${meta.id} 与文件名不一致`);
    if (!CATEGORIES.has(meta.category)) fail(id, `category 非法：${meta.category}`);
    if (typeof meta.name !== 'string' || !meta.name.trim()) fail(id, 'name 为空');
    if (typeof meta.description !== 'string' || !meta.description.trim())
      fail(id, 'description 为空');
    if (typeof meta.source !== 'string' || !/qwerty\s*learner/i.test(meta.source)) {
      fail(id, `source 未标注来源：${meta.source}`);
    }
    if (!/\(MIT\)/.test(String(meta.source))) fail(id, 'source 未标注 MIT 许可');

    // 计数一致性
    if (words.length !== meta.count)
      fail(id, `count 不符：words=${words.length} meta.count=${meta.count}`);
    if (words.length < MIN_WORDS) fail(id, `词条仅 ${words.length}，低于下限 ${MIN_WORDS}`);

    // 逐条校验
    const seen = new Set();
    let dup = 0;
    let emptyT = 0;
    let badW = 0;
    let badP = 0;
    for (const word of words) {
      const w = word?.w;
      const t = word?.t;

      if (typeof w !== 'string' || !w.trim()) badW += 1;
      else if (w !== w.trim()) badW += 1;
      else if (w.length > MAX_WORD_LEN) badW += 1;
      else if (/[\r\n]/.test(w)) badW += 1;

      if (typeof t !== 'string' || !t.trim()) emptyT += 1;

      const key = typeof w === 'string' ? w.toLowerCase() : '';
      if (key) {
        if (seen.has(key)) dup += 1;
        else seen.add(key);
      }

      if (word?.p !== undefined) {
        const p = word.p;
        if (typeof p !== 'string' || !p.startsWith('/') || !p.endsWith('/') || p.length < 3)
          badP += 1;
      }
    }
    if (dup) fail(id, `重复单词 ${dup} 条`);
    if (emptyT) fail(id, `空释义 ${emptyT} 条`);
    if (badW) fail(id, `非法单词 ${badW} 条`);
    if (badP) fail(id, `音标格式不合规 ${badP} 条`);

    metas.set(id, meta);
    totalWords += words.length;
    console.log(
      `  ${id.padEnd(8)} ${String(words.length).padStart(5)} 词条` +
        `  ${(Buffer.byteLength(text) / 1024).toFixed(1).padStart(7)} KB  ` +
        (dup || emptyT || badW || badP ? '✗' : '✓'),
    );
  }

  // index.json
  let index = null;
  try {
    index = JSON.parse(await readFile(path.join(DICT_DIR, 'index.json'), 'utf8'));
    totalBytes += Buffer.byteLength(JSON.stringify(index));
  } catch (err) {
    fail('index', `缺失或不可解析（${err.message}）`);
  }
  if (index) {
    if (typeof index.generatedAt !== 'string' || Number.isNaN(Date.parse(index.generatedAt))) {
      fail('index', 'generatedAt 不是合法 ISO 时间');
    }
    if (!Array.isArray(index.banks) || index.banks.length === 0) {
      fail('index', 'banks 为空');
    } else {
      const indexIds = index.banks.map((b) => b.id).sort();
      if (indexIds.join(',') !== [...BANK_IDS].sort().join(','))
        fail('index', 'banks 的 id 集合不符');
      for (const bank of index.banks) {
        const meta = metas.get(bank.id);
        if (!meta) continue;
        // index 与单文件 meta 必须逐字段一致（count 尤其重要）
        if (JSON.stringify(bank) !== JSON.stringify(meta)) {
          fail('index', `banks[${bank.id}] 与单文件 meta 不一致`);
        }
      }
    }
    if (index.banks?.reduce((sum, b) => sum + (b.count || 0), 0) !== totalWords) {
      fail('index', 'banks 的 count 之和与词条总数不符');
    }
  }

  console.log(`  合计 ${totalWords} 词条 / 约 ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  return totalWords;
}

/* ------------------------------ B. 文章 ------------------------------ */

async function checkArticles() {
  console.log('\n■ 文章语料');

  let transform;
  try {
    ({ transform } = await import('esbuild'));
  } catch {
    fail('articles', '缺少 esbuild，无法执行验证（它随 vite 安装，正常应在 node_modules 内）');
    return 0;
  }

  const src = await readFile(path.join(ROOT, 'src', 'data', 'articles.ts'), 'utf8');
  const { code } = await transform(src, { loader: 'ts', format: 'esm', target: 'es2022' });
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64');

  let articles;
  try {
    articles = (await import(dataUrl)).ARTICLES;
  } catch (err) {
    fail('articles', `执行模块失败（${err.message}）`);
    return 0;
  }
  if (!Array.isArray(articles)) {
    fail('articles', 'ARTICLES 不是数组');
    return 0;
  }

  let totalSentences = 0;
  for (const article of articles) {
    const id = article?.id ?? '(无 id)';
    if (typeof article?.id !== 'string' || !article.id.trim()) fail(id, '缺 id');
    if (typeof article?.title !== 'string' || !article.title.trim()) fail(id, '缺 title');
    if (typeof article?.titleZh !== 'string' || !article.titleZh.trim()) fail(id, '缺 titleZh');
    if (typeof article?.author !== 'string' || !article.author.trim()) fail(id, '缺 author');
    if (typeof article?.source !== 'string' || !article.source.trim()) fail(id, '缺 source');
    if (!LEVELS.has(article?.level)) fail(id, `level 非法：${article?.level}`);

    const sentences = Array.isArray(article?.sentences) ? article.sentences : [];
    if (sentences.length < 6 || sentences.length > 10) {
      fail(id, `句数 ${sentences.length} 越界（要求 6–10）`);
    }
    sentences.forEach((sentence, i) => {
      const en = typeof sentence?.en === 'string' ? sentence.en : '';
      const zh = typeof sentence?.zh === 'string' ? sentence.zh : '';
      if (!en.trim()) fail(id, `第 ${i + 1} 句 en 为空`);
      if (en.length > MAX_EN) fail(id, `第 ${i + 1} 句 en ${en.length} 字符，超过 ${MAX_EN}`);
      if (!zh.trim()) fail(id, `第 ${i + 1} 句 zh 为空`);
      if (/[\r\n\t]/.test(en) || /[\r\n\t]/.test(zh)) fail(id, `第 ${i + 1} 句含换行/制表符`);
    });

    totalSentences += sentences.length;
    const maxEn = sentences.reduce((m, s) => Math.max(m, (s?.en ?? '').length), 0);
    console.log(
      `  ${String(id).padEnd(13)} ${String(article?.level).padEnd(6)} ` +
        `${String(sentences.length).padStart(2)} 句  最长 en ${String(maxEn).padStart(3)} 字符  ✓`,
    );
  }

  const ids = articles.map((a) => a?.id);
  for (const expected of ARTICLE_IDS)
    if (!ids.includes(expected)) fail('articles', `缺文章 ${expected}`);
  if (new Set(ids).size !== ids.length) fail('articles', 'id 有重复');
  if (articles.length !== ARTICLE_IDS.length) {
    fail('articles', `应为 ${ARTICLE_IDS.length} 篇，实际 ${articles.length}`);
  }

  console.log(`  合计 ${articles.length} 篇 / ${totalSentences} 句`);
  return articles.length;
}

/* ------------------------------ 主流程 ------------------------------ */

try {
  const wordCount = await checkDicts();
  const articleCount = await checkArticles();

  console.log('');
  if (problems.length) {
    console.log(`✗ 自检失败，共 ${problems.length} 项：`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`✓ 全部通过：${BANK_IDS.length} 个词库 / ${wordCount} 词条 / ${articleCount} 篇文章`);
} catch (err) {
  console.error(`✗ 自检异常终止：${err?.stack || err}`);
  process.exit(1);
}

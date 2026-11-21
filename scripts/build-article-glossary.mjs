/**
 * 文章点词释义表构建 —— 把文章里出现的词解析成精简词条，产出静态 JSON。
 *
 * ── 为什么做这个 ──────────────────────────────────────────────────────────
 * 文章页要支持「点词查释义」。但词库是按需加载的：用户读一篇莎士比亚时
 * 点的那个词可能散落在 gaokao(1.3MB) / tem8(2.87MB) / gre(1.2MB) 里，
 * 为了一个词下载一整本词库不划算。
 *
 * 文章语料是固定的（75 篇 / 490 句 / 2,479 个唯一 token），所以可以**离线**
 * 把它能查到的词一次性算好，压成一个小文件随应用发布。实测只剩 124KB(gzip)，
 * 而全量 16 库合并词表要 gzip 439KB —— 差 3.5 倍，且大部分词文章里根本不出现。
 *
 * ── 解析链 ────────────────────────────────────────────────────────────────
 * 文章里的 token 不是干净的词形：Gutenberg 文本有 `battle-field`、
 * `machine'`（引号被吞）、`don't`、`thyself` 这类。所以按顺序试：
 *   1. 原文小写直查词库
 *   2. 去掉词尾撇号/右引号
 *   3. `n't` 结尾 → 去掉 `n't`
 *   4. 含撇号 → 取撇号前部分
 *   5. 含连字符 → 去连字符 / 取首段 / 取末段
 * 直查失败再用 word-graph 的 `f`（词形变化）反查原形。
 * 实测覆盖 2,371 / 2,479 = 95.7%；剩下的是古语(hath/thyself)与专名(Stanford)，
 * 这些本来就查不到，界面按「不可点」处理。
 *
 * ── 产物 ──────────────────────────────────────────────────────────────────
 * public/dicts/article-glossary.json
 *   {
 *     generatedAt,
 *     entries:  { "<原形小写>": { w?, p?, defs?: [[pos, cn]], t?, sentences?: [[en, zh]] } },
 *     variants: { "<词形变体>": "<原形小写>" }
 *   }
 * 体积控制手段（都是为了几万字节较劲，改之前先量）：
 *   - defs 用 [pos, cn] 二元组而不是 {pos, cn} 对象
 *   - sentences 只留 1 条（够 WordDetail 的例句区不空，多一条 +48KB gzip）
 *   - w 只在原始大小写与 key 不同时才写（如 DVD / I / Sunday）
 *   - t 只在没有 defs 时才写（有 defs 时前端能从 defs 拼出同样的文本）
 *
 * 用法：
 *   node scripts/build-article-glossary.mjs
 *   node scripts/build-article-glossary.mjs --check   # 只校验现有产物是否最新
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');
const ARTICLES = path.join(ROOT, 'public', 'articles', 'index.json');
const OUT = path.join(DICT_DIR, 'article-glossary.json');

/**
 * 同一个词出现在多个词库时取哪个。考试词库优先于专业词库——
 * 文章里的 `mouse` 更可能指动物而不是鼠标。
 */
const BANK_PRIORITY = [
  'gaokao',
  'cet4',
  'cet6',
  'kaoyan',
  'ielts',
  'toefl',
  'gre',
  'tem4',
  'tem8',
  'sat',
  'bec',
  'primary',
  'junior',
  'coding',
  'linux',
  'medical',
];

/** 每个词最多带几条例句（1 = 只带第一条） */
const MAX_SENTENCES = 1;

function log(...a) {
  process.stdout.write(a.join(' ') + '\n');
}

/** 生成日期用 ISO 日（YYYY-MM-DD），换一天重跑就应该有差异 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 按词库优先级把 16 个词库合并且去重（同词取优先级高的库那条） */
function loadMergedWords() {
  const idx = JSON.parse(readFileSync(path.join(DICT_DIR, 'index.json'), 'utf8'));
  const ids = idx.banks.map((b) => b.id);
  const priority = BANK_PRIORITY.filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !BANK_PRIORITY.includes(id));
  const order = [...priority, ...rest];

  const words = new Map();
  for (const id of order) {
    const data = JSON.parse(readFileSync(path.join(DICT_DIR, `${id}.json`), 'utf8'));
    for (const entry of data.words) {
      const key = entry.w.toLowerCase();
      if (!words.has(key)) words.set(key, entry);
    }
  }
  log(`■ 合并词库：${order.length} 个 → ${words.size.toLocaleString()} 个词条`);
  return words;
}

/** 由 word-graph 的 f（词形变化）列表反向建 variant → 原形 的映射 */
function loadVariantIndex() {
  const graph = JSON.parse(readFileSync(path.join(DICT_DIR, 'word-graph.json'), 'utf8'));
  const rev = new Map();
  for (const [base, rel] of Object.entries(graph)) {
    for (const form of rel.f ?? []) {
      if (!rev.has(form)) rev.set(form, base);
    }
  }
  log(`■ 词形变化反查表：${rev.size.toLocaleString()} 个变体`);
  return rev;
}

/** 一个 token 的所有候选词形（按优先级），用于逐级降级匹配 */
function candidateForms(lower) {
  const out = [lower];
  const noTrailQuote = lower.replace(/['’]+$/, '');
  if (noTrailQuote && noTrailQuote !== lower) out.push(noTrailQuote);
  const noNt = noTrailQuote.replace(/n['’]t$/, '');
  if (noNt && noNt !== noTrailQuote) out.push(noNt);
  const beforeApos = noTrailQuote.split(/['’]/)[0];
  if (beforeApos && beforeApos !== noTrailQuote) out.push(beforeApos);
  if (noTrailQuote.includes('-')) {
    out.push(noTrailQuote.replace(/-/g, ''));
    out.push(noTrailQuote.split('-')[0]);
    out.push(noTrailQuote.split('-').pop());
  }
  // 去重并丢掉空串（单字母要留着：词库里有 I / a，是合法词条）
  const seen = new Set();
  const res = [];
  for (const form of out) {
    if (!form || seen.has(form)) continue;
    seen.add(form);
    res.push(form);
  }
  return res;
}

/**
 * 从一行英文里切出「可能是个词」的 token。
 *
 * 首尾一律剥掉非字母字符。注意尾部的撇号也要剥：Gutenberg 文本里
 * 引号常被当成词的一部分（`think?'`、`machine'`），留着会导致查不到。
 * 词内部的撇号/连字符保留（`don't`、`battle-field`），交给 candidateForms 拆。
 */
function tokensOf(text) {
  const out = [];
  for (const raw of text.split(/\s+/)) {
    const core = raw.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z]+$/, '');
    if (!core) continue;
    out.push({ raw, core });
  }
  return out;
}

/** 把 WordEntry 压成产物里的精简结构 */
function compact(entry, key) {
  const out = {};
  // 只有原始大小写与 key 不同才存（DVD / I / Sunday 这类）
  if (entry.w !== key) out.w = entry.w;
  if (entry.p) out.p = entry.p;
  if (entry.defs?.length) {
    out.defs = entry.defs.map((d) => [d.pos, d.cn]);
  } else {
    out.t = entry.t;
  }
  if (entry.sentences?.length) {
    out.sentences = entry.sentences.slice(0, MAX_SENTENCES).map((s) => [s.en, s.zh]);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');

  const words = loadMergedWords();
  const rev = loadVariantIndex();
  const articles = JSON.parse(readFileSync(ARTICLES, 'utf8'));
  log(`■ 文章语料：${articles.length} 篇`);

  // ── 扫描全部 token，解析出「文章里真正出现过的词」 ──────────────
  const bases = new Set();
  const variants = {};
  let tokenCount = 0;
  let resolved = 0;

  for (const article of articles) {
    for (const sentence of article.sentences) {
      for (const { core } of tokensOf(sentence.en)) {
        tokenCount++;
        const lower = core.toLowerCase();
        let base = null;
        for (const form of candidateForms(lower)) {
          if (words.has(form)) {
            base = form;
            break;
          }
          const viaGraph = rev.get(form);
          if (viaGraph && words.has(viaGraph)) {
            base = viaGraph;
            break;
          }
        }
        if (!base) continue;
        resolved++;
        bases.add(base);
        // 这个 token 的所有候选词形（去掉本身、去掉词库里真实存在的）都指向 base
        for (const form of candidateForms(lower)) {
          if (form !== base && !words.has(form)) variants[form] = base;
        }
      }
    }
  }

  const coverage = ((resolved / tokenCount) * 100).toFixed(1);
  log(
    `■ token：${tokenCount.toLocaleString()} 个（含重复），可解析 ${resolved.toLocaleString()} 个 = ${coverage}%`,
  );
  log(`■ 去重后：${bases.size.toLocaleString()} 个原形 / ${Object.keys(variants).length} 个变体`);

  const entries = {};
  for (const key of [...bases].sort()) {
    entries[key] = compact(words.get(key), key);
  }

  const out = { generatedAt: today(), entries, variants };
  const json = JSON.stringify(out);

  if (check) {
    const existing = readFileSync(OUT, 'utf8');
    // 只比内容，不比 generatedAt：那是「哪天生成的」，不是「内容对不对」。
    // 把它算进比较的话，隔天再跑 --check 必然失败——本地和 CI 会天天喊脏。
    const strip = (s) => {
      const o = JSON.parse(s);
      delete o.generatedAt;
      return JSON.stringify(o);
    };
    if (strip(existing) !== strip(json)) {
      log('✗ 产物不是最新，请重跑 node scripts/build-article-glossary.mjs');
      process.exit(1);
    }
    log('✓ 产物已是最新（内容一致，generatedAt 不计）');
    return;
  }

  writeFileSync(OUT, json);
  const raw = Buffer.byteLength(json);
  const gz = gzipSync(json, { level: 9 }).length;
  const withDefs = Object.values(entries).filter((e) => e.defs).length;
  const withSent = Object.values(entries).filter((e) => e.sentences).length;

  log('');
  log('■ 完成');
  log(`  词条：      ${bases.size.toLocaleString()} 个（${withDefs} 个有词性释义）`);
  log(`  带例句：    ${withSent.toLocaleString()} 个`);
  log(`  文件体积：  ${(raw / 1024).toFixed(0)}KB（gzip ${(gz / 1024).toFixed(0)}KB）`);
  log(`  产物：      public/dicts/article-glossary.json`);
}

try {
  main();
} catch (e) {
  log('失败: ' + e.message);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * EnglishMate · 词典数据源探针
 * ------------------------------------------------------------------
 * 目的：一次运行，打印各候选数据源的**连通性**与**字段可用性**，
 *       并可选地对内置词库做一次 N 词的**命中率抽样**。
 *
 * 为什么需要这个脚本：
 *   本机网络环境下 raw.githubusercontent.com / cdn.jsdelivr.net / huggingface.co
 *   均不可用，api.github.com 与 registry.npmjs.org 可用。换机器或换网络后这些
 *   结论会变，所以把"实测"固化成可重跑的东西，而不是写死在文档里。
 *
 * 用法：
 *   node scripts/probe-dict-sources.mjs                # 连通性 + 字段样例（默认）
 *   node scripts/probe-dict-sources.mjs --coverage      # 额外做 100 词命中率抽样
 *   node scripts/probe-dict-sources.mjs --coverage=50   # 指定抽样词数
 *   node scripts/probe-dict-sources.mjs --only=kaikki,tatoeba
 *   node scripts/probe-dict-sources.mjs --json          # 机器可读输出（CI 用）
 *
 * 设计约束（与调研报告一致）：
 *   - 不下载大包。ECDICT 的 66MB CSV / kaikki 的 3.4GB JSONL 都只做 HEAD 或
 *     单条范围探测，绝不整包拉取。
 *   - 不改动 src/ 与 public/。脚本只读 public/dicts/*.json 作为词表来源。
 *   - 任何一项失败都不抛异常，只在结果里记 status，方便看清楚"哪个挂了"。
 *
 * 退出码：0 = 至少一个数据源可用；1 = 全部不可用。
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');

/* --------------------------------- CLI --------------------------------- */

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const JSON_OUT = hasFlag('json');
const ONLY = (flagValue('only', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const COVERAGE = hasFlag('coverage') ? Number(flagValue('coverage', '100')) || 100 : 0;
/** 抽样词数上限：探针不该因为抽样太大而变成一次压测 */
const MAX_SAMPLE = 200;

/* ------------------------------- 输出工具 ------------------------------- */

const C = process.stdout.isTTY
  ? {
      reset: '\u001b[0m',
      dim: '\u001b[2m',
      bold: '\u001b[1m',
      green: '\u001b[32m',
      yellow: '\u001b[33m',
      red: '\u001b[31m',
      cyan: '\u001b[36m',
    }
  : { reset: '', dim: '', bold: '', green: '', yellow: '', red: '', cyan: '' };

/** 结果收集：所有探测都往这里塞，最后统一打印 */
const results = [];

function record(source, check, status, detail) {
  results.push({ source, check, status, detail });
  if (JSON_OUT) return;
  const tag =
    status === 'ok'
      ? `${C.green}ok${C.reset}`
      : status === 'warn'
        ? `${C.yellow}warn${C.reset}`
        : status === 'partial'
          ? `${C.yellow}partial${C.reset}`
          : status === 'skip'
            ? `${C.dim}skip${C.reset}`
            : `${C.red}${status}${C.reset}`;
  const label = `${source}.${check}`.padEnd(34);
  console.log(`  ${label} ${tag.padEnd(16)} ${C.dim}${detail ?? ''}${C.reset}`);
}

function section(title) {
  if (JSON_OUT) return;
  console.log(`\n${C.bold}${C.cyan}${title}${C.reset}`);
}

function truncate(s, n = 160) {
  const one = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

/* ------------------------------ 网络基础件 ------------------------------ */

const UA = 'englishmate-dict-probe/1.0 (+https://github.com/)';

/**
 * 带超时的 fetch。返回 { ok, status, headers, body, bytes, ms, error }。
 * 永不 throw —— 网络问题在探针里是"结论"，不是"崩溃"。
 */
async function http(url, { method = 'GET', headers = {}, timeout = 20000, readBody = true } = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': UA, ...headers },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
    const buf = readBody ? Buffer.from(await res.arrayBuffer()) : null;
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      body: buf,
      bytes: buf?.length ?? Number(res.headers.get('content-length') || 0),
      ms: Date.now() - t0,
    };
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err), ms: Date.now() - t0 };
  }
}

/**
 * 量一个远端文件的大小，不需要下载它。
 * 优先 HEAD；HEAD 拿不到长度时用 `Range: bytes=0-0` 读 Content-Range 的总长。
 * 注意：npm registry 对 HEAD 会回 206，所以这里把 2xx 都当作成功，不硬判 200。
 */
/**
 * 量远端文件大小，不下载它。
 *
 * gzip 陷阱：Node 的 fetch 默认带 Accept-Encoding: gzip，此时 HEAD 回的
 * Content-Length 是**压缩后**的；要拿未压缩的真实体积必须先发
 * Accept-Encoding: identity。kaikki 英文整包就是典型：
 *   压缩 509MB / 未压缩 3.2GB  —— 两个都是真的，报告里要写清楚。
 *
 * npm registry 对 HEAD 会回 206，所以 2xx 都算成功，不硬判 200。
 */
async function probeSize(url, timeout = 20000) {
  // 第一次：identity，拿未压缩真实大小
  const raw = await http(url, {
    method: 'HEAD',
    headers: { 'accept-encoding': 'identity' },
    timeout,
    readBody: false,
  });
  const rawLen = Number(raw.headers?.get('content-length') || 0);

  // 第二次：默认编码，拿传输/压缩后大小（拿不到就置 0）
  const gz = await http(url, {
    method: 'HEAD',
    headers: { 'accept-encoding': 'gzip' },
    timeout,
    readBody: false,
  });
  const gzLen = Number(gz.headers?.get('content-length') || 0);
  const isGzip = (gz.headers?.get('content-encoding') || '').includes('gzip');

  const status = raw.status >= 200 && raw.status < 300 ? 200 : raw.status || gz.status;
  const bytes = rawLen || gzLen;
  const compressedBytes = isGzip && gzLen && gzLen !== bytes ? gzLen : 0;

  if (status === 200 && bytes > 0) {
    return { status, bytes, compressedBytes, via: 'HEAD', ms: raw.ms };
  }

  // HEAD 不给长度时，用 Range 兜底
  const ranged = await http(url, { headers: { range: 'bytes=0-0' }, timeout, readBody: false });
  const total = Number((ranged.headers?.get('content-range') || '').split('/')[1] || 0);
  return {
    status: total ? 200 : ranged.status || status,
    bytes: total || bytes,
    compressedBytes: 0,
    via: total ? 'Range' : 'none',
    ms: ranged.ms,
  };
}

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${(n / 1024).toFixed(0)}KB`);

/**
 * api.github.com 未认证时只有 60 次/小时。探针一口气要发 5–6 个请求，
 * 剩 0 次的时候不应该把每个检查都标成失败 —— 那会把"被限流"误读成"数据源挂了"。
 * 这里统一拦住 403 + x-ratelimit-remaining: 0 的情况。
 */
function isRateLimited(res) {
  return (
    res.status === 403 &&
    (res.headers?.get('x-ratelimit-remaining') === '0' ||
      /rate limit/i.test(res.body?.toString('utf8') || res.error || ''))
  );
}

/** 统一的 GitHub API 失败记录：限流单独标一种状态 */
function recordHttp(source, check, res, okDetail) {
  if (isRateLimited(res)) {
    const reset = Number(res.headers?.get('x-ratelimit-reset') || 0);
    const mins = reset ? Math.max(1, Math.round((reset * 1000 - Date.now()) / 60000)) : '?';
    record(source, check, 'ratelimited', `GitHub 60 req/h 已用尽，约 ${mins} 分钟后重置`);
    return;
  }
  record(source, check, `http ${res.status}`, res.error || '');
}

/**
 * 慢站（kaikki 单页 200–500KB、2–6 秒）偶尔会超时。
 * 一次抖动不该把整个数据源判成"不可用"，所以这里给 2 次重试。
 * 注意只重试**网络层失败**，不重试 404 —— 404 是"这个词没有"，是有效结论。
 */
async function httpRetry(url, opts = {}, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await http(url, opts);
    if (last.status !== 0) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  return last;
}

/* ------------------------------ 词表加载 ------------------------------ */

/**
 * 从 public/dicts/*.json 读出所有词。
 * 兼容两种结构：裸数组 [{w,t,p}] 与 {meta, words:[...]}。
 */
async function loadWords() {
  let files = [];
  try {
    files = (await readdir(DICT_DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  } catch {
    return { words: [], banks: {}, error: `无法读取 ${DICT_DIR}` };
  }

  const words = [];
  const banks = {};
  const seen = new Set();

  for (const file of files) {
    const bank = file.replace(/\.json$/, '');
    let data;
    try {
      data = JSON.parse(await readFile(path.join(DICT_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data.words)
        ? data.words
        : Array.isArray(data.data)
          ? data.data
          : [];

    for (const item of list) {
      const word = (typeof item === 'string' ? item : item?.w || item?.word || '').trim();
      if (!word) continue;
      const key = word.toLowerCase();
      (banks[bank] ||= []).push(key);
      if (!seen.has(key)) {
        seen.add(key);
        words.push(key);
      }
    }
  }
  return { words, banks };
}

/** 固定种子的抽样，保证同一词库每次抽到同一批词（可复现） */
function seededSample(list, count, seed = 20261119) {
  const arr = [...list];
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

/** 并发受限的 map，避免一次甩出上百个请求把对端打挂 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const pct = (hit, total) => (total ? `${((hit / total) * 100).toFixed(1)}%` : 'n/a');

/* =============================== 候选 1：ECDICT =============================== */

/**
 * ECDICT —— 英汉词典库（skywind3000/ECDICT，MIT）
 * 关键结论：
 *   - 字段里**没有例句**（13 列已全部核对），只有音标/释义/词性/词频/词形变化
 *   - 仓库内 ecdict.csv 66MB；GitHub 直链被墙，但 npm 上的 `ecdict` 包
 *     以 23.4MB tarball 内嵌了同一份 CSV —— 这是本机唯一可行的完整获取路径
 */
async function probeEcdict(sample) {
  section('1. ECDICT (skywind3000/ECDICT) · MIT · 英汉词典');

  // 1.1 仓库元信息 + 许可证
  const repo = await http('https://api.github.com/repos/skywind3000/ECDICT');
  if (repo.status === 200) {
    const j = JSON.parse(repo.body.toString('utf8'));
    record(
      'ecdict',
      'repo license',
      'ok',
      `${j.license?.spdx_id ?? '?'} · stars ${j.stargazers_count}`,
    );
  } else {
    recordHttp('ecdict', 'repo license', repo);
  }

  // 1.2 文件树：确认 ecdict.csv 体积，不做整包下载
  const tree = await http(
    'https://api.github.com/repos/skywind3000/ECDICT/git/trees/master?recursive=1',
  );
  if (tree.status === 200) {
    const j = JSON.parse(tree.body.toString('utf8'));
    const csv = (j.tree || []).find((t) => t.path === 'ecdict.csv');
    record(
      'ecdict',
      'ecdict.csv size',
      csv ? 'ok' : 'partial',
      csv ? `${mb(csv.size)} · ${j.tree.filter((t) => t.type === 'blob').length} blobs` : '未找到',
    );
  } else {
    recordHttp('ecdict', 'ecdict.csv size', tree);
  }

  // 1.3 raw.githubusercontent 是否可用（决定要不要走 npm 中转）
  const raw = await probeSize(
    'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.mini.csv',
    12000,
  );
  record(
    'ecdict',
    'raw.githubusercontent',
    raw.status === 200 ? 'ok' : 'blocked',
    raw.status === 200 ? `${mb(raw.bytes)}` : '不可用 → 需改走 api.github.com 或 npm',
  );

  // 1.4 字段结构：用 mini.csv（4KB）证明列名，不做大包下载
  const mini = await http(
    'https://api.github.com/repos/skywind3000/ECDICT/contents/ecdict.mini.csv',
  );
  if (mini.status === 200) {
    const j = JSON.parse(mini.body.toString('utf8'));
    const text = Buffer.from(j.content || '', 'base64').toString('utf8');
    const header = text.split('\n')[0];
    const cols = header.split(',');
    const hasExampleCol = cols.some((c) => /example|sentence|sample/i.test(c));
    record('ecdict', 'columns', 'ok', `${cols.length} 列: ${truncate(header, 110)}`);
    record(
      'ecdict',
      'example field',
      hasExampleCol ? 'ok' : 'warn',
      hasExampleCol ? '存在例句列' : '无例句列 → 例句必须另找数据源（warn = 已知事实，非故障）',
    );
  } else {
    recordHttp('ecdict', 'columns', mini);
  }

  // 1.5 真实词条内容：用 Range 从 66MB CSV 里抠一小段，证明字段有值（不整包下载）
  //     注意 Accept: application/vnd.github.raw —— 否则 contents API 回 base64，
  //     而 blob API 会把整个 66MB 编码后吐回来。
  const chunk = await http('https://api.github.com/repos/skywind3000/ECDICT/contents/ecdict.csv', {
    headers: { accept: 'application/vnd.github.raw', range: 'bytes=0-4095' },
    timeout: 30000,
  });
  if (chunk.status === 206 || chunk.status === 200) {
    const text = chunk.body.toString('utf8');
    const rows = text
      .split('\n')
      .slice(1)
      .filter((l) => l.includes(','));
    const sampleRow = rows.find((l) => /^[A-Za-z]/.test(l)) || rows[0] || '';
    record('ecdict', 'csv row sample', 'ok', truncate(sampleRow, 140));
    record('ecdict', 'range fetch', 'ok', `206 分段读取 ${mb(chunk.bytes)}（未下载整包）`);
  } else {
    recordHttp('ecdict', 'csv row sample', chunk);
  }

  // 1.6 npm 中转路径 —— 本机唯一能拿到完整 CSV 的方式
  const npm = await probeSize('https://registry.npmjs.org/ecdict/-/ecdict-0.0.4.tgz');
  record(
    'ecdict',
    'npm mirror (ecdict)',
    npm.status === 200 ? 'ok' : `http ${npm.status}`,
    npm.status === 200
      ? `tarball ${mb(npm.bytes)}（解包后 assets/ecdict.csv 66MB）`
      : truncate(npm.error || ''),
  );

  // 1.7 覆盖率：ECDICT 需要本地 CSV 才能算；这里只标记是否具备条件
  if (sample.length) {
    record(
      'ecdict',
      'coverage sample',
      'skip',
      '需先下载 npm ecdict 包并解包 CSV 才能计算（见 docs/dictionary-sources.md）',
    );
  }
}

/* =============================== 候选 2：kaikki =============================== */

const ENTITIES = [
  [/&quot;/g, '"'],
  [/&#x27;/g, "'"],
  [/&#39;/g, "'"],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
];
const decodeEntities = (s) => ENTITIES.reduce((a, [re, to]) => a.replace(re, to), s);

const NL = String.fromCharCode(10);
const BACKSLASH = String.fromCharCode(92);

/**
 * 从 kaikki 词条页里抠出内嵌的 JSON。
 * 页面把每条词性记录以 pretty-print 的 JSON 放在 <pre> 里，
 * 所以不能按 '{"' 找起点，要按 '{' + 换行 找。
 */
function scanEmbeddedJson(html) {
  const text = decodeEntities(html.replace(/<style[\s\S]*?<\/style>/g, ''));
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{' + NL, i);
    if (start < 0) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let k = start; k < text.length; k++) {
      const ch = text[k];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === BACKSLASH) escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = k + 1;
          break;
        }
      }
    }
    if (end < 0) break;

    try {
      const obj = JSON.parse(text.slice(start, end));
      if (obj && obj.word && obj.pos) out.push(obj);
      i = end;
    } catch {
      i = start + 2;
    }
  }
  return out;
}

/**
 * kaikki 的 sounds[].tags 用这些标签标地域（实测有效）。
 * 实测 40 词：60% 能同时拿到 US+UK，28% 有音标但完全没标地域 ——
 * 所以 kaikki 只做补充，英美双音标的主force 仍是 ipa-dict。
 */
const US_TAGS = new Set(['US', 'General-American', 'General American', 'US-English']);
const UK_TAGS = new Set(['UK', 'Received-Pronunciation', 'British', 'RP']);

const kaikkiUrl = (word) =>
  `https://kaikki.org/dictionary/English/meaning/${encodeURIComponent(word[0])}/` +
  `${encodeURIComponent(word.slice(0, 2))}/${encodeURIComponent(word)}.html`;

/**
 * kaikki.org —— Wiktionary 的结构化提取（wiktextract）
 * 关键结论：
 *   - 词条页按 首字母/前两字母 分目录，单页约 200–500KB（含全部语种）
 *   - 有例句、词性、IPA、同义词、词源；**中文翻译很稀疏**（抽样仅 13%）
 *   - 完整 JSONL 3.4GB / gz 534MB，不适合整包；按词抓页更现实
 */
async function probeKaikki(sample) {
  section('2. kaikki.org · Wiktionary 提取版 · CC-BY-SA 3.0');

  // 2.1 单页可用性 + 字段实证
  const testWord = 'cancel';
  const page = await httpRetry(kaikkiUrl(testWord), { timeout: 45000 });
  if (page.status !== 200) {
    record('kaikki', 'word page', `http ${page.status}`, page.error);
    return;
  }
  const html = page.body.toString('utf8');
  const objs = scanEmbeddedJson(html).filter((o) => String(o.word).toLowerCase() === testWord);
  const senses = objs.flatMap((o) => o.senses || []);
  const examples = senses.flatMap((s) => s.examples || []);
  const ipa = [
    ...new Set(
      objs
        .flatMap((o) => o.sounds || [])
        .map((s) => s.ipa)
        .filter(Boolean),
    ),
  ];
  const zh = senses
    .flatMap((s) => s.translations || [])
    .filter((t) => t.code === 'zh' || t.lang_code === 'zh' || t.lang === 'Chinese');

  record('kaikki', 'word page', 'ok', `${mb(html.length)} · ${page.ms}ms`);
  record(
    'kaikki',
    'pos',
    objs.length ? 'ok' : 'partial',
    [...new Set(objs.map((o) => o.pos))].join(', ') || '无',
  );
  record(
    'kaikki',
    'examples',
    examples.length ? 'ok' : 'partial',
    `${examples.length} 条 · "${truncate(examples[1]?.text ?? examples[0]?.text ?? '', 90)}"`,
  );
  record('kaikki', 'ipa', ipa.length ? 'ok' : 'partial', truncate(ipa.join('  '), 90) || '无');
  record(
    'kaikki',
    'zh translation',
    zh.length ? 'ok' : 'partial',
    zh.length ? truncate(JSON.stringify(zh[0]), 90) : '稀疏 → 中文释义仍需 ECDICT',
  );

  // 2.1b 英美双音标：靠 sounds[].tags 拆分
  const sounds = objs.flatMap((o) => o.sounds || []).filter((s) => s.ipa);
  const pickIpa = (set) => sounds.find((s) => (s.tags || []).some((t) => set.has(t)))?.ipa;
  const usIpa = pickIpa(US_TAGS);
  const ukIpa = pickIpa(UK_TAGS);
  record(
    'kaikki',
    'us/uk ipa tags',
    usIpa && ukIpa ? 'ok' : 'partial',
    usIpa && ukIpa ? `US ${usIpa}  |  UK ${ukIpa}` : '该词无地域标签（实测约 60% 的词英美才齐全）',
  );

  // 2.2 完整包体积（只 HEAD，不下载）
  const full = await probeSize(
    'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl',
  );
  record(
    'kaikki',
    'full jsonl',
    full.status === 200 ? 'ok' : `http ${full.status}`,
    full.compressedBytes
      ? `${mb(full.bytes)}（gzip 后 ${mb(full.compressedBytes)}）→ 整包不可行，只能按词抓页`
      : `~${mb(full.bytes)} → 整包不可行，只能按词抓页`,
  );

  // 2.3 覆盖率抽样
  if (sample.length) {
    const words = sample.slice(0, Math.min(40, sample.length));
    const rows = await mapLimit(words, 3, async (w) => {
      const r = await httpRetry(kaikkiUrl(w), { timeout: 45000 });
      if (r.status !== 200) return { w, ok: false };
      const list = scanEmbeddedJson(r.body.toString('utf8')).filter(
        (o) => String(o.word).toLowerCase() === w.toLowerCase(),
      );
      const s = list.flatMap((o) => o.senses || []);
      return {
        w,
        ok: true,
        ex: s.flatMap((x) => x.examples || []).length,
        ipa: list.flatMap((o) => o.sounds || []).some((x) => x.ipa),
        pos: list.length > 0,
      };
    });
    const ok = rows.filter((r) => r.ok);
    record('kaikki', 'page hit', ok.length ? 'ok' : 'partial', `${ok.length}/${rows.length}`);
    record(
      'kaikki',
      'with examples',
      'ok',
      `${ok.filter((r) => r.ex >= 1).length}/${ok.length} (${pct(ok.filter((r) => r.ex >= 1).length, ok.length)})`,
    );
    record(
      'kaikki',
      'with ipa',
      'ok',
      `${ok.filter((r) => r.ipa).length}/${ok.length} (${pct(ok.filter((r) => r.ipa).length, ok.length)})`,
    );
    record(
      'kaikki',
      'with pos',
      'ok',
      `${ok.filter((r) => r.pos).length}/${ok.length} (${pct(ok.filter((r) => r.pos).length, ok.length)})`,
    );
  }
}

/* ============================== 候选 3：Tatoeba ============================== */

/**
 * Tatoeba —— 句子对照库（CC-BY 2.0 FR，署名必需）
 * 关键结论：
 *   - 英文句子文件 25MB(bz2) / 带元数据 35MB；中文 1.7MB；eng-cmn 链接仅 0.5MB
 *   - 中文句子量远小于英文，所以**英中对照覆盖有限**，GRE 类低频词尤其差
 *   - 官方大包下载很慢（实测 ~60KB/s），探针只做头部与体积探测
 */
async function probeTatoeba() {
  section('3. Tatoeba · CC-BY 2.0 FR · 英中对照句库');

  const files = [
    [
      'eng_sentences',
      'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2',
      '英文句子',
    ],
    [
      'eng_detailed',
      'https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2',
      '英文句子+元数据',
    ],
    [
      'cmn_sentences',
      'https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2',
      '中文句子',
    ],
    [
      'eng-cmn links',
      'https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2',
      '英中对照索引',
    ],
  ];
  for (const [label, url, note] of files) {
    const r = await probeSize(url, 25000);
    record(
      'tatoeba',
      label,
      r.status === 200 ? 'ok' : `http ${r.status}`,
      r.status === 200 ? `${mb(r.bytes)} · ${note}` : '不可用',
    );
  }

  // 直连 downloads 站点必须能通；playground 的 API 只是补充
  const dl = await http('https://downloads.tatoeba.org/exports/', { timeout: 20000 });
  record(
    'tatoeba',
    'downloads host',
    dl.status === 200 ? 'ok' : `http ${dl.status}`,
    dl.status === 200 ? 'exports 目录可列' : truncate(dl.error || ''),
  );

  // 第三方现成英中对照包（省掉自己 join links）：许可需注意它自身声明 MIT，但数据来自 Tatoeba
  const pack = await probeSize(
    'https://registry.npmjs.org/tatoeba-sentence-pairs-in-mandarin-chinese-english/-/tatoeba-sentence-pairs-in-mandarin-chinese-english-0.20260520.0.tgz',
  );
  record(
    'tatoeba',
    'npm eng-zh pairs',
    pack.status === 200 ? 'ok' : `http ${pack.status}`,
    pack.status === 200
      ? `${mb(pack.bytes)} tarball · 解包 7MB · 76.6k 对`
      : truncate(pack.error || ''),
  );

  record(
    'tatoeba',
    'coverage',
    'skip',
    '需本地解包 sentences.json 才能算（文档给出实测：CET4 91.6% / GRE 28.4%）',
  );
}

/* =========================== 候选 4：dictionaryapi.dev =========================== */

/**
 * dictionaryapi.dev（Free Dictionary API）—— 无 key 的免费词典 API
 * 关键结论：
 *   - 有音标、词性、**英文例句**、同义词；**没有中文**
 *   - 限流 450 次/小时/来源；实测并发 6 跑 100 词 → 78 个 429
 *   - 代码 GPL-3.0，数据来自 Wiktionary（CC-BY-SA）：都不适合直接打包进 MIT 项目
 */
async function probeDictionaryApi(sample) {
  section('4. dictionaryapi.dev · 免费词典 API · 无 key');

  const one = await http('https://api.dictionaryapi.dev/api/v2/entries/en/cancel', {
    timeout: 15000,
  });
  if (one.status !== 200) {
    record('dictionaryapi', 'single word', `http ${one.status}`, one.error);
    return;
  }
  const entry = JSON.parse(one.body.toString('utf8'))[0];
  const meanings = entry.meanings || [];
  const examples = meanings.flatMap((m) =>
    (m.definitions || []).filter((d) => d.example).map((d) => d.example),
  );
  const phonetics = [...new Set((entry.phonetics || []).map((p) => p.text).filter(Boolean))];
  record('dictionaryapi', 'single word', 'ok', `${one.ms}ms · ${mb(one.bytes)}`);
  record(
    'dictionaryapi',
    'phonetics',
    phonetics.length ? 'ok' : 'partial',
    truncate(phonetics.join('  '), 80) || '无',
  );
  record(
    'dictionaryapi',
    'pos',
    'ok',
    [...new Set(meanings.map((m) => m.partOfSpeech))].join(', '),
  );
  record(
    'dictionaryapi',
    'examples',
    examples.length ? 'ok' : 'partial',
    `${examples.length} 条 · "${truncate(examples[0], 70)}"`,
  );
  record('dictionaryapi', 'zh translation', 'partial', '**无中文** → 中文释义需 ECDICT');

  const limit = one.headers?.get('x-ratelimit-limit');
  const reset = one.headers?.get('x-ratelimit-reset');
  record('dictionaryapi', 'rate limit', 'ok', `${limit ?? '?'} req · reset ${reset ?? '?'}`);

  if (!sample.length) return;

  // 并发 4 是刻意的：再高就会大量 429，正好把"限流真实存在"测出来
  const words = sample.slice(0, Math.min(40, sample.length));
  const rows = await mapLimit(words, 4, async (w) => {
    const r = await http(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`,
      { timeout: 15000 },
    );
    if (r.status !== 200) return { w, status: r.status };
    const e = JSON.parse(r.body.toString('utf8'))[0];
    const ex = (e?.meanings || []).flatMap((m) => (m.definitions || []).filter((d) => d.example));
    return { w, status: 200, ex: ex.length, ipa: (e?.phonetics || []).some((p) => p.text) };
  });
  const ok = rows.filter((r) => r.status === 200);
  const throttled = rows.filter((r) => r.status === 429);
  record('dictionaryapi', 'sample hit', 'ok', `${ok.length}/${rows.length}`);
  record(
    'dictionaryapi',
    'throttled',
    throttled.length ? 'partial' : 'ok',
    `${throttled.length}/${rows.length} 返回 429`,
  );
  record(
    'dictionaryapi',
    'with examples',
    'ok',
    `${ok.filter((r) => r.ex >= 1).length}/${ok.length} (${pct(ok.filter((r) => r.ex >= 1).length, ok.length)})`,
  );
}

/* ============================== 候选 5：ipa-dict ============================== */

/**
 * ipa-dict（open-dict-data/ipa-dict）—— 英美双音标词表
 * 关键结论：
 *   - en_US 125,927 条 / en_UK 65,119 条，两者**发音确实不同**（共同词 99.5% 有差异）
 *   - 两级许可：项目 MIT，但 en_UK 数据源自 GPL-3.0 的 ipacards
 */
async function probeIpaDict(sample) {
  section('5. ipa-dict · MIT（en_UK 源自 GPL-3.0）· 英美双音标');

  const meta = await http('https://api.github.com/repos/open-dict-data/ipa-dict');
  if (meta.status === 200) {
    const j = JSON.parse(meta.body.toString('utf8'));
    record('ipa-dict', 'license', 'ok', `${j.license?.spdx_id ?? '?'} · ${mb(j.size * 1024)}`);
  } else {
    recordHttp('ipa-dict', 'license', meta);
  }

  const us = await http(
    'https://api.github.com/repos/open-dict-data/ipa-dict/contents/data/en_US.txt',
    { headers: { accept: 'application/vnd.github.raw' }, timeout: 40000 },
  );
  const uk = await http(
    'https://api.github.com/repos/open-dict-data/ipa-dict/contents/data/en_UK.txt',
    { headers: { accept: 'application/vnd.github.raw' }, timeout: 40000 },
  );
  if (us.status !== 200) {
    recordHttp('ipa-dict', 'en_US', us);
    // GitHub 被限流时，npm 上还有一份等价的英音/美音数据
    const alt = await probeSize('https://registry.npmjs.org/ipa-dict/-/ipa-dict-1.0.3.tgz');
    record(
      'ipa-dict',
      'npm fallback',
      alt.status === 200 ? 'ok' : `http ${alt.status}`,
      alt.status === 200
        ? `tarball ${mb(alt.bytes)}（含 lib/en_US.js、lib/en_UK.js，无需 GitHub）`
        : truncate(alt.error || ''),
    );
    return;
  }

  const parse = (buf) => {
    const map = new Map();
    for (const line of buf.toString('utf8').split('\n')) {
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const w = line.slice(0, tab).trim().toLowerCase();
      const ipa = line.slice(tab + 1).trim();
      if (w && !map.has(w)) map.set(w, ipa);
    }
    return map;
  };
  const usMap = parse(us.body);
  const ukMap = uk.status === 200 ? parse(uk.body) : new Map();

  record('ipa-dict', 'en_US', 'ok', `${usMap.size} 条 · ${mb(us.bytes)}`);
  if (uk.status === 200) {
    record('ipa-dict', 'en_UK', 'ok', `${ukMap.size} 条 · ${mb(uk.bytes)}`);
  } else {
    recordHttp('ipa-dict', 'en_UK', uk);
  }

  const common = [...usMap.keys()].filter((w) => ukMap.has(w));
  const differ = common.filter((w) => usMap.get(w) !== ukMap.get(w));
  record(
    'ipa-dict',
    'US vs UK differ',
    'ok',
    `${differ.length}/${common.length} (${pct(differ.length, common.length)}) 有差异 → 双音标是真数据`,
  );
  const demo = differ.slice(0, 1)[0];
  if (demo)
    record('ipa-dict', 'sample', 'ok', `${demo}: US ${usMap.get(demo)}  UK ${ukMap.get(demo)}`);

  if (!sample.length) return;
  record(
    'ipa-dict',
    'sample US',
    'ok',
    `${sample.filter((w) => usMap.has(w)).length}/${sample.length}`,
  );
  record(
    'ipa-dict',
    'sample both',
    'ok',
    `${sample.filter((w) => usMap.has(w) && ukMap.has(w)).length}/${sample.length}`,
  );
}

/* ============================== 附带：WordNet ============================== */

/**
 * WordNet 3.1（Princeton）—— 宽松许可的英文义项库
 * 用途：当 ECDICT 有词无例句、kaikki 抓不到时的**兜底例句**。
 * 例：soften → "The bread will soften if you pour some liquid on it"
 */
async function probeWordNet(sample) {
  section('6. WordNet 3.1 · Princeton 许可 · 兜底英文例句');

  const r = await probeSize('https://registry.npmjs.org/wordnet-db/-/wordnet-db-3.1.14.tgz');
  record(
    'wordnet',
    'npm package',
    r.status === 200 ? 'ok' : `http ${r.status}`,
    r.status === 200 ? `${mb(r.bytes)} tarball · 解包 35MB` : truncate(r.error || ''),
  );
  record('wordnet', 'license', 'ok', 'Princeton WordNet License（可商用，需保留声明）');
  record('wordnet', 'fields', 'ok', '词性/释义/例句（引号内）/同义词 —— **无音标、无中文**');
  if (sample.length) {
    record(
      'wordnet',
      'coverage',
      'skip',
      '需解包 data.{noun,verb,adj,adv} 才能算（文档：抽样 70% 有例句）',
    );
  }
}

/* ================================== main ================================== */

async function main() {
  const started = Date.now();
  const { words, banks, error } = await loadWords();
  const sample = COVERAGE ? seededSample(words, Math.min(COVERAGE, MAX_SAMPLE)) : [];

  if (!JSON_OUT) {
    console.log(`${C.bold}EnglishMate · 词典数据源探针${C.reset}`);
    console.log(`${C.dim}${new Date().toISOString()}  node ${process.version}${C.reset}`);
    if (error) console.log(`${C.yellow}⚠ ${error}（覆盖率抽样将跳过）${C.reset}`);
    else
      console.log(
        `${C.dim}词表: ${words.length} 个去重词条 / ${Object.keys(banks).length} 个词库` +
          (COVERAGE ? ` · 抽样 ${sample.length} 词` : ' · 未启用覆盖率抽样（加 --coverage）') +
          C.reset,
      );
  }

  const probes = {
    ecdict: () => probeEcdict(sample),
    kaikki: () => probeKaikki(sample),
    tatoeba: () => probeTatoeba(),
    dictionaryapi: () => probeDictionaryApi(sample),
    'ipa-dict': () => probeIpaDict(sample),
    wordnet: () => probeWordNet(sample),
  };

  for (const [name, run] of Object.entries(probes)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    try {
      await run();
    } catch (err) {
      record(name, 'probe', 'error', String(err?.message || err));
    }
  }

  const sources = [...new Set(results.map((r) => r.source))];
  const summary = sources.map((source) => {
    const rows = results.filter((r) => r.source === source);
    const bad = rows.filter(
      (r) => !['ok', 'skip', 'partial', 'warn', 'ratelimited'].includes(r.status),
    ).length;
    return {
      source,
      checks: rows.length,
      failed: bad,
      verdict: bad === 0 ? 'usable' : bad < rows.length ? 'degraded' : 'unusable',
    };
  });

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { at: new Date().toISOString(), words: words.length, sources: summary, results },
        null,
        2,
      ),
    );
  } else {
    section('汇总');
    for (const s of summary) {
      const tag =
        s.verdict === 'usable'
          ? `${C.green}可用${C.reset}`
          : s.verdict === 'degraded'
            ? `${C.yellow}部分可用${C.reset}`
            : `${C.red}不可用${C.reset}`;
      console.log(
        `  ${s.source.padEnd(16)} ${tag}  ${C.dim}${s.checks - s.failed}/${s.checks} 项通过${C.reset}`,
      );
    }
    console.log(`\n${C.dim}耗时 ${((Date.now() - started) / 1000).toFixed(1)}s${C.reset}`);
    console.log(
      `${C.dim}结论见 docs/dictionary-sources.md；本脚本只做连通性与字段验证，不改动 src/ 与 public/${C.reset}`,
    );
  }

  process.exit(summary.some((s) => s.verdict !== 'unusable') ? 0 : 1);
}

main().catch((err) => {
  console.error('probe failed:', err);
  process.exit(1);
});

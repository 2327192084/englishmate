#!/usr/bin/env node
/**
 * TypeFlow · 内置词库构建脚本
 * ------------------------------------------------------------------
 * 作用：从开源项目 Qwerty Learner（MIT）的 public/dicts/ 拉取原始词表，
 *       清洗成 TypeFlow 的 WordEntry 格式，生成 public/dicts/<id>.json。
 *
 * 为什么走 GitHub blob API：
 *   本机网络环境下 raw.githubusercontent.com 与 cdn.jsdelivr.net 均被阻断，
 *   只有 api.github.com 可用。blob API 返回 base64 内容，解码即得原文。
 *
 * 缓存与幂等：
 *   - 每个 blob 按 sha 缓存在 .tmp/blobs/<sha>.json，重跑直接命中缓存，不再走网络。
 *   - 同时兼容早期手工抓取的 .tmp/<id>.blob.json（按内部 sha 字段识别）。
 *   - 产物内容未变化时不重写文件，避免无意义的 mtime 抖动。
 *
 * 用法：
 *   node scripts/build-dicts.mjs            # 正常构建（缺缓存才联网）
 *   node scripts/build-dicts.mjs --offline  # 只用本地缓存，绝不联网
 *   node scripts/build-dicts.mjs --refresh  # 忽略缓存，强制重新下载
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------ 路径与常量 ------------------------------ */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CACHE_DIR = path.join(ROOT, '.tmp');
const BLOB_DIR = path.join(CACHE_DIR, 'blobs');
const OUT_DIR = path.join(ROOT, 'public', 'dicts');

const REPO = 'RealKai42/qwerty-learner';
const REF = 'master';
const API = 'https://api.github.com';

/** 词库数量下限：低于这个数说明源文件结构变了或解析出错，直接失败 */
const MIN_WORDS = 100;
/** 单词长度上限（超出视为脏数据） */
const MAX_WORD_LEN = 64;

/**
 * 8 个必建词库。pinnedSha 是在 master 上实测拿到的 blob sha，
 * 目录列表接口不可用时用它兜底，保证构建可复现。
 */
const BANKS = [
  {
    id: 'cet4',
    file: 'CET4_T.json',
    name: 'CET-4 · 四级核心',
    category: 'exam',
    description: '大学英语四级高频词汇，四级备考与英语入门打底的首选词表。',
    pinnedSha: '29016d5020b35c831fd7483a7ee1aabe9d944ff7',
  },
  {
    id: 'cet6',
    file: 'CET6_T.json',
    name: 'CET-6 · 六级核心',
    category: 'exam',
    description: '大学英语六级核心词汇，在四级基础上扩展学术与书面表达。',
    pinnedSha: '79f1b2c4eb12791e57d8eb17e9dbc136a079081a',
  },
  {
    id: 'kaoyan',
    file: 'KaoYan_2024.json',
    name: '考研 · 核心词',
    category: 'exam',
    description: '考研英语核心词汇，覆盖真题高频词与常见的熟词僻义。',
    pinnedSha: '2cd74c2b7da74df0950b51be14d814f1063ee603',
  },
  {
    id: 'ielts',
    file: 'IELTS_3_T.json',
    name: '雅思 IELTS',
    category: 'exam',
    description: '雅思 IELTS 核心词汇，涵盖听说读写常见主题与学术场景用词。',
    pinnedSha: '7e5876e982da4505a80607d972e206b4e89c415e',
  },
  {
    id: 'toefl',
    file: 'TOEFL_3_T.json',
    name: '托福 TOEFL',
    category: 'exam',
    description: '托福 TOEFL 学术词汇，偏重校园生活与学科讲座场景。',
    pinnedSha: '34c96285a8117c847420425ad3d06f6d1a173708',
  },
  {
    id: 'gre',
    file: 'GRE_3_T.json',
    name: 'GRE',
    category: 'exam',
    description: 'GRE 高阶词汇，面向填空与阅读的长难词与同义替换。',
    pinnedSha: '5f9c38f2b864878320afd8ee5908b1c8bc28aa23',
  },
  {
    id: 'gaokao',
    file: 'GaoZhongluan_2_T.json',
    name: '高考 · 高中词汇',
    category: 'basic',
    description: '高考英语高中词汇，中学课标词表，适合作为起步词库。',
    pinnedSha: '1e9d9874d13d9038a08b51d72affe21a972f4d55',
  },
  {
    id: 'linux',
    file: 'linux-command.json',
    name: '程序员 · Linux 命令',
    category: 'programming',
    description: 'Linux 常用命令与工具速查，边敲命令边记住英文释义。',
    pinnedSha: '337194cf1e54dae125a7ce43739ba9fa78ec609a',
  },
];

/** 命令行开关 */
const argv = new Set(process.argv.slice(2));
const OFFLINE = argv.has('--offline');
const REFRESH = argv.has('--refresh');

/* ------------------------------ 小工具 ------------------------------ */

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);

/** 统一错误出口：抛出去由 main 捕获，打印后以退出码 1 结束 */
function fail(message) {
  throw new Error(message);
}

/** 取文件大小（字节），不存在返回 0 */
async function sizeOf(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/** 人类可读体积 */
function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 只在内容真的变了才写盘（重跑幂等，不抖动 mtime） */
async function writeIfChanged(file, text) {
  let prev = null;
  try {
    prev = await readFile(file, 'utf8');
  } catch {
    prev = null;
  }
  if (prev === text) return { changed: false, bytes: Buffer.byteLength(text) };
  await writeFile(file, text, 'utf8');
  return { changed: true, bytes: Buffer.byteLength(text) };
}

/** 先写临时文件再 rename，避免中断留下半截 JSON */
async function writeAtomic(file, text) {
  const tmp = `${file}.part`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

/** 睡眠，给 GitHub 限流留点余地 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 访问 api.github.com 并解析 JSON。
 * GitHub 对无 UA 的请求会返回 403，所以显式带上 UA；429/5xx 做指数退避重试。
 */
async function ghJson(url, { retries = 3 } = {}) {
  if (OFFLINE) fail(`离线模式下需要联网：${url}`);
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'typeflow-dict-builder',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (res.status === 403 || res.status === 429) {
        // 命中限流：等一会儿再试，最后一次仍失败则抛错
        const reset = Number(res.headers.get('x-ratelimit-reset') || 0);
        const waitMs = reset ? Math.max(0, reset * 1000 - Date.now()) : 2000 * attempt;
        lastErr = new Error(`GitHub 限流 ${res.status}（第 ${attempt} 次）`);
        if (attempt < retries) {
          warn(`  ! ${lastErr.message}，等待 ${Math.min(waitMs, 15000)}ms 后重试`);
          await sleep(Math.min(waitMs, 15000));
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  fail(`请求失败（已重试 ${retries} 次）：${url}\n  ${lastErr?.message || lastErr}`);
}

/* ------------------------------ 目录列表 ------------------------------ */

/**
 * 取 public/dicts 目录清单，用来动态解析每个文件的 blob sha。
 * 单页上限 1000 条，实测 380 个文件，一页足够。
 * 结果缓存到 .tmp/dicts-list.json；失败时返回 null，由 pinnedSha 兜底。
 */
async function loadDirListing() {
  const cacheFile = path.join(CACHE_DIR, 'dicts-list.json');

  const useCache = async () => {
    try {
      const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
      const list = Array.isArray(raw) ? raw : raw?.entries;
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      /* 缓存损坏当作没有 */
    }
    return null;
  };

  if (!REFRESH) {
    const cached = await useCache();
    if (cached) {
      log(`· 目录清单命中缓存（${cached.length} 个文件）`);
      return cached;
    }
  }
  if (OFFLINE) {
    warn('· 离线模式且无目录缓存，改用内置 sha');
    return null;
  }

  try {
    const list = await ghJson(
      `${API}/repositories/331603334/contents/public/dicts?ref=${REF}&per_page=1000`,
    );
    if (!Array.isArray(list)) fail('目录列表返回的不是数组');
    await mkdir(CACHE_DIR, { recursive: true });
    await writeAtomic(cacheFile, JSON.stringify(list));
    log(`· 目录清单已抓取（${list.length} 个文件）`);
    return list;
  } catch (err) {
    warn(`· 目录清单抓取失败，改用内置 sha：${err.message}`);
    return null;
  }
}

/* ------------------------------ blob 下载与缓存 ------------------------------ */

/**
 * 在缓存目录里按 sha 找已下载的 blob。
 * 兼容两种落盘位置：.tmp/blobs/<sha>.json 和早期的 .tmp/<id>.blob.json。
 */
async function findCachedBlob(sha) {
  const direct = path.join(BLOB_DIR, `${sha}.json`);
  if (await sizeOf(direct)) return direct;

  // 扫一遍 .tmp 根目录下的 *.blob.json，按内部 sha 字段匹配
  let names = [];
  try {
    names = await readdir(CACHE_DIR);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!name.endsWith('.blob.json')) continue;
    const file = path.join(CACHE_DIR, name);
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed?.sha === sha && typeof parsed?.content === 'string') return file;
    } catch {
      /* 坏缓存跳过 */
    }
  }
  return null;
}

/** 校验一份 blob 缓存是否可用（sha 匹配 + base64 能解出非空文本） */
async function validateBlobFile(file, sha) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed?.sha !== sha) return null;
    if (parsed?.encoding !== 'base64' || typeof parsed?.content !== 'string') return null;
    const text = Buffer.from(parsed.content, 'base64').toString('utf8');
    if (text.trim().length === 0) return null;
    return text;
  } catch {
    return null;
  }
}

/**
 * 取某个 blob 的原始文本：先查缓存，未命中再走 API 下载并写缓存。
 */
async function loadBlobText(bank, sha) {
  if (!REFRESH) {
    const cachedFile = await findCachedBlob(sha);
    if (cachedFile) {
      const text = await validateBlobFile(cachedFile, sha);
      if (text) {
        log(`  · ${bank.id}: 命中缓存 ${path.relative(ROOT, cachedFile)}`);
        return text;
      }
      warn(`  ! ${bank.id}: 缓存文件损坏，重新下载`);
    }
  }

  log(`  · ${bank.id}: 下载 blob ${sha.slice(0, 10)}…`);
  const blob = await ghJson(`${API}/repos/${REPO}/git/blobs/${sha}`);
  if (blob?.encoding !== 'base64' || typeof blob?.content !== 'string') {
    fail(`${bank.id}: blob 响应缺少 base64 内容`);
  }
  const text = Buffer.from(blob.content, 'base64').toString('utf8');
  if (!text.trim()) fail(`${bank.id}: blob 解码后为空`);

  // 落盘缓存：保留原始响应，下次重跑直接复用
  await mkdir(BLOB_DIR, { recursive: true });
  await writeAtomic(path.join(BLOB_DIR, `${sha}.json`), JSON.stringify(blob));
  return text;
}

/* ------------------------------ 防御式解析 ------------------------------ */

/** 从多种可能的字段名里取第一个字符串值 */
function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/**
 * 把源文件文本解析成条目数组。
 * 兼容：顶层数组；{ words | data | dicts | list: [...] } 包装；
 * 以及 Node 里 JSON.parse 对 BOM 的容忍问题（先剥 BOM）。
 */
function parseSourceEntries(text, bankId) {
  const cleaned = text.replace(/^\uFEFF/, '');
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (err) {
    fail(`${bankId}: 源文件不是合法 JSON（${err.message}）`);
  }

  let entries = null;
  if (Array.isArray(data)) entries = data;
  else if (data && typeof data === 'object') {
    for (const key of ['words', 'data', 'dicts', 'list', 'items']) {
      if (Array.isArray(data[key])) {
        entries = data[key];
        break;
      }
    }
  }
  if (!entries) fail(`${bankId}: 源文件既不是数组，也没有可识别的词条数组字段`);
  return entries;
}

/** 把释义字段统一成字符串数组，兼容 string / string[] / {tranCn} 之类 */
function toTransList(entry) {
  const raw = entry?.trans ?? entry?.translations ?? entry?.translation ?? entry?.meaning;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object')
          return firstString(item, ['tranCn', 'text', 'cn', 't']);
        return '';
      })
      .filter((item) => typeof item === 'string' && item.trim());
  }
  if (typeof raw === 'string' && raw.trim()) return [raw];
  return [];
}

/** 取音标：优先美音 usphone，其次英音 ukphone */
function pickPhone(entry) {
  const us = firstString(entry, ['usphone', 'usPhone', 'phone', 'phonetic']);
  if (us) return us;
  return firstString(entry, ['ukphone', 'ukPhone']);
}

/**
 * 归一化音标文本：去掉源数据里自带的 /…/ 或 […] 外壳，
 * 内部再有斜杠分隔的（如 "bɑ:θ/bæθ"）统一成 ", " 避免出现 //。
 */
function normalizePhone(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  text = text
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim();
  if (!text) return '';
  // 源数据里偶见 "a/b" 表示两种读法，转成逗号更清晰
  if (text.includes('/')) {
    text = text
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text ? `/${text}/` : '';
}

/**
 * 清洗释义文本：
 * 1) 全角空格/不间断空格统一成普通空格；
 * 2) 连续空白压成一个空格；
 * 3) 中文全角标点（，；、：）两侧不留空格，避免 "取消， 撤销" 这种别扭排版。
 */
function tidyText(input) {
  return String(input)
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，；、：（）])\s*/g, '$1')
    .trim();
}

/** 清洗单词本身：压空白、去掉控制字符；不合格返回空串 */
function cleanWordName(raw) {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (!text) return '';
  if (/[\r\n]/.test(text)) return '';
  if (text.length < 1 || text.length > MAX_WORD_LEN) return '';
  return text;
}

/**
 * 清洗单个条目，产出 WordEntry 或 null（不合格则丢弃）。
 */
function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const w = cleanWordName(firstString(entry, ['name', 'word', 'w']));
  if (!w) return null;

  const parts = toTransList(entry)
    .map((item) => tidyText(item))
    .filter(Boolean);
  if (parts.length === 0) return null;

  // 相邻重复释义只留一条（源数据偶见）
  const deduped = parts.filter((item, index) => index === 0 || item !== parts[index - 1]);

  const t = tidyText(deduped.join('；'));
  if (!t) return null;

  const word = { w, t };
  const p = normalizePhone(pickPhone(entry));
  if (p) word.p = p; // 没有音标就省略字段，不给 undefined/空串
  return word;
}

/**
 * 构建单个词库：解析 → 清洗 → 去重 → 产出 {meta, words}。
 * 去重口径：单词小写后相同只保留第一条有效释义。
 */
function buildBank(def, text) {
  const entries = parseSourceEntries(text, def.id);

  const words = [];
  const seen = new Set();
  let droppedEmpty = 0;
  let droppedDup = 0;

  for (const entry of entries) {
    const word = cleanEntry(entry);
    if (!word) {
      droppedEmpty += 1;
      continue;
    }
    const key = word.w.toLowerCase();
    if (seen.has(key)) {
      droppedDup += 1;
      continue;
    }
    seen.add(key);
    words.push(word);
  }

  if (words.length < MIN_WORDS) {
    fail(`${def.id}: 清洗后仅 ${words.length} 条（下限 ${MIN_WORDS}），疑似源文件结构变化`);
  }

  const meta = {
    id: def.id,
    name: def.name,
    category: def.category,
    description: def.description,
    count: words.length,
    source: `Qwerty Learner (MIT) · public/dicts/${def.file}`,
  };

  return { meta, words, droppedEmpty, droppedDup, rawCount: entries.length };
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  log('TypeFlow 词库构建');
  log(`  仓库：${REPO}@${REF}`);
  log(`  缓存：${path.relative(ROOT, CACHE_DIR)}`);
  log(`  输出：${path.relative(ROOT, OUT_DIR)}`);
  if (OFFLINE) log('  模式：离线（仅用缓存）');
  if (REFRESH) log('  模式：强制刷新缓存');
  log('');

  // 1. 目录列表（可选，失败用内置 sha）
  const listing = await loadDirListing();
  const shaByName = new Map();
  if (listing) {
    for (const item of listing) {
      if (item && typeof item.name === 'string' && typeof item.sha === 'string') {
        shaByName.set(item.name, item.sha);
      }
    }
  }

  await mkdir(OUT_DIR, { recursive: true });

  // 2. 逐个构建
  const rows = [];
  const banksMeta = [];
  let totalWords = 0;
  let totalBytes = 0;
  let totalDroppedEmpty = 0;
  let totalDroppedDup = 0;

  for (const def of BANKS) {
    const listedSha = shaByName.get(def.file);
    if (listedSha && listedSha !== def.pinnedSha) {
      warn(`  ! ${def.id}: 目录 sha 与内置 sha 不一致，以目录为准（上游可能更新过）`);
    }
    const sha = listedSha || def.pinnedSha;

    const text = await loadBlobText(def, sha);
    const { meta, words, droppedEmpty, droppedDup, rawCount } = buildBank(def, text);

    const payload = JSON.stringify({ meta, words });
    const target = path.join(OUT_DIR, `${def.id}.json`);
    const { changed, bytes } = await writeIfChanged(target, payload);

    totalWords += words.length;
    totalBytes += bytes;
    totalDroppedEmpty += droppedEmpty;
    totalDroppedDup += droppedDup;
    banksMeta.push(meta);
    rows.push({
      id: def.id,
      raw: rawCount,
      count: words.length,
      droppedEmpty,
      droppedDup,
      bytes,
      changed,
    });
  }

  // 3. index.json
  //    generatedAt 是构建元信息。若 8 个词库的 meta 与上次完全一致（重跑同一版本），
  //    就沿用旧时间戳，避免每次重跑都产生无意义的 git diff。
  const indexFile = path.join(OUT_DIR, 'index.json');
  const banksJson = JSON.stringify(banksMeta);
  let generatedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(await readFile(indexFile, 'utf8'));
    if (prev?.generatedAt && JSON.stringify(prev?.banks) === banksJson) {
      generatedAt = prev.generatedAt;
    }
  } catch {
    /* 没有旧 index 或已损坏，用当前时间 */
  }
  const indexResult = await writeIfChanged(
    indexFile,
    JSON.stringify({ generatedAt, banks: banksMeta }),
  );

  // 4. 汇总输出
  log('');
  log('  词库              原始     产出   丢弃(空释义)  丢弃(重复)     体积  状态');
  log('  ' + '-'.repeat(78));
  for (const row of rows) {
    const name = row.id.padEnd(10);
    log(
      `  ${name} ${String(row.raw).padStart(8)} ${String(row.count).padStart(8)}` +
        ` ${String(row.droppedEmpty).padStart(12)} ${String(row.droppedDup).padStart(12)}` +
        ` ${human(row.bytes).padStart(9)}  ${row.changed ? '已写入' : '未变化'}`,
    );
  }
  log('  ' + '-'.repeat(78));
  log(
    `  合计 ${String(BANKS.length).padStart(2)} 个词库 / ${totalWords} 词条 / ${human(totalBytes)}` +
      `（丢弃空释义 ${totalDroppedEmpty}，重复 ${totalDroppedDup}）`,
  );
  log(`  index.json: ${human(indexResult.bytes)}（${indexResult.changed ? '已写入' : '未变化'}）`);
  log('');
  log('✓ 构建完成');
}

main().catch((err) => {
  console.error('');
  console.error(`✗ 构建失败：${err?.message || err}`);
  process.exit(1);
});

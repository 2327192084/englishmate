/**
 * 富词条构建：为现有词库补上 词性 / 英美双音标 / 例句。
 *
 * ── 数据来源与许可 ────────────────────────────────────────────────────────
 * 1) ECDICT（skywind3000/ECDICT，MIT）
 *    英汉词典，提供：中文释义（含词性前缀）、音标、柯林斯星级、词频。
 *    61MB CSV，构建期一次性读取。
 *
 * 2) Tatoeba（CC-BY 2.0 FR）
 *    英中对照例句，通过公开 API 按词查询。**必须署名**。
 *    API 响应慢（约 3–10 秒/次），因此只在构建期跑一次并落盘缓存，
 *    运行时绝不联网。
 *
 * ── 为什么不运行时实时查 ──────────────────────────────────────────────────
 * 实测 15 个词耗时约 4 分钟，2.7 万词要几十小时，且依赖网络。
 * 全部在构建期预生成成静态 JSON，应用保持纯离线。
 *
 * ── 分级策略 ──────────────────────────────────────────────────────────────
 * 全量 2.7 万词的例句抓取不现实（Tatoeba 限流 + 耗时）。
 * 默认只为「高频词」抓例句：按 ECDICT 的 bnc/frq 词频排序取前 N 个，
 * 这些正是学习者最可能查词的。其余词只有释义增强，界面按字段存在性渲染。
 *
 * 用法：
 *   node scripts/build-rich-dicts.mjs --limit 2000        # 只处理前 2000 高频词
 *   node scripts/build-rich-dicts.mjs --limit 0           # 全量（很慢）
 *   node scripts/build-rich-dicts.mjs --offline           # 只用已有缓存
 *   node scripts/build-rich-dicts.mjs --only cet4         # 只处理一个词库
 */

import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');
const CACHE_DIR = path.join(ROOT, '.tmp', 'rich-cache');
const ECDICT_PATH = path.join(CACHE_DIR, 'ecdict.csv');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const OFFLINE = args.includes('--offline');
const LIMIT = Number(getArg('limit', '800'));
const ONLY = getArg('only', null);

/**
 * 例句抓取的并发与节流。
 *
 * 实测教训：并发 3 + 350ms 间隔会把 Tatoeba 打到限流（请求直接 fetch failed，
 * 要等几十秒才恢复）。改成串行 + 更长间隔，慢但稳定。
 * 反正只在构建期跑一次，能跑通比跑得快重要。
 */
const CONCURRENCY = 1;
const RETRY = 3;
/** 每次请求后的等待，避开限流 */
const THROTTLE_MS = 1200;

function log(...a) {
  process.stdout.write(a.join(' ') + '\n');
}

/** ---------- ECDICT ---------- */

/**
 * 解析一行 CSV。ECDICT 的字段里有引号和换行，不能简单 split(',')。
 * 这里实现一个够用的 CSV 解析器（支持双引号包裹、内部转义双引号）。
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 从 ECDICT 的 translation 字段里拆出"词性 + 释义"。
 * 原始格式类似：
 *   "n. 罩；风帽\nv. 覆盖；用头巾包\n[网络] 胡德"
 * 我们只取有词性前缀的行，丢弃 [网络]/[医] 这类标注行。
 */
function parseDefs(translation) {
  if (!translation) return [];
  const out = [];
  for (const rawLine of translation.split(/\\n|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // 跳过 [网络] [医] [化] 这类非词典释义
    if (/^\[[^\]]+\]/.test(line)) continue;
    // 匹配词性前缀：n. / vt. / adj. / abbr. 等
    const m = line.match(/^([a-z]{1,5}\.)\s*(.+)$/i);
    if (m) {
      const cn = m[2].replace(/；/g, '；').trim();
      if (cn) out.push({ pos: m[1].toLowerCase(), cn });
    } else if (out.length === 0) {
      // 没有任何词性前缀时，整行作为无词性释义
      out.push({ pos: '', cn: line });
    }
  }
  return out.slice(0, 6); // 最多 6 条，避免体积失控
}

/** 读取 ECDICT，返回 Map<小写单词, 需要的字段> */
async function loadEcdict() {
  try {
    await stat(ECDICT_PATH);
  } catch {
    log(`! 缺少 ECDICT 数据：${ECDICT_PATH}`);
    log('  请先下载：');
    log(
      '  curl -sSL -o "' +
        ECDICT_PATH +
        '" "https://api.github.com/repos/skywind3000/ECDICT/contents/ecdict.csv" 后 base64 解码',
    );
    log('  或从 https://github.com/skywind3000/ECDICT 直接获取 ecdict.csv');
    return null;
  }

  const map = new Map();
  const rl = createInterface({
    input: createReadStream(ECDICT_PATH, 'utf8'),
    crlfDelay: Infinity,
  });

  let header = null;
  let n = 0;
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    const w = (row.word || '').trim().toLowerCase();
    if (!w) continue;
    map.set(w, {
      phonetic: (row.phonetic || '').trim(),
      defs: parseDefs(row.translation || row.definition),
      collins: Number(row.collins) || 0,
      bnc: Number(row.bnc) || 0,
      frq: Number(row.frq) || 0,
      exchange: row.exchange || '',
    });
    n++;
    if (n % 100000 === 0) log(`  已读取 ECDICT ${n} 条…`);
  }
  log(`  ECDICT 载入 ${map.size} 条`);
  return map;
}

/** ---------- Tatoeba ---------- */

/** 缓存文件，避免重复请求 */
const sentenceCachePath = path.join(CACHE_DIR, 'sentences.json');

async function loadCache() {
  try {
    const raw = await readFile(sentenceCachePath, 'utf8');
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

async function saveCache(cache) {
  const obj = Object.fromEntries(cache);
  await writeFile(sentenceCachePath, JSON.stringify(obj));
}

/**
 * 查一个词的中英例句。
 * 返回 [{en, zh}]，最多 2 条。失败返回 []（不抛错，构建不该因个别词中断）。
 */
async function fetchSentences(word, attempt = 0) {
  const url =
    'https://api.tatoeba.org/v1/sentences?lang=eng&q=' +
    encodeURIComponent(word) +
    '&sort=relevance&trans%3Alang=cmn&limit=3';

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      if (attempt < RETRY) return fetchSentences(word, attempt + 1);
      return [];
    }
    const j = await res.json();
    const out = [];
    for (const s of j.data || []) {
      // 只要"目标词确实出现在英文句子里"的，避免 API 模糊匹配带偏
      if (!new RegExp(`\\b${word}\\b`, 'i').test(s.text || '')) continue;
      const trs = (s.translations || []).flat();
      const zh = trs.find((t) => t && t.lang === 'cmn' && t.text);
      if (!zh) continue;
      out.push({ en: s.text.trim(), zh: zh.text.trim() });
      if (out.length >= 2) break;
    }
    return out;
  } catch {
    if (attempt < RETRY) {
      // 指数退避：1.5s / 3s / 6s，给服务端恢复时间
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      return fetchSentences(word, attempt + 1);
    }
    return [];
  }
}

/** 按并发上限跑任务 */
async function runPool(items, worker, concurrency = CONCURRENCY) {
  const results = [];
  let cursor = 0;
  let done = 0;
  const total = items.length;

  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
      done++;
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`\r    例句进度 ${done}/${total}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  process.stdout.write('\n');
  return results;
}

/** ---------- 主流程 ---------- */

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  log('■ 读取 ECDICT…');
  const ecdict = await loadEcdict();
  if (!ecdict) {
    log('中止：需要 ECDICT 才能补词性与音标');
    process.exit(1);
  }

  // 读所有词库
  const indexPath = path.join(DICT_DIR, 'index.json');
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  const banks = ONLY ? index.banks.filter((b) => b.id === ONLY) : index.banks;

  log(`■ 处理 ${banks.length} 个词库，例句上限 ${LIMIT === 0 ? '全量' : LIMIT} 词`);

  // 收集所有词（去重），按词频排序决定谁先拿例句
  const allWords = new Set();
  const bankData = new Map();
  for (const b of banks) {
    const p = path.join(DICT_DIR, `${b.id}.json`);
    const data = JSON.parse(await readFile(p, 'utf8'));
    bankData.set(b.id, data);
    for (const w of data.words) allWords.add(w.w.toLowerCase());
  }
  log(`  共 ${allWords.size} 个唯一词`);

  // 按词频/柯林斯排序：越低（越靠前）越常见
  const ranked = [...allWords].sort((a, b) => {
    const ea = ecdict.get(a);
    const eb = ecdict.get(b);
    const score = (e) => (e ? (e.collins > 0 ? -1000 + e.bnc : e.bnc || 1e9) : 1e9);
    return score(ea) - score(eb);
  });

  const targetWords = LIMIT === 0 ? ranked : ranked.slice(0, LIMIT);
  log(`  其中 ${targetWords.length} 个词将尝试抓取例句`);

  const cache = await loadCache();
  log(`  例句缓存已有 ${cache.size} 条`);

  const toFetch = OFFLINE ? [] : targetWords.filter((w) => !cache.has(w));
  log(`  需要新抓取 ${toFetch.length} 个（离线模式跳过）`);

  if (toFetch.length > 0) {
    log('■ 抓取 Tatoeba 例句（较慢，请耐心）…');
    let saveTick = 0;
    await runPool(toFetch, async (w) => {
      const sentences = await fetchSentences(w);
      cache.set(w, sentences);
      // 每 50 个存一次盘，中断也能续
      if (++saveTick % 50 === 0) await saveCache(cache);
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
      return sentences;
    });
    await saveCache(cache);
    log(`  抓取完成，缓存 ${cache.size} 条`);
  }

  // 组装富词库
  log('■ 生成富词库…');
  let enrichedDefs = 0;
  let enrichedSentences = 0;
  let enrichedPhonetic = 0;

  for (const b of banks) {
    const data = bankData.get(b.id);
    const out = [];
    for (const w of data.words) {
      const key = w.w.toLowerCase();
      const ec = ecdict.get(key);
      const sents = cache.get(key) || [];
      const next = { ...w };

      if (ec) {
        if (ec.defs.length) {
          next.defs = ec.defs;
          enrichedDefs++;
        }
        // 音标：原词库已有就别覆盖（它来自专用词库，通常更准）
        if (!next.p && ec.phonetic) {
          next.p = `/${ec.phonetic}/`;
          enrichedPhonetic++;
        }
      }
      if (sents.length) {
        next.sentences = sents;
        enrichedSentences++;
      }
      out.push(next);
    }

    data.words = out;
    data.meta = {
      ...data.meta,
      count: out.length,
      source: data.meta.source + ' + ECDICT (MIT) 词性释义 + Tatoeba (CC-BY 2.0 FR) 例句',
    };
    await writeFile(path.join(DICT_DIR, `${b.id}.json`), JSON.stringify(data));
    log(`  ${b.id}: ${out.length} 词`);
  }

  log('');
  log('■ 完成');
  log(`  补上词性释义: ${enrichedDefs} 词`);
  log(`  补上例句:     ${enrichedSentences} 词`);
  log(`  补上音标:     ${enrichedPhonetic} 词`);
  log('');
  log('  署名要求：例句来自 Tatoeba，CC-BY 2.0 FR，需在应用内标注。');
}

main().catch((e) => {
  log('构建失败: ' + e.message);
  process.exit(1);
});

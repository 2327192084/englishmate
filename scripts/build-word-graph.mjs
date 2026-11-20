/**
 * 词族与形近词构建 —— 从 ECDICT 挖掘词关系，产出静态 JSON。
 *
 * ── 为什么做这个 ──────────────────────────────────────────────────────────
 * 我们的详情面板里有 `relWords`（同根词）区块，类型定义、渲染代码都写好了，
 * 但**数据从未被填充**，所以那块 UI 永远不会出现。
 *
 * 参考项目 WordLink（MIT）的做法给了验证：这类关系可以从 ECDICT 的
 * `exchange` 字段挖出来，不需要新的数据源——我们本地已有完整 ECDICT。
 *
 * ── 两类关系 ──────────────────────────────────────────────────────────────
 * 1. 词形变化（word family）
 *    reach → reached / reaching / reachable
 *    来源：ECDICT exchange 字段的紧凑编码
 *      p:过去式  d:过去分词  i:现在分词  r:比较级  t:最高级
 *      3:第三人称单数  0:原形  1:变化类型  s:复数
 *    实测：可挖出约 19.6 万条关系，覆盖我们词表的 67.2%
 *
 * 2. 形近易混词（look-alike）
 *    adapt / adopt / adept 这类"长得像但意思不同"的词
 *    纯算法：Dice 系数 2·LCS/(len(a)+len(b)) ≥ 阈值，
 *    且排除已在同一词族里的词（否则 reach/reached 也会被算成形近）
 *
 * ── 产物 ──────────────────────────────────────────────────────────────────
 * public/dicts/word-families.json
 *   { "<word>": { f: ["词形1", "词形2"], l: ["形近词1", ...] } }
 *   体积控制：短字段名 + 只收我们词表里存在的词
 *
 * 用法：
 *   node scripts/build-word-graph.mjs
 */
import { createReadStream } from 'node:fs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CACHE = path.join(ROOT, '.tmp', 'rich-cache');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');
const ECDICT = path.join(CACHE, 'ecdict.csv');

/** 形近词的 Dice 阈值（WordLink 用 0.75，实测这个值区分度不错） */
const LOOKALIKE_THRESHOLD = 0.75;
/** 形近词最多保留几个，避免数据膨胀且界面放不下 */
const MAX_LOOKALIKE = 4;
/** 词族最多保留几个 */
const MAX_FAMILY = 8;
/** 太短的词形近判定噪声大（be / he 会互相命中），跳过长度 < 4 */
const MIN_LOOKALIKE_LEN = 4;

function log(...a) {
  process.stdout.write(a.join(' ') + '\n');
}

/** 与其它构建脚本一致的 CSV 解析（引号包裹 + 转义双引号） */
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
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * 解析 ECDICT 的 exchange 紧凑编码。
 * 例："p:abandoned/d:abandoned/i:abandoning/3:abandons"
 *     "0:be/1:p"（这是反向引用，表示自己是某词的变化形式）
 */
function parseExchange(ex) {
  const out = {};
  if (!ex) return out;
  for (const part of ex.split('/')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

/** 最长公共子序列长度 */
function lcsLength(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  // 滚动数组，O(min) 空间
  let prev = new Array(n + 1).fill(0);
  let cur = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n];
}

/** Dice 系数：2·LCS / (len(a)+len(b)) */
function dice(a, b) {
  return (2 * lcsLength(a, b)) / (a.length + b.length);
}

async function main() {
  // ── 1. 读目标词表 ──────────────────────────────────────────
  const idx = JSON.parse(readFileSync(path.join(DICT_DIR, 'index.json'), 'utf8'));
  /** 我们要覆盖的词（小写） */
  const target = new Set();
  for (const b of idx.banks) {
    const d = JSON.parse(readFileSync(path.join(DICT_DIR, `${b.id}.json`), 'utf8'));
    for (const w of d.words) target.add(w.w.toLowerCase());
  }
  log(`■ 目标词表：${target.size.toLocaleString()} 个去重词`);

  // ── 2. 扫 ECDICT，收集词形关系 ─────────────────────────────
  log('■ 读取 ECDICT，解析 exchange 字段…');
  const rl = createInterface({ input: createReadStream(ECDICT, 'utf8'), crlfDelay: Infinity });

  let header = null;
  /** 原形 → Set<变化形式> */
  const family = new Map();
  /** 变化形式 → 原形（用于反向补全，例如 reached → reach） */
  const baseOf = new Map();
  let scanned = 0;

  /** 添加一条词形关系（双向都可查） */
  const addForm = (base, form) => {
    if (!base || !form || base === form) return;
    if (base.length < 2 || form.length < 2) return;
    let set = family.get(base);
    if (!set) {
      set = new Set();
      family.set(base, set);
    }
    if (set.size < MAX_FAMILY) set.add(form);
    baseOf.set(form, base);
  };

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    scanned++;
    if (scanned % 200000 === 0) process.stdout.write(`\r  已扫 ${scanned.toLocaleString()} 行…`);

    const cols = parseCsvLine(line);
    const w = (cols[0] || '').trim().toLowerCase();
    if (!w) continue;
    const ex = parseExchange(cols[10] || '');
    if (Object.keys(ex).length === 0) continue;

    // 本词是原形：p/d/i/r/t/3/s 都是它的变化形式
    for (const key of ['p', 'd', 'i', 'r', 't', '3', 's']) {
      if (ex[key]) addForm(w, ex[key].toLowerCase());
    }
    // 本词是某词的变化形式：0 字段指向原形
    if (ex['0']) addForm(ex['0'].toLowerCase(), w);
  }
  process.stdout.write('\r');
  log(`  扫完 ${scanned.toLocaleString()} 行，原始词族 ${family.size.toLocaleString()} 组`);

  // ── 3. 只保留我们词表里有的词 ──────────────────────────────
  log('■ 过滤到目标词表…');
  /**
   * 关键：**只要求原形在词表内**，变化形式不必在。
   *
   * 词族的价值就是告诉用户"abandon 还有 abandoned / abandoning / abandons"，
   * 那些屈折形式本来就不该单独出现在词表里。最初要求变化形式也必须在
   * 词表内，结果把几乎所有词族都过滤掉了（1613 / 18716）。
   */
  const familyOut = new Map();
  for (const [base, forms] of family) {
    if (!target.has(base)) continue; // 原形必须在词表里（它是主键）
    const valid = [...forms].filter((f) => /^[a-z][a-z'-]*$/.test(f) && f.length >= 2);
    if (valid.length === 0) continue;
    familyOut.set(base, valid.slice(0, MAX_FAMILY));
  }
  /**
   * 反向补充：某个屈折形式若恰好在词表里（比如 reached 也是独立词条），
   * 让它也能查到整个族，从任一端都能看到全貌。
   */
  for (const [base, forms] of [...familyOut]) {
    for (const f of forms) {
      if (target.has(f) && !familyOut.has(f)) {
        familyOut.set(f, [base, ...forms.filter((x) => x !== f)].slice(0, MAX_FAMILY));
      }
    }
  }
  log(`  有词族的词：${familyOut.size.toLocaleString()} / ${target.size.toLocaleString()}`);

  // ── 4. 形近词：按长度分桶后两两比较，避免 O(n²) 全量 ────────
  log('■ 计算形近词（Dice ≥ ' + LOOKALIKE_THRESHOLD + '）…');
  const candidates = [...target].filter((w) => w.length >= MIN_LOOKALIKE_LEN && /^[a-z]+$/.test(w));
  /** 按首字母 + 长度分组：形近词首字母和长度通常接近 */
  const buckets = new Map();
  for (const w of candidates) {
    const key = `${w[0]}|${Math.floor(w.length / 2)}`;
    const arr = buckets.get(key) || [];
    arr.push(w);
    buckets.set(key, arr);
  }

  /** word → 形近词数组 */
  const lookalike = new Map();
  for (const [, words] of buckets) {
    // 桶内太大时跳过（避免个别字母开头的词过多导致慢）
    if (words.length > 400) continue;
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        const a = words[i];
        const b = words[j];
        // 同族词不算形近（reach / reached 是同一词族）
        const famA = familyOut.get(a);
        if (famA && famA.includes(b)) continue;
        // 首字母不同一般不像
        if (a[0] !== b[0]) continue;
        // 长度差 2 以上基本不像
        if (Math.abs(a.length - b.length) > 2) continue;

        const score = dice(a, b);
        if (score < LOOKALIKE_THRESHOLD) continue;

        pushLookalike(lookalike, a, b, score);
        pushLookalike(lookalike, b, a, score);
      }
    }
  }

  function pushLookalike(map, word, other, score) {
    const arr = map.get(word) || [];
    if (arr.length >= MAX_LOOKALIKE * 3) return; // 先多收一些，最后再截断
    if (arr.some((x) => x.w === other)) return;
    arr.push({ w: other, s: score });
    map.set(word, arr);
  }

  // 每个词取分数最高的前几个
  for (const [w, arr] of lookalike) {
    arr.sort((x, y) => y.s - x.s);
    lookalike.set(
      w,
      arr.slice(0, MAX_LOOKALIKE).map((x) => x.w),
    );
  }
  log(`  有形近词的词：${lookalike.size.toLocaleString()}`);

  // ── 5. 合并输出 ───────────────────────────────────────────
  log('■ 生成产物…');
  const out = {};
  const allWords = new Set([...familyOut.keys(), ...lookalike.keys()]);
  for (const w of allWords) {
    const f = familyOut.get(w);
    const l = lookalike.get(w);
    const entry = {};
    if (f && f.length) entry.f = f;
    if (l && l.length) entry.l = l;
    if (Object.keys(entry).length) out[w] = entry;
  }

  const outPath = path.join(DICT_DIR, 'word-graph.json');
  writeFileSync(outPath, JSON.stringify(out));
  const sizeMB = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(2);

  const famCount = Object.values(out).filter((x) => x.f).length;
  const lookCount = Object.values(out).filter((x) => x.l).length;
  const totalRels =
    Object.values(out).reduce((s, x) => s + (x.f?.length ?? 0), 0) +
    Object.values(out).reduce((s, x) => s + (x.l?.length ?? 0), 0);

  log('');
  log('■ 完成');
  log(
    `  覆盖词数：  ${Object.keys(out).length.toLocaleString()} / ${target.size.toLocaleString()}`,
  );
  log(`  有词族：    ${famCount.toLocaleString()} 词`);
  log(`  有形近词：  ${lookCount.toLocaleString()} 词`);
  log(`  关系总条数：${totalRels.toLocaleString()}`);
  log(`  文件体积：  ${sizeMB} MB → public/dicts/word-graph.json`);
}

main().catch((e) => {
  log('失败: ' + e.message);
  process.exit(1);
});

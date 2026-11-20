/**
 * 验证 ECDICT 能否用来挖掘「词形变化」词链。
 *
 * WordLink 用 ECDICT 的 exchange 字段挖出 12.5 万条词形变化关系。
 * 我们本地已有完整 ECDICT，这里验证字段可用性与实际可挖出的量。
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** 与 build-rich-dicts.mjs 里一致的 CSV 解析（支持引号包裹与转义） */
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
 * ECDICT 的 exchange 字段格式（紧凑编码）：
 *   p:过去式  d:过去分词  i:现在分词  r:比较级  t:最高级
 *   3:第三人称单数  0:原形  1:原形的变化类型
 * 例："p:abandoned/d:abandoned/i:abandoning/3:abandons"
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

async function main() {
  const path = '.tmp/rich-cache/ecdict.csv';
  const rl = createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Infinity,
  });

  let header = null;
  let total = 0;
  let withExchange = 0;
  const relationCount = {};
  const samples = [];
  const words = new Set();

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
    total++;

    const w = (row.word || '').trim().toLowerCase();
    if (!w) continue;
    words.add(w);

    const ex = parseExchange(row.exchange);
    const keys = Object.keys(ex);
    if (keys.length === 0) continue;
    withExchange++;
    for (const k of keys) relationCount[k] = (relationCount[k] || 0) + 1;
    if (samples.length < 8) samples.push(`${w} → ${row.exchange}`);
  }

  console.log('■ ECDICT 词形变化字段统计');
  console.log(`  总词条:      ${total.toLocaleString()}`);
  console.log(
    `  有 exchange: ${withExchange.toLocaleString()} (${((withExchange / total) * 100).toFixed(1)}%)`,
  );
  console.log('');
  console.log('  各类型数量（p=过去式 d=过去分词 i=现在分词 r=比较级 t=最高级 3=三单 0=原形）：');
  Object.entries(relationCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k}: ${v.toLocaleString()}`));

  console.log('\n  样本:');
  samples.forEach((s) => console.log('   ', s));

  // 估算可挖掘的关系条数（每条 exchange 值都是一条"词形-原形"链）
  const estimated = Object.values(relationCount).reduce((a, b) => a + b, 0);
  console.log(`\n■ 理论上可挖出 ${estimated.toLocaleString()} 条词形变化关系`);

  // 检查我们的目标词表覆盖率
  const fs = await import('node:fs');
  const idx = JSON.parse(fs.readFileSync('public/dicts/index.json', 'utf8'));
  const target = new Set();
  for (const b of idx.banks) {
    const d = JSON.parse(fs.readFileSync(`public/dicts/${b.id}.json`, 'utf8'));
    for (const w of d.words) target.add(w.w.toLowerCase());
  }
  console.log(`\n■ 我们的词表去重后 ${target.size.toLocaleString()} 词`);

  // 重扫一遍算交集（内存里没存 mapping，简单起见再读一遍）
  let covered = 0;
  const rl2 = createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Infinity,
  });
  let h2 = null;
  for await (const line of rl2) {
    if (!h2) {
      h2 = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const w = (cols[h2.indexOf('word')] || '').trim().toLowerCase();
    const ex = cols[h2.indexOf('exchange')] || '';
    if (!w || !ex) continue;
    if (target.has(w)) covered++;
  }
  console.log(
    `  其中有词形变化数据的: ${covered.toLocaleString()} (${((covered / target.size) * 100).toFixed(1)}%)`,
  );
}

main();

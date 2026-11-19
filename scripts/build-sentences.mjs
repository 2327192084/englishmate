/**
 * 例句构建 —— 离线 join 版（替代逐词调 API）。
 *
 * ── 为什么不用 API ────────────────────────────────────────────────────────
 * 最初版本逐词请求 `api.tatoeba.org`，实测：单次 2–10 秒，13,987 个词要 8 小时，
 * 而且并发几次就被限流（fetch failed，几十秒才恢复）。这在构建期不可接受。
 *
 * 改为下载 Tatoeba 官方导出包离线 join：
 *   eng_sentences.tsv.bz2   24.9MB  英文句子  id \t 语言 \t 文本
 *   cmn_sentences.tsv.bz2    1.2MB  中文句子
 *   eng-cmn_links.tsv.bz2    471KB  英中对照  engId \t cmnId
 * 三份文件 join 一次即可得到全部中英对照句，不再依赖任何在线服务。
 *
 * 产物写 .tmp/rich-cache/sentences.json，供 build-rich-dicts.mjs 直接读用。
 *
 * 用法：
 *   node scripts/build-sentences.mjs              # 全量 join
 *   node scripts/build-sentences.mjs --max-per-word 2
 */

import { createReadStream, existsSync } from 'node:fs';
import { writeFile, mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CACHE = path.join(ROOT, '.tmp', 'rich-cache');
const DICT_DIR = path.join(ROOT, 'public', 'dicts');

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const MAX_PER_WORD = Number(getArg('max-per-word', '2'));
/** 太长的句子不适合当例句（阅读负担大、打字更累） */
const MAX_SENTENCE_LEN = 80;
/** 太短的没有语境价值 */
const MIN_SENTENCE_LEN = 12;

const FILES = {
  eng: path.join(CACHE, 'eng_sentences.tsv.bz2'),
  cmn: path.join(CACHE, 'cmn_sentences.tsv.bz2'),
  links: path.join(CACHE, 'eng-cmn_links.tsv.bz2'),
};

function log(...a) {
  process.stdout.write(a.join(' ') + '\n');
}

/**
 * 逐行读 bz2 文件。
 *
 * Node 的 zlib 不支持 bzip2（只有 gzip/deflate），所以调用系统 bzip2 命令。
 * 首次使用时解压成同名 .tsv，后续直接读明文——英文包 24.9MB 解压后约 80MB，
 * 每次重解一遍纯属浪费。
 */
async function readBz2Lines(filePath, onLine) {
  const tsv = filePath.replace(/\.bz2$/, '');
  if (!existsSync(tsv)) {
    process.stdout.write(`    解压 ${path.basename(filePath)} … `);
    execFileSync('bzip2', ['-dkf', filePath], { stdio: 'ignore' });
    process.stdout.write('完成\n');
  }
  const rl = createInterface({ input: createReadStream(tsv, 'utf8'), crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    n++;
    await onLine(line, n);
  }
  return n;
}

/**
 * 常见词形还原：把一个带屈折的 token 还原成可能的基础形式。
 *
 * 为什么需要：Tatoeba 的句子里 "elect" 常以 elected / electing / elects 出现，
 * 只按原形精确匹配会漏掉大量句子（实测 54% → 预计能到 70%+）。
 * 这里用规则覆盖英文最常见的屈折，比引入词形数据库轻量得多。
 */
function lemmaCandidates(token) {
  const out = [token];
  const t = token;

  // 复数 / 第三人称单数
  if (t.endsWith('ies') && t.length > 4) out.push(t.slice(0, -3) + 'y');
  if (t.endsWith('es') && t.length > 3) out.push(t.slice(0, -2));
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 2) out.push(t.slice(0, -1));

  // 过去式 / 过去分词
  if (t.endsWith('ied') && t.length > 4) out.push(t.slice(0, -3) + 'y');
  if (t.endsWith('ed') && t.length > 3) {
    out.push(t.slice(0, -2)); // walk-ed -> walk
    out.push(t.slice(0, -1)); // 去 d：love-d -> love
    // 双写辅音：stop-ped -> stop
    if (t.length > 4 && t[t.length - 3] === t[t.length - 4]) out.push(t.slice(0, -3));
  }

  // 现在分词
  if (t.endsWith('ing') && t.length > 4) {
    out.push(t.slice(0, -3)); // walk-ing
    out.push(t.slice(0, -3) + 'e'); // mak-ing -> make
    if (t.length > 5 && t[t.length - 4] === t[t.length - 5]) out.push(t.slice(0, -4)); // run-ning
  }

  // 比较级 / 最高级
  if (t.endsWith('er') && t.length > 3) {
    out.push(t.slice(0, -2));
    out.push(t.slice(0, -1));
  }
  if (t.endsWith('est') && t.length > 4) {
    out.push(t.slice(0, -3));
    out.push(t.slice(0, -2));
  }

  return out;
}

async function main() {
  await mkdir(CACHE, { recursive: true });

  // 检查文件是否齐备
  for (const [k, p] of Object.entries(FILES)) {
    try {
      const s = await stat(p);
      log(`  ✓ ${k}: ${(s.size / 1024 / 1024).toFixed(1)}MB`);
    } catch {
      log(`  ✗ 缺少 ${p}`);
      log('');
      log('请先下载 Tatoeba 导出包：');
      log('  curl -sSL -o .tmp/rich-cache/eng_sentences.tsv.bz2 \\');
      log('    https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2');
      log('  curl -sSL -o .tmp/rich-cache/cmn_sentences.tsv.bz2 \\');
      log('    https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2');
      log('  curl -sSL -o .tmp/rich-cache/eng-cmn_links.tsv.bz2 \\');
      log('    https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2');
      log('');
      log('（下载慢是正常的，服务端限速约 60KB/s；英文包可用 curl -C - 断点续传）');
      process.exit(1);
    }
  }

  // ── 1. 载入英中链接表 ──────────────────────────────────────
  log('\n■ 读取英中对照索引…');
  /** engId -> cmnId[] */
  const links = new Map();
  const linkCount = await readBz2Lines(FILES.links, (line) => {
    const [e, c] = line.split('\t');
    if (!e || !c) return;
    const arr = links.get(e);
    if (arr) arr.push(c);
    else links.set(e, [c]);
  });
  log(`  ${linkCount.toLocaleString()} 条链接，涉及 ${links.size.toLocaleString()} 个英文句`);

  // ── 2. 收集本次需要的中文句子 id ───────────────────────────
  // 先只收集"被链接到的"中文 id，避免把整个中文库读进内存
  const neededCmn = new Set();
  for (const ids of links.values()) for (const id of ids) neededCmn.add(id);
  log(`  需要 ${neededCmn.size.toLocaleString()} 个中文句子`);

  // ── 3. 读中文句子 ─────────────────────────────────────────
  log('■ 读取中文句子…');
  const cmnText = new Map();
  await readBz2Lines(FILES.cmn, (line) => {
    const idx = line.indexOf('\t');
    if (idx < 0) return;
    const id = line.slice(0, idx);
    if (!neededCmn.has(id)) return;
    const rest = line.slice(idx + 1);
    // 格式：id \t lang \t text
    const idx2 = rest.indexOf('\t');
    const text = idx2 >= 0 ? rest.slice(idx2 + 1) : rest;
    cmnText.set(id, text.trim());
  });
  log(`  取到 ${cmnText.size.toLocaleString()} 条中文句子`);

  // ── 4. 读目标词表，建"词 -> 候选英文句" ─────────────────────
  log('■ 读取目标词表…');
  const { readFile, readdir } = await import('node:fs/promises');
  const idxFile = JSON.parse(await readFile(path.join(DICT_DIR, 'index.json'), 'utf8'));
  const targetWords = new Set();
  for (const b of idxFile.banks) {
    const data = JSON.parse(await readFile(path.join(DICT_DIR, `${b.id}.json`), 'utf8'));
    for (const w of data.words) targetWords.add(w.w.toLowerCase());
  }
  log(`  ${targetWords.size.toLocaleString()} 个目标词`);

  // ── 5. 扫英文句子，把命中目标词的句子挑出来 ─────────────────
  log('■ 匹配英文句子（这一步最慢）…');
  /** word -> [{en, zh}] */
  const result = new Map();
  let scanned = 0;
  let matched = 0;

  await readBz2Lines(FILES.eng, (line) => {
    scanned++;
    if (scanned % 200000 === 0) {
      process.stdout.write(`\r    已扫 ${(scanned / 1e6).toFixed(2)}M 句，命中 ${matched}`);
    }

    const idx = line.indexOf('\t');
    if (idx < 0) return;
    const id = line.slice(0, idx);
    // 没有对照关系就跳过，省掉后续全部工作
    if (!links.has(id)) return;

    const rest = line.slice(idx + 1);
    const idx2 = rest.indexOf('\t');
    const text = (idx2 >= 0 ? rest.slice(idx2 + 1) : rest).trim();

    if (text.length < MIN_SENTENCE_LEN || text.length > MAX_SENTENCE_LEN) return;

    // 找出这句话里出现了哪些目标词
    const tokens = text.toLowerCase().match(/[a-z']+/g);
    if (!tokens) return;
    const hitWords = new Set();
    for (const t of tokens) {
      // 先试原形，命中就省掉还原计算
      if (targetWords.has(t)) {
        hitWords.add(t);
        continue;
      }
      // 再试各屈折还原形式
      for (const cand of lemmaCandidates(t)) {
        if (cand !== t && targetWords.has(cand)) {
          hitWords.add(cand);
          break;
        }
      }
    }
    if (hitWords.size === 0) return;

    // 取第一个可用的中文译文
    let zh = null;
    for (const cid of links.get(id)) {
      const t = cmnText.get(cid);
      if (t) {
        zh = t;
        break;
      }
    }
    if (!zh) return;

    for (const w of hitWords) {
      const arr = result.get(w) || [];
      if (arr.length >= MAX_PER_WORD) continue;
      // 去重（同一句可能因为多个译文重复）
      if (arr.some((x) => x.en === text)) continue;
      arr.push({ en: text, zh });
      result.set(w, arr);
      matched++;
    }
  });
  process.stdout.write('\n');
  log(`  扫完 ${scanned.toLocaleString()} 句，命中 ${matched.toLocaleString()} 条候选`);

  // ── 6. 落盘 ───────────────────────────────────────────────
  const obj = Object.fromEntries([...result.entries()].filter(([, v]) => v.length > 0));
  await writeFile(path.join(CACHE, 'sentences.json'), JSON.stringify(obj));

  const withSentences = Object.keys(obj).length;
  log('');
  log('■ 完成');
  log(`  有例句的词: ${withSentences.toLocaleString()} / ${targetWords.size.toLocaleString()}`);
  log(`  覆盖率: ${((withSentences / targetWords.size) * 100).toFixed(1)}%`);
  log(`  产物: .tmp/rich-cache/sentences.json`);
  log('');
  log('  署名要求：例句来自 Tatoeba，CC-BY 2.0 FR');
}

main().catch((e) => {
  log('失败: ' + e.message);
  process.exit(1);
});

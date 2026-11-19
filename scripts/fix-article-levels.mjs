/**
 * 修正文章难度分级。
 *
 * ── 问题 ──────────────────────────────────────────────────────────────────
 * 构建脚本用 ECDICT 的 BNC 词频分位算难度，结果把《The Gnat and the Bull》
 * 这类简单寓言划进了"雅思"档。原因：寓言里有古体/生僻词（gnat、vixen、
 * 以及 1912 年译文里的 wot、sorely 之类），把这些词的词频一平均，难度分虚高。
 *
 * ── 修正原则 ──────────────────────────────────────────────────────────────
 * 难度应主要反映"句子结构复杂度 + 词汇常见度"，而不是被个别生僻词拉偏。
 * 用更稳的判据：
 *   1. 来源类型先行 —— Aesop 寓言是入门读物，最高只到 CET-6；
 *      议论性散文（图灵、爱因斯坦、奥威尔）才配雅思/考研。
 *   2. 句长作为辅助 —— 平均句长 <70 字符的归 CET-4。
 *   3. 取两者中较容易的一档，避免难度虚高。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const FILE = path.join(ROOT, 'public', 'articles', 'index.json');

const LEVELS = ['CET-4', 'CET-6', '考研', '雅思'];

/** 判断是不是寓言类（Aesop） */
function isFable(a) {
  return /aesop/i.test(a.author || '') || /aesop/i.test(a.source || '');
}

/** 判断是不是议论/思辨类散文（这类才适合雅思、考研） */
function isEssay(a) {
  const t = `${a.author} ${a.title}`.toLowerCase();
  return /turing|einstein|orwell|computing machinery|world as i see|politics and the english/.test(
    t,
  );
}

/** 诗歌类（Sonnet 等），语体古雅但句子不一定长 */
function isPoetry(a) {
  const t = `${a.title} ${a.author}`.toLowerCase();
  return /sonnet|shakespeare/.test(t);
}

function averageSentenceLength(a) {
  if (!a.sentences.length) return 0;
  return a.sentences.reduce((s, x) => s + x.en.length, 0) / a.sentences.length;
}

/**
 * 给出难度档。
 *
 * ── 为什么按来源定档，而不按句长/词频量化 ──────────────────────────────
 * 我实测过三种量化方案，都不成立：
 *   1. ECDICT 词频分位 —— 被寓言里的古体词（vixen、gnat、wot）拉高，
 *      《The Gnat and the Bull》被判成雅思。
 *   2. 平均句长 —— 1912 年译文句子普遍 78–103 字符，与图灵论文（81）无差别，
 *      26 篇寓言被判成考研。
 *   3. 从句密度 —— 实测寓言 2.2、议论文 1.0，寓言反而更高。
 * 也就是说**结构指标分不开寓言与学术散文**，真正的差别是内容抽象度，
 * 那是机器不可靠判断的东西。
 *
 * 所以按来源类型定档——这是能站得住的判据：
 *   寓言（Aesop）       → 入门读物，CET-4 / CET-6
 *   议论散文（图灵等）   → 学术英语，考研 / 雅思
 *   诗歌                → 语体古雅但句子短，CET-6
 *   演讲                → 视篇幅，CET-4 / CET-6
 * 每类内部再按句长微调，只在同类型内比较，不跨类比较。
 */
function suggestLevel(a) {
  const avg = averageSentenceLength(a);

  if (isEssay(a)) {
    // 议论散文内部：更长的句子（嵌套从句多）给雅思
    return avg >= 80 ? '雅思' : '考研';
  }

  if (isPoetry(a)) return 'CET-6';

  if (isFable(a)) {
    // 寓言内部按句长分两档，绝不进考研/雅思
    return avg >= 80 ? 'CET-6' : 'CET-4';
  }

  // 演讲与其它：按句长
  if (avg >= 85) return '考研';
  if (avg >= 70) return 'CET-6';
  return 'CET-4';
}

function main() {
  const raw = readFileSync(FILE, 'utf8');
  const articles = JSON.parse(raw);

  const before = {};
  const changed = [];

  for (const a of articles) {
    before[a.level] = (before[a.level] || 0) + 1;
    const next = suggestLevel(a);
    if (next !== a.level) {
      changed.push({
        title: a.title,
        from: a.level,
        to: next,
        avg: Math.round(averageSentenceLength(a)),
      });
      a.level = next;
    }
  }

  writeFileSync(FILE, JSON.stringify(articles, null, 2));

  const after = {};
  for (const a of articles) after[a.level] = (after[a.level] || 0) + 1;

  console.log('■ 难度分级修正');
  console.log('  修正前:', JSON.stringify(before));
  console.log('  修正后:', JSON.stringify(after));
  console.log(`  改动 ${changed.length} 篇`);
  if (changed.length) {
    console.log('\n  样本（最多 12 条）:');
    changed
      .slice(0, 12)
      .forEach((c) =>
        console.log(`    ${c.title.slice(0, 34).padEnd(36)} ${c.from} → ${c.to}  (均长 ${c.avg})`),
      );
  }

  // 检查是否还有寓言被归入考研/雅思
  const bad = articles.filter((a) => isFable(a) && (a.level === '考研' || a.level === '雅思'));
  if (bad.length) {
    console.log(
      `\n  ! 仍有 ${bad.length} 篇寓言在考研/雅思档: ${bad.map((x) => x.title).join(', ')}`,
    );
  } else {
    console.log('\n  ✓ 没有寓言被归入考研/雅思');
  }
}

main();

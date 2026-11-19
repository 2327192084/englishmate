/**
 * 文章语料构建 —— Tatoeba 英中对照句库主题化组装
 *
 * 用法：
 *   node scripts/build-articles.mjs            # 生成 public/articles/index.json
 *   node scripts/build-articles.mjs --dry      # 只打印每篇选中的句子，不写文件
 *   node scripts/build-articles.mjs --theme tech   # 只看某个主题的候选池
 *
 * 数据来源：本机 .tmp/rich-cache/ 下 Tatoeba 官方导出包（eng_sentences / cmn_sentences /
 * eng-cmn_links），许可 CC-BY 2.0 FR。详见 docs/article-sources.md。
 */

import { createReadStream, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CACHE = path.join(ROOT, '.tmp', 'rich-cache');
const WORK = path.join(ROOT, '.tmp', 'articles-work');
const OUT_DIR = path.join(ROOT, 'public', 'articles');

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/* ────────────────────────────── 字符归一化 ────────────────────────────── */

/** 与 src/lib/text.ts 的 CHAR_MAP 保持一致（只用于判定，不改原句） */
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
const normalize = (s) =>
  [...s]
    .map((c) => CHAR_MAP[c] ?? c)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/* ────────────────────────────── 语料载入 ────────────────────────────── */

async function readTsv(file, wanted, valueAt) {
  const map = new Map();
  const rl = createInterface({
    input: createReadStream(file, 'utf8'),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const t1 = line.indexOf('\t');
    if (t1 < 0) continue;
    const id = line.slice(0, t1);
    if (!wanted.has(id)) continue;
    const t2 = line.indexOf('\t', t1 + 1);
    map.set(id, line.slice(t2 + 1));
  }
  return map;
}

/** 读出全部英中对照句：{ id, en, zh }（zh 已转简体） */
async function loadPairs() {
  const linkFile = path.join(CACHE, 'eng-cmn_links.tsv');
  const engFile = path.join(CACHE, 'eng_sentences.tsv');
  const cmnFile = path.join(CACHE, 'cmn_sentences.tsv');
  for (const f of [linkFile, engFile, cmnFile]) {
    if (!existsSync(f)) {
      throw new Error(
        `缺少语料文件 ${f}\n请先按 docs/article-sources.md 的说明下载 Tatoeba 导出包并解压到 .tmp/rich-cache/。`,
      );
    }
  }

  const links = [];
  const rl = createInterface({ input: createReadStream(linkFile, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    links.push([line.slice(0, tab), line.slice(tab + 1).trim()]);
  }

  const eng = await readTsv(engFile, new Set(links.map((l) => l[0])));
  const cmn = await readTsv(cmnFile, new Set(links.map((l) => l[1])));

  const toSimplified = await loadSimplifier();
  const rows = [];
  for (const [e, c] of links) {
    const en = eng.get(e);
    const rawZh = cmn.get(c);
    if (!en || !rawZh) continue;
    rows.push({ id: Number(e), en, zh: toSimplified(rawZh) });
  }
  return rows;
}

/**
 * 繁 → 简。语料里中文句混有繁体，直接给中文用户看得别扭。
 * 用 zhconv（OpenCC/MediaWiki 规则表）做一次转换；本机没有就从 npm 取一份到 .tmp，
 * 不写进仓库、不进 node_modules，因为只在构建期需要。
 */
async function loadSimplifier() {
  const local = path.join(WORK, 'package', 'zhconv.js');
  if (!existsSync(local)) return (s) => s;
  const mod = await import(pathToFileUrl(local));
  return (s) => mod.zhconv(s, 'zh-CN');
}

function pathToFileUrl(p) {
  return new URL(`file://${p.replace(/\\/g, '/')}`).href;
}

/* ────────────────────────────── 硬过滤 ────────────────────────────── */

/** 不适合出现在通用学习应用里的内容 */
const BLOCKLIST =
  /\b(sex|sexual|sexy|masturbat\w*|porn\w*|rape\w*|nude|naked|prostitut\w*|condom|virgin|gay|lesbian|breast\w*|penis|vagina|kill\w*|murder\w*|suicid\w*|die|died|dying|dead|death|corpse|blood|gun|weapon|shoot|stab|war|bomb|terroris\w*|nazi|hitler|racis\w*|slave\w*|damn|hell|shit|fuck\w*|bitch|bastard|crap|piss|drunk|drug\w*|cocaine|heroin|smok\w*|cigarett\w*|gambl\w*|abort\w*|atheis\w*|god|jesus|christ|buddha|allah|religio\w*|church|mosque|priest|pray\w*)\b/i;

/**
 * 第二层内容过滤：贬损、成瘾、性、暴力、身份政治。
 * 这些句子单看语法没问题，但放进一个给所有人用的打字练习应用里不合适。
 * 刻意**不**包含 family / law / work 这类中性词——那些是正常主题词汇。
 */
const SENSITIVE =
  /\b(loser|losers|idiot|idiots|stupid|dumb|fool|fools|ugly|worthless|pathetic|slut|whore|pervert|creep\w*|misogyn\w*|femin\w*|sexis\w*|racis\w*|discriminat\w*|prejudic\w*|minorit\w*|refugee\w*|protest\w*|riot\w*|prison|jail|arrest\w*|lawsuit|abuse\w*|violen\w*|assault\w*|harass\w*|bull(y|ies|ied|ying)|pregnan\w*|condom|kiss\w*|romance|romantic|affair|mistress|lover|boyfriend|girlfriend|ex-wife|ex-husband|drug|drugs|alcohol|beer|wine|whisk\w*|vodka|drunk|casino|lottery|gambl\w*|nonsense|shut up|damn|hell)\b/i;

/**
 * 人名/品牌：主题句里出现它们会让"文章"读起来像散句接龙。
 * 刻意不含国名/语言名（English / French / Chinese 是 legit 的主题词）。
 */
const PROPER =
  /\b(Tom|Mary|John|Jack|Mike|Jim|Bob|Bill|Peter|Paul|Ann|Anna|Lucy|Jane|Kate|Ken|Nancy|Robert|David|Susan|Betty|Linda|Sami|Fadil|Layla|Muiriel|Yuka|Tatoeba|Mick|Mac|Rachel|Google|Facebook|Microsoft|Apple|Windows|Kmart|Walmart|IKEA|Xiaomi|Toyota|Honda|Nike|Sony)\b/;

/** 具体地名：出现它们多半是"我住在东京"这类句子，脱离主题语境 */
const PLACES =
  /\b(Tokyo|Osaka|Kyoto|Nagoya|Boston|Chicago|Seattle|London|Manchester|Paris|Berlin|Madrid|Rome|Moscow|Beijing|Shanghai|Taiwan|Hong Kong|Singapore|Australia|Canada|Mexico|Brazil|Egypt|Israel|Iraq|Iran|Korea|Vietnam|Thailand)\b/;

const STOP = new Set(
  'a an the is are was were be been being am do does did have has had i you he she it we they me him her us them my your his its our their this that these those of in on at to for with from by as and or but not no so if then than there here what which who whom whose when where why how can could will would shall should may might must about into over after before more most very just also only all some any such same own too s t'.split(
    ' ',
  ),
);

/** 内容词（去停用词，用于相似度与连贯性） */
function contentWords(en) {
  return new Set(
    normalize(en)
      .toLowerCase()
      .replace(/[^a-z' ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccard(a, b) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** 连续 n 词片段，用来抓 Tatoeba 里那种"只换一两个词"的改写句 */
function ngramRuns(en, n = 4) {
  const words = normalize(en)
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const runs = new Set();
  for (let i = 0; i + n <= words.length; i++) runs.add(words.slice(i, i + n).join(' '));
  return runs;
}

/** 两句是否"太像同一句"：共享 4 词连续片段，或词面重合过半 */
function tooAlike(a, b) {
  if (jaccard(a.cw, b.cw) > 0.42) return true;
  const ra = a.runs ?? (a.runs = ngramRuns(a.en));
  const rb = b.runs ?? (b.runs = ngramRuns(b.en));
  if (!ra.size || !rb.size) return false;
  let shared = 0;
  for (const r of ra) if (rb.has(r)) shared++;
  return shared / Math.min(ra.size, rb.size) > 0.34;
}

/** 单句是否可用：长度、字符、译文、内容都在这里一票否决 */
function acceptable(row) {
  const en = normalize(row.en);
  // 32 字符 ≈ 5–6 个词，短于此的句子单独成篇没有信息量；
  // 上限 135 留出余量（硬约束是 140，但贴边的句子打字体验差）
  if (en.length < 32 || en.length > 132) return false;
  // 归一化后必须全部是键盘能打出的 ASCII（与 src/lib/text.ts 的约定）
  if (!/^[\x20-\x7E]+$/.test(en)) return false;
  if (!/^["A-Z]/.test(en)) return false;
  if (!/["'!?.]$/.test(en)) return false;
  if (/\d/.test(en)) return false;
  if (/[€$£¥@#%&*_/\\[\]{}<>|~^+=]/.test(en)) return false;
  // 中文：有汉字、长度合理、繁体残留已清
  if (!/[\u4e00-\u9fff]/.test(row.zh)) return false;
  if (row.zh.length < 8 || row.zh.length > 160) return false;
  if (/[著妳牠祇徵麼麽]/.test(row.zh)) return false;
  if (/[、﹐﹑・]/.test(row.zh)) return false;
  if (BLOCKLIST.test(en)) return false;
  if (SENSITIVE.test(en)) return false;
  if (PROPER.test(en)) return false;
  if (PLACES.test(en)) return false;
  // 只收陈述/疑问这一档的干净句子：全大写、感叹号堆叠、URL、括号注释都不要
  if (/[!?]{2,}/.test(en)) return false;
  if (/\bhttp|www\.|\.com\b/i.test(en)) return false;
  if (/\(|\)/.test(en)) return false;
  // 中文里夹的书面语标点用简体中文的规范写法
  if (/[，。！？；：、“”‘’（）]/.test(row.zh) === false && row.zh.length > 20) return false;
  // 中英长度比：离谱的多半是错配
  const hanzi = [...row.zh].filter((c) => /[\u4e00-\u9fff]/.test(c)).length;
  const words = en.split(/\s+/).length;
  const ratio = hanzi / words;
  if (ratio < 0.5 || ratio > 2.4) return false;
  return true;
}

/* ────────────────────────────── 难度分级 ────────────────────────────── */

/**
 * 用 ECDICT 的考试标签给文章定级。
 *
 * 思路：一篇文章里"超出 CET-4 的词"越多，级别越高。
 *   - gk（高考）/ cet4 以内  → 不难
 *   - cet6 / ky / ielts / toefl / gre → 逐级加权
 * 最后按加权占比落到 "CET-4" | "CET-6" | "考研" | "雅思" 四档。
 */
const LEVEL_WEIGHT = { gk: 0, cet4: 0, cet6: 1, ky: 1.3, toefl: 1.6, ielts: 1.6, gre: 2, zk: -0.5 };

async function loadLexicon(words) {
  const file = path.join(CACHE, 'ecdict.csv');
  const lex = new Map();
  if (!existsSync(file)) return lex;
  const wanted = new Set();
  for (const w of words) for (const t of w.toLowerCase().split(/[^a-z']+/)) if (t) wanted.add(t);

  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const word = line.slice(0, comma).toLowerCase();
    if (!wanted.has(word)) continue;
    // word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq
    const fields = [];
    let cur = '';
    let quoted = false;
    for (let i = comma + 1; i < line.length && fields.length < 9; i++) {
      const ch = line[i];
      if (ch === '"') {
        quoted = !quoted;
        continue;
      }
      if (ch === ',' && !quoted) {
        fields.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    fields.push(cur);
    lex.set(word, { tag: (fields[6] ?? '').trim(), bnc: Number(fields[7]) || 0 });
  }
  return lex;
}

/**
 * 一篇文章的难度分（未归一）。两部分：
 *   1. 词汇 — ECDICT 考试标签（gk/cet4 基准，cet6→1，考研→1.3，托福/雅思→1.6，GRE→2）
 *   2. 句法 — 平均句长 + 从句引导词密度。长句和从句比生词更影响阅读门槛。
 */
function rawDifficulty(article, lex) {
  let total = 0;
  let weighted = 0;
  for (const s of article.sentences) {
    for (const raw of s.en.toLowerCase().split(/[^a-z']+/)) {
      if (raw.length < 4 || STOP.has(raw)) continue;
      const entry = lex.get(raw);
      total++;
      if (!entry) continue;
      let w = 0;
      for (const tag of entry.tag.split(/\s+/).filter(Boolean)) {
        w = Math.max(w, LEVEL_WEIGHT[tag] ?? 0);
      }
      weighted += w;
    }
  }
  const vocab = total ? weighted / total : 0;

  const avgLen =
    article.sentences.reduce((n, s) => n + normalize(s.en).length, 0) / article.sentences.length;
  // 22 词 ≈ 100 字符，>40 字符算偏长
  const lenScore = Math.max(0, Math.min(1, (avgLen - 40) / 60));

  const CLAUSE =
    /\b(because|although|though|while|whereas|unless|whether|which|whom|whose|that|since|until|before|after|if|when|where|as|so that|in order to|despite|instead of|rather than|however|therefore|moreover|nevertheless)\b/gi;
  const clauses =
    article.sentences.reduce((n, s) => n + (normalize(s.en).match(CLAUSE)?.length ?? 0), 0) /
    article.sentences.length;
  const clauseScore = Math.max(0, Math.min(1, clauses / 2));

  return vocab * 0.62 + lenScore * 0.26 + clauseScore * 0.12;
}

/**
 * 定级：把全部文章的难度分排序后按分位切四档。
 *
 * 之所以用分位而不是绝对值：ECDICT 的考试标签覆盖面有限（口语常见词也常带
 * cet6/雅思 标签），绝对阈值会把绝大部分文章都推到"考研"。分位切开能保证
 * 四个 level 都有内容可选，且同 level 内部的相对难度是真实的。
 */
function assignLevels(articles, lex) {
  const scored = articles.map((a) => ({ a, score: rawDifficulty(a, lex) }));
  const sorted = [...scored].sort((x, y) => x.score - y.score);
  const n = sorted.length;
  const cut = (p) => sorted[Math.min(n - 1, Math.floor(n * p))].score;
  const c1 = cut(0.28);
  const c2 = cut(0.58);
  const c3 = cut(0.82);

  for (const { a, score } of scored) {
    a.level = score <= c1 ? 'CET-4' : score <= c2 ? 'CET-6' : score <= c3 ? '考研' : '雅思';
  }
  return { scored, thresholds: [c1, c2, c3] };
}

/* ────────────────────────────── 主题定义 ────────────────────────────── */

/**
 * 每个主题 = 一个微型读物：关键词把候选句圈出来，再按词面连贯性挑 + 排序。
 *
 * `match` 是圈定候选句的正则（只作用于英文原文，单词边界）；
 * `anchor` 是这个主题的"核心词"，用来给候选句打分（越贴题分越高）。
 * `want` 是期望句数，实际可能少（候选不够时不硬凑，宁可少一篇）。
 */
const THEMES = [
  {
    id: 'reading-habit',
    title: 'The Habit of Reading',
    titleZh: '读书这件事',
    want: 10,
    match: /\b(book|books|read|reading|reader|novel|library|librarian|page|pages)\b/i,
    anchor: ['book', 'read', 'reading', 'library', 'novel', 'page'],
  },
  {
    id: 'learning-language',
    title: 'Learning Another Language',
    titleZh: '学一门外语',
    want: 10,
    match:
      /\b(language|languages|English|word|words|grammar|translate|translation|dictionary|sentence|sentences|pronounce|pronunciation|accent|fluent)\b/i,
    anchor: ['language', 'English', 'word', 'grammar', 'translate', 'dictionary', 'sentence'],
  },
  {
    id: 'school-days',
    title: 'School Days',
    titleZh: '学生时代',
    want: 11,
    match:
      /\b(school|class|classroom|teacher|student|students|pupil|lesson|homework|exam|test|grade|principal|semester|university|college)\b/i,
    anchor: ['school', 'teacher', 'student', 'class', 'homework', 'exam', 'lesson'],
  },
  {
    id: 'study-methods',
    title: 'How We Study',
    titleZh: '怎么学才有效',
    want: 10,
    match:
      /\b(study|studies|studying|learn|learning|memorize|remember|forget|practice|review|notes|understand|knowledge|skill|skills|mistake|mistakes)\b/i,
    anchor: ['study', 'learn', 'learning', 'practice', 'remember', 'forget', 'understand'],
  },
  {
    id: 'morning-routine',
    title: 'Early in the Morning',
    titleZh: '清早',
    want: 10,
    match:
      /\b(morning|breakfast|wake|woke|awake|alarm|coffee|tea|shower|early|sunrise|bed|sleep|asleep|tired|awake)\b/i,
    anchor: ['morning', 'breakfast', 'wake', 'coffee', 'early', 'sleep', 'bed'],
  },
  {
    id: 'city-life',
    title: 'Living in a Big City',
    titleZh: '住在大城市',
    want: 10,
    match:
      /\b(city|cities|town|street|streets|traffic|subway|bus|crowd|crowded|noise|noisy|apartment|building|neighbor|neighbours|neighbors|downtown|village)\b/i,
    anchor: ['city', 'street', 'traffic', 'noise', 'apartment', 'building', 'neighbor'],
  },
  {
    id: 'getting-around',
    title: 'Getting Around',
    titleZh: '在路上',
    want: 10,
    match:
      /\b(train|trains|bus|buses|station|platform|ticket|airport|plane|flight|drive|driving|car|cars|bicycle|bike|walk|walking|road|journey|trip)\b/i,
    anchor: ['train', 'bus', 'station', 'ticket', 'drive', 'walk', 'car'],
  },
  {
    id: 'travel-abroad',
    title: 'Traveling Abroad',
    titleZh: '出国旅行',
    want: 10,
    match:
      /\b(travel|traveling|travelling|trip|journey|vacation|holiday|tourist|hotel|passport|luggage|suitcase|abroad|foreign|country|countries|visit|visited)\b/i,
    anchor: ['travel', 'trip', 'holiday', 'hotel', 'foreign', 'country', 'visit'],
  },
  {
    id: 'at-the-table',
    title: 'At the Table',
    titleZh: '餐桌旁',
    want: 10,
    match:
      /\b(food|eat|eating|ate|cook|cooking|cooked|meal|dinner|lunch|breakfast|restaurant|kitchen|menu|dish|delicious|hungry|thirsty|taste)\b/i,
    anchor: ['food', 'eat', 'cook', 'meal', 'dinner', 'restaurant', 'kitchen'],
  },
  {
    id: 'healthy-habits',
    title: 'Staying Healthy',
    titleZh: '把身体养好',
    want: 10,
    match:
      /\b(health|healthy|doctor|doctors|hospital|medicine|ill|sick|illness|disease|exercise|exercising|sleep|rest|tired|body|weight|diet|pain|headache|cold|fever)\b/i,
    anchor: ['health', 'doctor', 'hospital', 'exercise', 'sleep', 'sick', 'medicine'],
  },
  {
    id: 'sport-and-play',
    title: 'Sport and Play',
    titleZh: '运动与游戏',
    want: 10,
    match:
      /\b(sport|sports|team|teams|game|games|play|playing|player|match|score|win|won|lose|lost|football|soccer|basketball|baseball|tennis|swim|swimming|run|running|race|coach)\b/i,
    anchor: ['sport', 'team', 'game', 'play', 'match', 'win', 'football'],
  },
  {
    id: 'work-and-office',
    title: 'Life at Work',
    titleZh: '工作这回事',
    want: 11,
    match:
      /\b(work|working|job|jobs|office|boss|manager|employee|company|meeting|colleague|colleagues|career|salary|interview|hire|fired|project|deadline|business)\b/i,
    anchor: ['work', 'job', 'office', 'boss', 'company', 'meeting', 'career'],
  },
  {
    id: 'money-matters',
    title: 'Money Matters',
    titleZh: '钱的事',
    want: 10,
    match:
      /\b(money|pay|paid|price|prices|cost|costs|buy|bought|sell|sold|cheap|expensive|bank|save|saving|savings|borrow|lend|debt|rich|poor|afford|budget)\b/i,
    anchor: ['money', 'pay', 'price', 'buy', 'sell', 'expensive', 'bank', 'save'],
  },
  {
    id: 'computers-everyday',
    title: 'Computers in Daily Life',
    titleZh: '电脑与日常',
    want: 10,
    match:
      /\b(computer|computers|internet|website|email|e-mail|online|software|program|programmer|keyboard|screen|file|files|data|password|download|digital|technology|machine|machines)\b/i,
    anchor: ['computer', 'internet', 'email', 'software', 'program', 'screen', 'technology'],
  },
  {
    id: 'phone-calls',
    title: 'On the Phone',
    titleZh: '打个电话',
    want: 9,
    match:
      /\b(phone|telephone|call|called|calling|ring|rang|message|text|mobile|number|voicemail|answer|answered|hang|hung)\b/i,
    anchor: ['phone', 'call', 'message', 'answer', 'number'],
  },
  {
    id: 'letters-and-words',
    title: 'Letters and Messages',
    titleZh: '信与留言',
    want: 9,
    match:
      /\b(letter|letters|write|wrote|written|writing|envelope|stamp|mail|postcard|note|notes|diary|journal|signature|address)\b/i,
    anchor: ['letter', 'write', 'mail', 'note', 'diary', 'stamp'],
  },
  {
    id: 'music-in-the-house',
    title: 'Music in the House',
    titleZh: '屋里的音乐',
    want: 9,
    match:
      /\b(music|musician|song|songs|sing|singing|sang|piano|guitar|violin|drum|concert|band|melody|tune|listen|listening)\b/i,
    anchor: ['music', 'song', 'sing', 'piano', 'guitar', 'concert', 'listen'],
  },
  {
    id: 'film-and-story',
    title: 'Film and Story',
    titleZh: '电影与故事',
    want: 9,
    match:
      /\b(movie|movies|film|films|cinema|theater|theatre|actor|actress|director|scene|story|stories|plot|character|ending|screen)\b/i,
    anchor: ['movie', 'film', 'cinema', 'story', 'actor', 'scene'],
  },
  {
    id: 'art-and-beauty',
    title: 'Looking at Art',
    titleZh: '看画',
    want: 9,
    match:
      /\b(art|artist|painting|paint|painted|picture|pictures|draw|drawing|drew|museum|gallery|sculpture|color|colors|beautiful|beauty|design)\b/i,
    anchor: ['art', 'artist', 'painting', 'picture', 'draw', 'museum', 'beautiful'],
  },
  {
    id: 'family-ties',
    title: 'Family Ties',
    titleZh: '家里人',
    want: 11,
    match:
      /\b(family|families|mother|father|parent|parents|son|daughter|brother|sister|grandmother|grandfather|grandparents|aunt|uncle|cousin|child|children|baby|husband|wife)\b/i,
    anchor: ['family', 'mother', 'father', 'parent', 'child', 'brother', 'sister'],
  },
  {
    id: 'friendship',
    title: 'What Friends Are For',
    titleZh: '朋友',
    want: 10,
    match:
      /\b(friend|friends|friendship|neighbor|neighbour|company|together|invite|invited|visit|visited|trust|kind|kindness|help|helped|share|shared)\b/i,
    anchor: ['friend', 'friendship', 'together', 'invite', 'help', 'kind', 'trust'],
  },
  {
    id: 'growing-up',
    title: 'Growing Up',
    titleZh: '长大',
    want: 10,
    match:
      /\b(child|children|boy|boys|girl|girls|young|youth|kid|kids|grow|grew|grown|age|ages|adult|teenager|playground|toy|toys|game|games)\b/i,
    anchor: ['child', 'children', 'boy', 'girl', 'young', 'grow', 'age'],
  },
  {
    id: 'getting-older',
    title: 'Getting Older',
    titleZh: '年纪渐长',
    want: 9,
    match:
      /\b(old|older|oldest|elderly|age|aged|years|memory|memories|remember|forget|grandfather|grandmother|retire|retired|gray|grey|youth|past)\b/i,
    anchor: ['old', 'age', 'memory', 'remember', 'forget', 'years'],
  },
  {
    id: 'weather-talk',
    title: 'Talking About Weather',
    titleZh: '聊天气',
    want: 10,
    match:
      /\b(weather|rain|raining|rained|rainy|snow|snowing|wind|windy|cloud|cloudy|sunny|sun|storm|fog|hot|cold|warm|cool|temperature|umbrella|forecast)\b/i,
    anchor: ['weather', 'rain', 'snow', 'wind', 'sunny', 'cold', 'hot', 'umbrella'],
  },
  {
    id: 'seasons',
    title: 'The Four Seasons',
    titleZh: '四季',
    want: 9,
    match:
      /\b(spring|summer|autumn|fall|winter|season|seasons|month|months|year|years|leaves|tree|trees|flower|flowers|bloom|harvest)\b/i,
    anchor: ['spring', 'summer', 'autumn', 'winter', 'season', 'leaves', 'flower'],
  },
  {
    id: 'garden-and-plants',
    title: 'A Small Garden',
    titleZh: '小花园',
    want: 9,
    match:
      /\b(garden|gardener|plant|plants|planted|flower|flowers|tree|trees|grass|leaf|leaves|seed|seeds|grow|grew|water|soil|green)\b/i,
    anchor: ['garden', 'plant', 'flower', 'tree', 'grass', 'seed', 'green'],
  },
  {
    id: 'animals-at-home',
    title: 'Animals at Home',
    titleZh: '家里的动物',
    want: 10,
    match:
      /\b(dog|dogs|cat|cats|bird|birds|horse|horses|fish|rabbit|mouse|pet|pets|animal|animals|feed|fed|tail|fur|bark|kitten|puppy)\b/i,
    anchor: ['dog', 'cat', 'bird', 'horse', 'pet', 'animal', 'feed'],
  },
  {
    id: 'the-sea',
    title: 'By the Sea',
    titleZh: '海边',
    want: 10,
    match:
      /\b(sea|ocean|beach|shore|wave|waves|sand|island|boat|ship|sail|sailing|sailor|fish|fishing|coast|bay|harbor|harbour|lake|river)\b/i,
    anchor: ['sea', 'ocean', 'beach', 'wave', 'sand', 'island', 'boat', 'river'],
  },
  {
    id: 'mountains-and-walks',
    title: 'Up the Mountain',
    titleZh: '上山',
    want: 9,
    match:
      /\b(mountain|mountains|hill|hills|climb|climbed|climbing|valley|forest|woods|trail|path|hike|hiking|camp|camping|tent|view|summit)\b/i,
    anchor: ['mountain', 'hill', 'climb', 'forest', 'path', 'camp', 'view'],
  },
  {
    id: 'night-and-sky',
    title: 'The Night Sky',
    titleZh: '夜空',
    want: 9,
    match:
      /\b(night|nights|evening|star|stars|moon|sky|dark|darkness|midnight|sleep|dream|dreams|lamp|light|lights|shadow)\b/i,
    anchor: ['night', 'star', 'moon', 'sky', 'dark', 'dream', 'light'],
  },
  {
    id: 'time-and-clocks',
    title: 'What Time Is It?',
    titleZh: '时间',
    want: 10,
    match:
      /\b(time|times|hour|hours|minute|minutes|clock|watch|early|late|soon|already|yet|wait|waited|waiting|hurry|quick|slow|quickly|slowly)\b/i,
    anchor: ['time', 'hour', 'minute', 'clock', 'wait', 'late', 'early'],
  },
  {
    id: 'plans-and-future',
    title: 'Making Plans',
    titleZh: '做计划',
    want: 10,
    match:
      /\b(plan|plans|planning|future|tomorrow|next|decide|decided|decision|choose|chose|choice|hope|hoping|want|wanted|going to|intend|promise|promised)\b/i,
    anchor: ['plan', 'future', 'tomorrow', 'decide', 'hope', 'promise', 'choose'],
  },
  {
    id: 'memory-and-past',
    title: 'Looking Back',
    titleZh: '回头看',
    want: 10,
    match:
      /\b(remember|remembered|memory|memories|forget|forgot|forgotten|past|yesterday|ago|used to|once|childhood|history|old|then)\b/i,
    anchor: ['remember', 'memory', 'forget', 'past', 'yesterday', 'history'],
  },
  {
    id: 'fear-and-courage',
    title: 'Being Afraid',
    titleZh: '害怕的时候',
    want: 9,
    match:
      /\b(afraid|fear|scared|frightened|terrible|terrified|nervous|worry|worried|worrying|brave|courage|courageous|danger|dangerous|safe|safety|risk)\b/i,
    anchor: ['afraid', 'fear', 'scared', 'nervous', 'worry', 'brave', 'danger'],
  },
  {
    id: 'happiness',
    title: 'What Makes Us Happy',
    titleZh: '什么让人快乐',
    want: 10,
    match:
      /\b(happy|happiness|glad|joy|pleased|smile|smiled|smiling|laugh|laughed|fun|enjoy|enjoyed|wonderful|great|nice|delighted|cheerful)\b/i,
    anchor: ['happy', 'glad', 'smile', 'laugh', 'enjoy', 'wonderful', 'joy'],
  },
  {
    id: 'anger-and-patience',
    title: 'Losing Patience',
    titleZh: '耐心',
    want: 9,
    match:
      /\b(angry|anger|mad|annoyed|annoying|upset|patience|patient|impatient|calm|quiet|argue|argued|argument|fight|fought|shout|shouted|yell|complain)\b/i,
    anchor: ['angry', 'annoyed', 'patience', 'calm', 'argue', 'quiet', 'complain'],
  },
  {
    id: 'health-care',
    title: 'Seeing the Doctor',
    titleZh: '看医生',
    want: 9,
    match:
      /\b(doctor|doctors|nurse|hospital|clinic|patient|medicine|prescription|appointment|symptom|fever|cough|headache|stomach|pain|hurt|hurts|injured|injury|surgery)\b/i,
    anchor: ['doctor', 'nurse', 'hospital', 'medicine', 'pain', 'patient', 'appointment'],
  },
  {
    id: 'clothes-and-style',
    title: 'What We Wear',
    titleZh: '穿什么',
    want: 9,
    match:
      /\b(clothes|clothing|shirt|shirts|dress|dresses|coat|jacket|shoe|shoes|hat|pants|trousers|skirt|sweater|wear|wearing|wore|fashion|style|color|colors)\b/i,
    anchor: ['clothes', 'shirt', 'dress', 'coat', 'shoe', 'wear', 'hat'],
  },
  {
    id: 'the-house',
    title: 'Inside the House',
    titleZh: '屋子里面',
    want: 10,
    match:
      /\b(house|home|room|rooms|kitchen|bedroom|bathroom|door|window|windows|wall|walls|floor|roof|stairs|furniture|table|chair|bed|garden)\b/i,
    anchor: ['house', 'home', 'room', 'kitchen', 'door', 'window', 'table'],
  },
  {
    id: 'moving-house',
    title: 'Moving House',
    titleZh: '搬家',
    want: 8,
    match:
      /\b(move|moved|moving|move out|apartment|rent|landlord|neighbor|neighbour|pack|packed|boxes|furniture|address|lease|settle|new home)\b/i,
    anchor: ['move', 'apartment', 'rent', 'neighbor', 'pack', 'furniture'],
  },
  {
    id: 'shopping',
    title: 'Out Shopping',
    titleZh: '去买东西',
    want: 10,
    match:
      /\b(shop|shops|shopping|store|stores|market|buy|bought|sell|sold|price|prices|cheap|expensive|discount|sale|bill|change|cash|card|queue)\b/i,
    anchor: ['shop', 'store', 'market', 'buy', 'price', 'cheap', 'bill'],
  },
  {
    id: 'cooking',
    title: 'In the Kitchen',
    titleZh: '下厨',
    want: 9,
    match:
      /\b(cook|cooking|cooked|chef|recipe|ingredient|ingredients|boil|fry|bake|baked|oven|pan|pot|knife|chop|stir|salt|sugar|butter|flour|soup)\b/i,
    anchor: ['cook', 'recipe', 'oven', 'salt', 'sugar', 'soup', 'knife'],
  },
  {
    id: 'sleep-and-dreams',
    title: 'Sleep and Dreams',
    titleZh: '睡觉与做梦',
    want: 9,
    match:
      /\b(sleep|sleeping|slept|asleep|awake|bed|dream|dreams|dreamed|dreamt|nightmare|yawn|pillow|blanket|wake|woke|nap|rest)\b/i,
    anchor: ['sleep', 'bed', 'dream', 'asleep', 'wake', 'pillow'],
  },
  {
    id: 'the-internet-age',
    title: 'Living Online',
    titleZh: '在线的日子',
    want: 9,
    match:
      /\b(internet|online|website|web|google|search|email|social|account|password|download|upload|click|link|browser|network|wifi|digital|screen|phone)\b/i,
    anchor: ['internet', 'online', 'website', 'search', 'email', 'screen', 'account'],
  },
  {
    id: 'science-and-discovery',
    title: 'Science and Discovery',
    titleZh: '科学与发现',
    want: 9,
    match:
      /\b(science|scientist|scientists|research|experiment|discover|discovered|discovery|theory|evidence|data|result|results|physics|chemistry|biology|mathematics|math|universe|molecule|atom)\b/i,
    anchor: ['science', 'scientist', 'research', 'experiment', 'discover', 'theory'],
  },
  {
    id: 'space',
    title: 'Out in Space',
    titleZh: '太空',
    want: 8,
    match:
      /\b(space|universe|planet|planets|star|stars|moon|sun|earth|mars|rocket|astronaut|satellite|galaxy|telescope|orbit|gravity)\b/i,
    anchor: ['space', 'universe', 'planet', 'star', 'moon', 'earth', 'rocket'],
  },
  {
    id: 'law-and-rules',
    title: 'Rules and the Law',
    titleZh: '规矩与法律',
    want: 9,
    match:
      /\b(law|laws|legal|illegal|rule|rules|court|judge|lawyer|police|crime|criminal|punish|punishment|fine|permit|license|allowed|forbidden)\b/i,
    anchor: ['law', 'rule', 'court', 'police', 'legal', 'allowed', 'forbidden'],
  },
  {
    id: 'news-and-paper',
    title: 'Reading the News',
    titleZh: '看新闻',
    want: 9,
    match:
      /\b(news|newspaper|report|reporter|journalist|article|headline|magazine|television|radio|press|media|interview|broadcast|story)\b/i,
    anchor: ['news', 'newspaper', 'report', 'journalist', 'magazine', 'media'],
  },
  {
    id: 'polite-words',
    title: 'Please and Thank You',
    titleZh: '客气话',
    want: 10,
    match:
      /\b(please|thank|thanks|sorry|excuse|pardon|kind|kindness|polite|apologize|apology|welcome|invite|invitation|favor|favour|help|helped|forgive)\b/i,
    anchor: ['please', 'thank', 'sorry', 'excuse', 'kind', 'help', 'polite'],
  },
  {
    id: 'asking-questions',
    title: 'Asking the Right Question',
    titleZh: '问对问题',
    want: 10,
    match:
      /\b(question|questions|ask|asked|answer|answered|explain|explained|wonder|curious|doubt|understand|understood|mean|meaning|reason|why|how)\b/i,
    anchor: ['question', 'ask', 'answer', 'explain', 'understand', 'mean', 'reason'],
  },
  {
    id: 'problems-and-solutions',
    title: 'When Something Goes Wrong',
    titleZh: '出了问题',
    want: 10,
    match:
      /\b(problem|problems|trouble|issue|difficult|difficulty|hard|solve|solved|solution|fix|fixed|broken|break|repair|wrong|mistake|fail|failed)\b/i,
    anchor: ['problem', 'trouble', 'difficult', 'solve', 'fix', 'broken', 'mistake'],
  },
  {
    id: 'choices',
    title: 'Making a Choice',
    titleZh: '做选择',
    want: 9,
    match:
      /\b(choose|chose|chosen|choice|choices|decide|decided|decision|option|instead|rather|prefer|preferred|either|neither|whether|doubt)\b/i,
    anchor: ['choose', 'choice', 'decide', 'decision', 'prefer', 'instead', 'option'],
  },
  {
    id: 'waiting',
    title: 'Waiting',
    titleZh: '等待',
    want: 9,
    match:
      /\b(wait|waited|waiting|still|yet|soon|already|until|before|after|meanwhile|patience|late|delay|delayed|queue|line)\b/i,
    anchor: ['wait', 'waiting', 'until', 'late', 'soon', 'already', 'delay'],
  },
  {
    id: 'small-talk',
    title: 'Small Talk',
    titleZh: '闲聊',
    want: 10,
    match:
      /\b(hello|hi|good morning|good evening|nice|fine|how are you|really|sure|maybe|perhaps|well|anyway|actually|guess|suppose|think)\b/i,
    anchor: ['think', 'guess', 'suppose', 'maybe', 'really', 'sure', 'fine'],
  },
];

/* ────────────────────────────── 选句与排句 ────────────────────────────── */

/** 主题候选句打分：贴题程度（anchor 命中）+ 长度适中性 */
function themeScore(row, anchor) {
  const words = contentWords(row.en);
  const lower = normalize(row.en).toLowerCase();
  let hits = 0;
  for (const a of anchor) {
    if (words.has(a.toLowerCase()) || new RegExp(`\\b${a}`, 'i').test(lower)) hits++;
  }
  const len = normalize(row.en).length;
  // 60–110 字符最舒服：太短信息量不足，太长打字累
  const lenScore = len >= 60 && len <= 110 ? 2 : len >= 45 && len <= 125 ? 1 : 0;
  return hits * 5 + lenScore;
}

/**
 * 从候选池里挑出「一篇」句子集合。
 *
 * 贪心：先取最贴题的一句，之后每步选
 *   (与已选内容的词汇重合度 × 3) + 贴题分 - 重复惩罚
 * 最高的一句。重合度让整篇围绕同一批词反复出现，读起来像一个话题而不是随机拼盘。
 */
function pickSentences(candidates, anchor, want, usedIds, globalChosen = []) {
  const pool = candidates
    .filter((r) => !usedIds.has(r.id))
    .map((r) => ({ ...r, cw: contentWords(r.en), score: themeScore(r, anchor) }))
    .sort((a, b) => b.score - a.score);

  if (!pool.length) return [];

  const chosen = [pool[0]];
  const remaining = pool.slice(1);

  while (chosen.length < want && remaining.length) {
    const picked = new Set();
    for (const s of chosen) for (const w of s.cw) picked.add(w);

    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      // 与已选句子太像就跳过（Tatoeba 里"只换一两个词"的改写句非常多）
      let tooSimilar = false;
      for (const s of chosen) {
        if (tooAlike(cand, s)) {
          tooSimilar = true;
          break;
        }
      }
      // 也别和其它文章里已经用过的句子撞车
      if (!tooSimilar) {
        for (const s of globalChosen) {
          if (tooAlike(cand, s)) {
            tooSimilar = true;
            break;
          }
        }
      }
      if (tooSimilar) continue;

      let overlap = 0;
      for (const w of cand.cw) if (picked.has(w)) overlap++;
      // 每多一个"新词"扣一点分，避免整篇词面过于发散
      let fresh = 0;
      for (const w of cand.cw) if (!picked.has(w)) fresh++;
      const score = overlap * 3 + cand.score * 0.6 - fresh * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    chosen.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }

  return chosen;
}

/**
 * 排句：把选出的句子串成"读起来有承接感"的顺序。
 *
 * 从与其它句子共享词汇最多的一句开始（最"中心"的那句），之后每步挑
 * 与上一句词面重合最多的一句。这不是真实写作的连贯，但比随机顺序好读得多。
 */
function orderSentences(sentences) {
  if (sentences.length < 3) return sentences;

  const centrality = sentences.map((s) =>
    sentences.reduce((acc, o) => (o === s ? acc : acc + jaccard(s.cw, o.cw)), 0),
  );
  let startIdx = 0;
  for (let i = 1; i < sentences.length; i++) {
    // 中心度高、且不是最长的那句做开头（开场句别太长）
    const a = centrality[i] - sentences[i].en.length / 400;
    const b = centrality[startIdx] - sentences[startIdx].en.length / 400;
    if (a > b) startIdx = i;
  }

  const ordered = [sentences[startIdx]];
  const rest = sentences.filter((_, i) => i !== startIdx);
  while (rest.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const link = jaccard(last.cw, rest[i].cw);
      // 轻微偏好稍短的句子靠后，读完有收束感
      const score = link - rest[i].en.length / 2000;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    ordered.push(rest[bestIdx]);
    rest.splice(bestIdx, 1);
  }
  return ordered;
}

/* ────────────────────────────── 组篇 ────────────────────────────── */

const SOURCE_NOTE =
  'Tatoeba 英中对照句选编（https://tatoeba.org）。英文原句与中文译文均来自 Tatoeba 社区贡献者，' +
  '本文件按主题重新编排并统一转为简体中文。许可：CC-BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/），' +
  '使用时须署名 “Tatoeba contributors”。';

function makeArticle(theme, sentences, level) {
  return {
    id: theme.id,
    title: theme.title,
    titleZh: theme.titleZh,
    level,
    author: 'Tatoeba contributors',
    sentences: sentences.map((s) => ({ en: s.en, zh: s.zh })),
    source: SOURCE_NOTE,
  };
}

async function main() {
  const dry = has('dry');
  const onlyTheme = getArg('theme', null);

  console.log('读取 Tatoeba 导出包…');
  const rows = await loadPairs();
  console.log(`  join 出 ${rows.length.toLocaleString()} 条英中对照句`);

  // 先去重（同一英文句可能被多人提交过多次翻译）
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    const key = normalize(r.en).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  console.log(`  去重后 ${deduped.length.toLocaleString()} 条`);

  const usable = deduped.filter(acceptable);
  console.log(`  过滤（长度/字符/内容/中英匹配）后 ${usable.length.toLocaleString()} 条可用`);

  if (onlyTheme) {
    const t = THEMES.find((x) => x.id === onlyTheme);
    if (!t) throw new Error(`没有这个主题：${onlyTheme}`);
    const cands = usable.filter((r) => t.match.test(r.en));
    console.log(`\n主题 ${t.id} 候选 ${cands.length} 句：\n`);
    for (const c of cands.slice(0, 40)) console.log('  ' + c.en + '\n    ' + c.zh);
    return;
  }

  const lex = await loadLexicon(usable.map((r) => r.en));
  console.log(`  词表 ${lex.size.toLocaleString()} 词（ECdict 考试标签，用于定级）`);

  const usedIds = new Set();
  const allChosen = [];
  const articles = [];
  const skipped = [];

  for (const theme of THEMES) {
    const cands = usable.filter((r) => theme.match.test(r.en));
    const picked = pickSentences(cands, theme.anchor, theme.want, usedIds, allChosen);
    if (picked.length < 6) {
      skipped.push({ id: theme.id, reason: `候选/去重后只剩 ${picked.length} 句（<6）` });
      continue;
    }
    for (const p of picked) usedIds.add(p.id);
    allChosen.push(...picked.map((p) => ({ ...p, cw: contentWords(p.en) })));
    const ordered = orderSentences(picked);
    const article = makeArticle(theme, ordered, 'CET-4');
    articles.push(article);
  }

  // 定级：Tatoeba 主题篇按分位分布统一评级
  const { scored, thresholds } = assignLevels(articles, lex);

  // 经典公版文章：手动维护在 data 里，构建时合并进同一个输出文件
  const classicsPath = path.join(WORK, 'classics.json');
  let classics = [];
  if (existsSync(classicsPath)) {
    classics = JSON.parse(await readFile(classicsPath, 'utf8'));
  }

  const all = [...classics, ...articles];
  const totalSentences = all.reduce((n, a) => n + a.sentences.length, 0);

  const byLevel = {};
  for (const a of all) byLevel[a.level] = (byLevel[a.level] ?? 0) + 1;

  if (dry) {
    for (const { a, score } of scored) {
      console.log(
        `\n===== ${a.id} (${a.level} / ${score.toFixed(3)}, ${a.sentences.length} 句) =====`,
      );
      for (const s of a.sentences) console.log('  ' + s.en + '\n    ' + s.zh);
    }
  }

  if (has('scores')) {
    console.log(
      '\n难度分分布（分位阈值 ' + thresholds.map((t) => t.toFixed(3)).join(' / ') + '）：',
    );
    for (const { a, score } of [...scored].sort((x, y) => x.score - y.score))
      console.log('  ' + a.id.padEnd(26) + score.toFixed(3) + '  ' + a.level);
  }

  console.log(`\n──── 汇总 ────`);
  console.log(
    `文章 ${all.length} 篇（公版经典 ${classics.length} + Tatoeba 主题 ${articles.length}）`,
  );
  console.log(`句子 ${totalSentences} 句`);
  console.log(`level 分布 ${JSON.stringify(byLevel)}`);
  if (skipped.length) {
    console.log(`跳过 ${skipped.length} 个主题：`);
    for (const s of skipped) console.log(`  - ${s.id}: ${s.reason}`);
  }

  // 自检：任何一篇违反硬约束就整体失败，不写出半成品
  const levels = new Set(['CET-4', 'CET-6', '考研', '雅思']);
  const problems = [];
  const ids = new Set();
  for (const a of all) {
    if (!a.id || !a.title || !a.titleZh) problems.push(`${a.id}: 缺字段`);
    if (ids.has(a.id)) problems.push(`${a.id}: id 重复`);
    ids.add(a.id);
    if (!levels.has(a.level)) problems.push(`${a.id}: 非法 level ${a.level}`);
    if (!a.source) problems.push(`${a.id}: 缺 source`);
    if (a.sentences.length < 4) problems.push(`${a.id}: 只有 ${a.sentences.length} 句（<4）`);
    for (const [i, s] of a.sentences.entries()) {
      if (!s.en.trim() || !s.zh.trim()) problems.push(`${a.id} 第 ${i + 1} 句有空字段`);
      if (s.en.length > 140) problems.push(`${a.id} 第 ${i + 1} 句 ${s.en.length} 字符（>140）`);
      if (!/^[\x20-\x7E]*$/.test(normalize(s.en)))
        problems.push(`${a.id} 第 ${i + 1} 句归一化后仍有非 ASCII：${JSON.stringify(s.en)}`);
    }
  }
  if (problems.length) {
    console.error(`\n自检失败（${problems.length} 条）：`);
    for (const p of problems) console.error('  ✗ ' + p);
    process.exitCode = 1;
    return;
  }
  console.log('自检通过：字段、长度、字符、id 唯一性均符合 src/lib/text.test.ts 的约定');

  if (dry) {
    console.log('\n--dry：不写文件');
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'index.json');
  await writeFile(outFile, JSON.stringify(all, null, 2) + '\n', 'utf8');
  console.log(
    `\n已写出 ${path.relative(ROOT, outFile)}（${all.length} 篇 / ${totalSentences} 句）`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * 从 Tatoeba 英中对照语料组装"微型读物"。
 *
 * ── 为什么这样做 ──────────────────────────────────────────────────────────
 * 现有文章只有 6 篇 49 句，用户反馈太少。找公版书自己翻译不现实
 * （几十篇高质量译文不可能凭空产出），而 Tatoeba 已经有 **66,286 条
 * 人工校对过的英中对照句**，许可 CC-BY 2.0 FR（可商用，需署名）。
 *
 * 做法：按主题关键词把句子聚类，每个主题挑 8–14 句组装成一篇。
 * 这样出来的"文章"是同一主题下的自然句子集合，不是原文连缀，
 * 因此 source 字段必须如实写明"Tatoeba 主题句集"，不能伪装成某篇名著。
 *
 * 产物：public/articles/<id>.json，每条含 Article 结构。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CACHE = path.join(ROOT, '.tmp', 'rich-cache');
const OUT_DIR = path.join(ROOT, 'public', 'articles');

/** 主题定义：关键词 + 标题 + 难度 */
const THEMES = [
  {
    id: 'tatoeba-tech',
    title: 'Technology and the Internet',
    titleZh: '科技与互联网',
    level: 'CET-4',
    keywords: [
      'computer',
      'internet',
      'software',
      'website',
      'online',
      'digital',
      'technology',
      'email',
      'program',
      'data',
      'phone',
      'app',
    ],
    minLen: 30,
    maxLen: 100,
  },
  {
    id: 'tatoeba-environment',
    title: 'Nature and the Environment',
    titleZh: '自然与环境',
    level: 'CET-4',
    keywords: [
      'environment',
      'pollution',
      'climate',
      'forest',
      'ocean',
      'animal',
      'wildlife',
      'recycle',
      'energy',
      'planet',
      'weather',
      'species',
    ],
    minLen: 30,
    maxLen: 100,
  },
  {
    id: 'tatoeba-education',
    title: 'Learning and School',
    titleZh: '学习与校园',
    level: 'CET-4',
    keywords: [
      'school',
      'student',
      'teacher',
      'study',
      'learn',
      'university',
      'exam',
      'class',
      'homework',
      'library',
      'knowledge',
      'education',
    ],
    minLen: 30,
    maxLen: 100,
  },
  {
    id: 'tatoeba-health',
    title: 'Health and Habits',
    titleZh: '健康与习惯',
    level: 'CET-4',
    keywords: [
      'health',
      'doctor',
      'exercise',
      'sleep',
      'diet',
      'medicine',
      'hospital',
      'fitness',
      'tired',
      'stress',
      'habit',
      'ill',
    ],
    minLen: 30,
    maxLen: 100,
  },
  {
    id: 'tatoeba-travel',
    title: 'Travel and Places',
    titleZh: '旅行与地方',
    level: 'CET-4',
    keywords: [
      'travel',
      'trip',
      'city',
      'country',
      'station',
      'airport',
      'hotel',
      'visit',
      'foreign',
      'journey',
      'tourist',
      'abroad',
    ],
    minLen: 30,
    maxLen: 100,
  },
  {
    id: 'tatoeba-work',
    title: 'Work and Career',
    titleZh: '工作与职业',
    level: 'CET-6',
    keywords: [
      'work',
      'job',
      'office',
      'company',
      'career',
      'business',
      'manager',
      'salary',
      'interview',
      'colleague',
      'project',
      'meeting',
    ],
    minLen: 32,
    maxLen: 105,
  },
  {
    id: 'tatoeba-culture',
    title: 'Language and Culture',
    titleZh: '语言与文化',
    level: 'CET-6',
    keywords: [
      'language',
      'culture',
      'tradition',
      'history',
      'music',
      'art',
      'literature',
      'custom',
      'festival',
      'translate',
      'foreign',
      'speak',
    ],
    minLen: 32,
    maxLen: 105,
  },
  {
    id: 'tatoeba-society',
    title: 'Society and People',
    titleZh: '社会与人',
    level: 'CET-6',
    keywords: [
      'people',
      'society',
      'government',
      'community',
      'freedom',
      'right',
      'law',
      'public',
      'citizen',
      'social',
      'family',
      'children',
    ],
    minLen: 32,
    maxLen: 105,
  },
  {
    id: 'tatoeba-science',
    title: 'Science and Discovery',
    titleZh: '科学与发现',
    level: '考研',
    keywords: [
      'science',
      'research',
      'experiment',
      'discover',
      'theory',
      'evidence',
      'scientist',
      'observe',
      'measure',
      'analysis',
      'result',
      'hypothesis',
    ],
    minLen: 34,
    maxLen: 110,
  },
  {
    id: 'tatoeba-mind',
    title: 'Mind and Emotion',
    titleZh: '心智与情感',
    level: '考研',
    keywords: [
      'feel',
      'think',
      'believe',
      'emotion',
      'memory',
      'attitude',
      'behavior',
      'confidence',
      'anxiety',
      'motivation',
      'perceive',
      'conscious',
    ],
    minLen: 34,
    maxLen: 110,
  },
  {
    id: 'tatoeba-economy',
    title: 'Economy and Money',
    titleZh: '经济与金钱',
    level: '雅思',
    keywords: [
      'money',
      'economy',
      'market',
      'price',
      'trade',
      'bank',
      'cost',
      'invest',
      'financial',
      'tax',
      'profit',
      'debt',
    ],
    minLen: 32,
    maxLen: 105,
  },
  {
    id: 'tatoeba-ideas',
    title: 'Ideas and Argument',
    titleZh: '观点与论证',
    level: '雅思',
    keywords: [
      'argument',
      'reason',
      'opinion',
      'agree',
      'disagree',
      'however',
      'therefore',
      'evidence',
      'claim',
      'conclusion',
      'debate',
      'perspective',
    ],
    minLen: 36,
    maxLen: 115,
  },
];

function log(...a) {
  process.stdout.write(a.join(' ') + '\n');
}

/** 读 TSV（不经过 bz2，假设已解压） */
function readTsv(file, onLine) {
  const text = readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    const i = line.indexOf('\t');
    if (i < 0) continue;
    const id = line.slice(0, i);
    const rest = line.slice(i + 1);
    const j = rest.indexOf('\t');
    const body = j >= 0 ? rest.slice(j + 1) : rest;
    onLine(id, body.trim());
  }
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const engFile = path.join(CACHE, 'eng_sentences.tsv');
  const cmnFile = path.join(CACHE, 'cmn_sentences.tsv');
  const linkFile = path.join(CACHE, 'eng-cmn_links.tsv');

  for (const f of [engFile, cmnFile, linkFile]) {
    if (!existsSync(f)) {
      log(`缺少 ${f}`);
      log('请先跑 node scripts/build-sentences.mjs 解压 Tatoeba 导出包');
      process.exit(1);
    }
  }

  log('■ 读取英中对照…');
  const links = new Map();
  readTsv(linkFile, (e, c) => {
    if (!e || !c) return;
    const arr = links.get(e);
    if (arr) arr.push(c);
    else links.set(e, [c]);
  });
  log(`  ${links.size.toLocaleString()} 组对照`);

  const needed = new Set();
  for (const ids of links.values()) for (const id of ids) needed.add(id);

  const cmn = new Map();
  readTsv(cmnFile, (id, text) => {
    if (needed.has(id)) cmn.set(id, text);
  });
  log(`  中文句 ${cmn.size.toLocaleString()} 条`);

  log('■ 扫描英文句子并按主题归类…');
  /** themeId -> [{en, zh}] */
  const buckets = new Map(THEMES.map((t) => [t.id, []]));

  readTsv(engFile, (id, text) => {
    if (!links.has(id)) return;
    const lower = text.toLowerCase();

    for (const theme of THEMES) {
      if (text.length < theme.minLen || text.length > theme.maxLen) continue;
      // 至少要命中一个关键词
      const hit = theme.keywords.some((k) => lower.includes(k));
      if (!hit) continue;

      // 只要疑问/陈述句，排除片段
      if (!/[.!?]$/.test(text)) continue;
      // 排除带大量数字/符号的句子（不适合当读物）
      if ((text.match(/[0-9]/g) || []).length > 3) continue;

      const arr = buckets.get(theme.id);
      if (arr.length >= 40) continue; // 每主题最多收集 40 条候选
      if (arr.some((x) => x.en === text)) continue;

      let zh = null;
      for (const cid of links.get(id)) {
        const t = cmn.get(cid);
        if (t) {
          zh = t;
          break;
        }
      }
      if (!zh) continue;
      arr.push({ en: text, zh });
    }
  });

  // ── 组装文章 ──────────────────────────────────────────────
  log('■ 组装文章…');
  let made = 0;
  const summary = [];

  for (const theme of THEMES) {
    const pool = buckets.get(theme.id) || [];
    if (pool.length < 6) {
      log(`  ${theme.id}: 候选不足（${pool.length}），跳过`);
      continue;
    }

    // 取前 8–14 条，保留原顺序（Tatoeba 返回顺序即句子 id 序，天然有一定连续感）
    const take = Math.min(14, Math.max(8, Math.floor(pool.length * 0.4)));
    const picked = pool.slice(0, take);

    const article = {
      id: theme.id,
      title: theme.title,
      titleZh: theme.titleZh,
      level: theme.level,
      author: 'Tatoeba contributors',
      sentences: picked,
      source:
        'Tatoeba 主题句集（CC-BY 2.0 FR，https://tatoeba.org）。' +
        '按主题关键词从人工校对的英中对照句中筛选，非原文连缀。',
    };

    writeFileSync(path.join(OUT_DIR, `${theme.id}.json`), JSON.stringify(article, null, 2));
    made++;
    summary.push({ id: theme.id, sentences: picked.length, pool: pool.length, level: theme.level });
    log(`  ${theme.id.padEnd(24)} ${picked.length} 句（候选 ${pool.length}）`);
  }

  writeFileSync(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: made,
        articles: summary,
        license: 'Tatoeba CC-BY 2.0 FR',
      },
      null,
      2,
    ),
  );

  log('');
  log(`■ 完成：${made} 篇，共 ${summary.reduce((s, x) => s + x.sentences, 0)} 句`);
  log('  署名要求：Tatoeba CC-BY 2.0 FR');
}

main();

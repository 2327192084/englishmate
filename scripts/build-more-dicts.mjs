#!/usr/bin/env node
/**
 * EnglishMate · 扩展词库构建脚本
 * ------------------------------------------------------------------
 * 作用：在 scripts/build-dicts.mjs 产出的 8 个词库之外，再补 8 个
 *       「考试 / 专业 / 阶段」词库，把总数从 8 个扩到 16 个。
 *
 * 数据源：Qwerty Learner（MIT）public/dicts/ 下的分册词表，
 *        经 api.github.com 的 blob 接口取 base64 内容解码。
 *
 * 省配额的做法：
 *   - .tmp/dicts.json 是 public/dicts 的目录快照（380 个文件的 name + sha），
 *     直接读它，不再调目录 API。
 *   - .tmp/blobs/<sha>.json 是已下载的原始 blob 响应，命中就不联网。
 *   - 只有真正缺的 blob 才发一次请求；结果落盘后重跑完全离线。
 *
 * 与 build-dicts.mjs 的关系：
 *   - 不改 build-dicts.mjs，也不改它产出的 8 个词库内容。
 *   - index.json 两者共用：本脚本会把「磁盘上实际存在的全部词库」按固定
 *     顺序重新汇总成 index.json，所以存在先后跑或重跑都幂等。
 *
 * 用法：
 *   node scripts/build-more-dicts.mjs            # 正常构建（缺缓存才联网）
 *   node scripts/build-more-dicts.mjs --offline  # 只用本地缓存，绝不联网
 *   node scripts/build-more-dicts.mjs --dry      # 只体检，不写盘
 *   node scripts/build-more-dicts.mjs --verify   # 全量契约校验（读 index.json，不构建）
 *   node scripts/build-more-dicts.mjs --only=tem4,sat
 *
 * 关于 --verify：
 *   scripts/verify-data.mjs 里的 BANK_IDS 是硬编码的 8 个，词库扩到 16 个后
 *   它会因为数量不符而失败。--verify 做的是等价的契约检查，但词库清单从
 *   index.json 动态读取，所以词库增减都不需要改脚本。
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
const API = 'https://api.github.com';

/** 词条下限：低于这个数算建库失败 */
const MIN_WORDS = 100;
/** 单词长度上限 */
const MAX_WORD_LEN = 64;
/** 释义长度上限（超出截断到分号处） */
const MAX_GLOSS_LEN = 90;
/** 单文件体积告警线（字节） */
const WARN_BYTES = 2 * 1024 * 1024;

const argv = new Set(process.argv.slice(2));
const OFFLINE = argv.has('--offline');
const DRY = argv.has('--dry');
const VERIFY = argv.has('--verify');
const REFRESH = argv.has('--refresh');
const ONLY = (() => {
  const hit = [...argv].find((a) => a.startsWith('--only='));
  if (!hit) return null;
  const ids = hit
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
})();

/* ------------------------------ 词库定义 ------------------------------ */

/**
 * 每个词库：
 *   files  —— Qwerty Learner 的分册文件名（按顺序拼接，先到先得去重）
 *   limit  —— 可选，截断到前 N 条（用于体积控制）
 *   drop   —— 可选，明确不要的词条（源数据里的错词/拉丁学名/品牌名等）
 */
const BANKS = [
  {
    id: 'primary',
    name: '小学 · 人教版分册',
    category: 'basic',
    description: '人教版小学英语 3–6 年级全部 8 册词汇，零基础起步的第一套词表。',
    files: [
      'PEPXiaoXue3_1_T.json',
      'PEPXiaoXue3_2_T.json',
      'PEPXiaoXue4_1_T.json',
      'PEPXiaoXue4_2_T.json',
      'PEPXiaoXue5_1_T.json',
      'PEPXiaoXue5_2_T.json',
      'PEPXiaoXue6_1_T.json',
      'PEPXiaoXue6_2_T.json',
    ],
  },
  {
    id: 'junior',
    name: '初中 · 人教版分册',
    category: 'basic',
    description: '人教版初中英语 7–9 年级词汇，承接小学、衔接高中，中考备考的基础盘。',
    files: [
      'PEPChuZhong7_1_T.json',
      'PEPChuZhong7_2_T.json',
      'PEPChuZhong8_1_T.json',
      'PEPChuZhong8_2_T.json',
      'PEPChuZhong9_1_T.json',
    ],
  },
  {
    id: 'tem4',
    name: '专四 TEM-4',
    category: 'exam',
    description: '英语专业四级核心词，英专二年级的词汇门槛，也适合四级后想再上一层的自学者。',
    files: ['Level4luan_2_T.json'],
  },
  {
    id: 'tem8',
    name: '专八 TEM-8',
    category: 'exam',
    description: '英语专业八级高阶词表，覆盖学术与文学书面语，专八备考与高阶阅读扩容。',
    files: ['Level8luan_2_T.json'],
    // 全量 12,197 条（约 2.5MB）。2026-11-21 之前截断到 8000 条是为了控制体积；
    // 但词库是按需 fetch 的（src/data/wordbanks.ts 只在进入该词库时才下载，且带内存缓存），
    // 2.5MB 与 gaokao(1.37MB) / gre(1.26MB) 同一量级，不值得为此砍掉 4197 个高阶词。
    // 另外「按源顺序取前 N 条」本身有隐患：源文件顺序不等于难度顺序，
    // 截断会成片丢掉某一类词（实测截断后末词停在 slime，ab-/su- 开头的词大量缺失）。
  },
  {
    id: 'sat',
    name: 'SAT',
    category: 'exam',
    description: 'SAT 阅读与写作高频词，面向美本申请与学术英语入门。',
    files: ['SAT_3_T.json'],
  },
  {
    id: 'bec',
    name: 'BEC · 商务英语',
    category: 'exam',
    description: '剑桥商务英语 BEC 中级 + 高级词汇，覆盖职场沟通、贸易与商务文书场景。',
    files: ['BEC_2_T.json', 'BEC_3_T.json'],
  },
  {
    id: 'coding',
    name: '程序员 · 通用术语',
    category: 'programming',
    description: '编程与计算机通用术语：数据结构、网络、数据库、操作系统里的常见英文词。',
    files: ['itVocabulary.json'],
  },
  {
    id: 'medical',
    name: '医学 · 基础术语',
    category: 'basic',
    description: '医学与生物学基础术语（解剖、生理、药理、细胞），医学文献阅读的入门词表。',
    files: ['BIOmedical.json'],
    // 源数据是一份个人生物化学词表，混入了拉丁学名、试剂品牌名、OCR 残词
    // 与个别错拼。这些都剔掉，宁少勿滥。
    drop: [
      'glucouse', // 源数据错拼，正确形式 glucose 已在表内
      'insulin trypsin', // 释义与词形都对不上
      'descript ion', // OCR 把 description 断成两截
      'a alternatively adva', // OCR 残句
      'Zea mays', // 拉丁学名，不是英语词
      'Arabidopsis thaliana', // 拉丁学名
      'Nematoda', // 拉丁分类名
      'Invitrogen', // 试剂品牌名
      'Herceptin', // 药品商品名（通用名 Trastuzumab 已收）
      'Rafts', // 释义取的是"皮筏"，与本词库语义不符
      'Life Rafts', // 同上，普通义项
      'Possibility', // 通用词，非术语
      'Caucasians', // 族裔称谓，不适合词表
      'Hispanic', // 同上
      'Trypsin Crystallized', // 带 OCR 噪声的条目
      'Hypertonic incoordinate', // 源数据断词，释义为整句描述
      'Congenital Dysbolism', // 释义里带冒号与重复
      // 以下是从通用英语混进来的词，释义也是通用义而非专业义
      'trophies', // 奖杯
      'promiscuity', // 乱交（社会学词）
      'segregant', // 分离体，释义写成"隔离"且词性标错
      'skeptic', // 怀疑论者
      'jurors', // 陪审员
      'fidelity', // 保真度
      'lick', // 舔
      'toe', // 脚趾
      'lodge', // 旅馆
      'intimate', // 亲密的
      'ribbon', // 缎带
      'whereby', // 靠那个（连词）
      'controversy', // 争论
      'algorithms', // 算法（复数形式，coding 库已收）
      'sap', // 树液
      'akin', // 同族的
      'advocate', // 提倡
      'query', // 疑问
      'deficit', // 赤字
      'thermal', // 热的
      'ingenious', // 心灵手巧的
      'spill', // 溢出
      'perplexing', // 令人困惑的
      'tamper with', // 篡改
      'rod', // 枝条
      'filamentous', // 丝状的（形态描述词，非术语）
    ],
  },
];

/** index.json 的固定排序：从易到难、先基础后专业 */
const ORDER = [
  'primary',
  'junior',
  'gaokao',
  'cet4',
  'cet6',
  'kaoyan',
  'tem4',
  'tem8',
  'ielts',
  'toefl',
  'gre',
  'sat',
  'bec',
  'coding',
  'linux',
  'medical',
];

/* ------------------------------ 小工具 ------------------------------ */

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);

function fail(message) {
  throw new Error(message);
}

async function sizeOf(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 先写 .part 再 rename，避免中断留下半截 JSON；内容没变就不动 mtime */
async function writeIfChanged(file, text) {
  let prev = null;
  try {
    prev = await readFile(file, 'utf8');
  } catch {
    prev = null;
  }
  const bytes = Buffer.byteLength(text);
  if (prev === text) return { changed: false, bytes };
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
  return { changed: true, bytes };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ghJson(url, { retries = 3 } = {}) {
  if (OFFLINE) fail(`离线模式下需要联网：${url}`);
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'englishmate-dict-builder',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (res.status === 403 || res.status === 429) {
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

/* ------------------------------ 目录清单 ------------------------------ */

let listingCache = null;
async function loadListing() {
  if (listingCache) return listingCache;
  for (const name of ['dicts.json', 'dicts-list.json']) {
    try {
      const raw = JSON.parse(await readFile(path.join(CACHE_DIR, name), 'utf8'));
      const list = Array.isArray(raw) ? raw : raw?.entries;
      if (Array.isArray(list) && list.length > 0) {
        listingCache = list;
        return list;
      }
    } catch {
      /* 换下一个候选 */
    }
  }
  if (OFFLINE) {
    listingCache = [];
    return listingCache;
  }
  listingCache = await ghJson(
    `${API}/repositories/331603334/contents/public/dicts?ref=master&per_page=1000`,
  ).catch(() => []);
  return listingCache;
}

async function shaFor(fileName) {
  const list = await loadListing();
  const hit = list.find((x) => x?.name === fileName);
  return hit?.sha || null;
}

/* ------------------------------ blob 读取 ------------------------------ */

async function readBlobText(sha) {
  const cached = path.join(BLOB_DIR, `${sha}.json`);
  if (!REFRESH && (await sizeOf(cached))) {
    try {
      const parsed = JSON.parse(await readFile(cached, 'utf8'));
      if (parsed?.sha === sha && typeof parsed?.content === 'string') {
        const text = Buffer.from(parsed.content, 'base64').toString('utf8');
        if (text.trim()) return { text, cached: true };
      }
    } catch {
      warn(`  ! 缓存损坏，重新下载：${sha.slice(0, 10)}…`);
    }
  }

  log(`  · 下载 blob ${sha.slice(0, 10)}…`);
  const blob = await ghJson(`${API}/repos/${REPO}/git/blobs/${sha}`);
  if (blob?.encoding !== 'base64' || typeof blob?.content !== 'string') {
    fail(`blob 响应缺少 base64 内容（${sha}）`);
  }
  await mkdir(BLOB_DIR, { recursive: true });
  const tmp = path.join(BLOB_DIR, `${sha}.json.part`);
  await writeFile(tmp, JSON.stringify(blob), 'utf8');
  await rename(tmp, path.join(BLOB_DIR, `${sha}.json`));
  return { text: Buffer.from(blob.content, 'base64').toString('utf8'), cached: false };
}

/* ------------------------------ 释义清洗 ------------------------------ */

/** 全角空格 / 不间断空格归一，压空白，中文标点两侧不留空格 */
function tidyText(input) {
  return String(input ?? '')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，；、：（）])\s*/g, '$1')
    .trim();
}

/** 词性缩写（n. / vt. / adj. …） */
const POS = '(?:n|v|vt|vi|a|ad|adj|adv|prep|pron|conj|interj|aux|art|num|abbr|pl)';

/**
 * 源数据里偶见 "v.&,n.帮助" 这种把两个词性用 & 串起来的写法，
 * 语义是"既是 v. 又是 n."。改写成 "v./n. 帮助"。
 */
function fixPosAmpersand(text) {
  let out = text;
  // 依次把 "X.&,Y." / "X.&Y." 收成 "X./Y."
  const re = new RegExp(`(${POS}\\.)\\s*&\\s*,?\\s*(?=${POS}\\.)`, 'gi');
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(re, '$1/');
    if (next === out) break;
    out = next;
  }
  // 剩下的裸 & 当作顿号
  return out.replace(/\s*&\s*/g, '、');
}

/**
 * 拆行：Qwerty Learner 的分册词表用真换行；少数字段里出现字面量 "\n"
 * （两个字符）的历史数据也要兼容。
 */
function splitLines(text) {
  return String(text)
    .split(/\\r\\n|\\n|\\r|[\r\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 学科领域标记：[计] / [网络] / [医] … 整行丢弃（不是学习者要的义项） */
const DOMAIN_LINE = /^\[[^\]]{1,6}\]/;

/**
 * 剥掉释义里的噪声。
 * 逐项对应实测到的源数据问题（注释里给出真实样本）：
 */
function scrubGloss(text) {
  let out = String(text);

  // 1) 音标碎片：itVocabulary.json 把音标混进释义，形态有两种：
  //    "v./a.完成；完整的,,(ka,mu,pe,li,te)"  —— 逗号开头的方括号串
  //    "n.扩充(ei,ke,si,ten,de)"              —— 紧跟中文的圆括号串
  //    判据：括号内是按逗号切开的 3 段以上、每段 1–5 个字母（允许空段）。
  //    用「先捕获括号内容，再判断」的写法，避免嵌套量词回溯爆炸。
  out = out.replace(/,,.*$/, '');
  out = out.replace(/[(（]([^)）]{0,80})[)）]/g, (whole, inner) => {
    const segs = inner.split(',').map((s) => s.trim());
    if (segs.length < 3) return whole;
    if (segs.every((s) => /^[A-Za-z]{0,5}$/.test(s))) return '';
    return whole;
  });

  // 2) 词形注释：（forego的过去分词）这种整句丢掉，但保留 (pl) 这类短标注
  out = out.replace(/（[^）]{0,24}的[^）]{0,16}式）/g, '');
  out = out.replace(/\([^)]{0,24}的[^)]{0,16}式\)/g, '');

  // 3) 中文人名义项：词表混了 CEDICT 的姓名条目，
  //    "隐藏的；隐藏，躲藏（hide的过去分词）；(Hidden)人名" → 砍掉人名那一支。
  //    放在按分号拆分之前处理，否则人名会单独成一"义项"。
  out = out
    .split(/[；;|]/)
    .filter((seg) => !/人名/.test(seg))
    .join('；');

  // 4) 词典词条型标签：[网络] / [医] 等出现在行中的，连带本段一起丢
  out = out.replace(/\[[^\]]{1,6}\][^；;|]*/g, '');

  // 5) glossary 导出噪声
  out = out
    .replace(/释义：/g, '')
    .replace(/英文：/g, '')
    .replace(/中文释义[:：]/g, '')
    .replace(/\?\?/g, '');

  // 6) 未闭合的方括号残片（"渗透性；[物" → "渗透性；"）
  out = out.replace(/\[[^\]]*$/, '');

  // 7) 中文语境里的半角省略号统一成 "……"（词表排版统一）
  out = out.replace(/\.{2,}/g, '……');

  return out;
}

/**
 * 纯屈折变化义项（"seal的复数形式"）对学习者没有增量信息，整条丢弃。
 * 只在释义**只有**这一句时才判死，避免误伤 "n. X；X的复数形式" 这种。
 */
const INFLECTION_ONLY = /^\S+的(复数|过去式|过去分词|现在分词|比较级|最高级)形式$/;

/**
 * 人名音译义项：词表混了 CEDICT 的姓名条目，
 * 形如 "(英)希登" / "(法、阿拉伯)阿米德" / "(德)伦德"。
 * 判据 = 括号里只含国家/地区名 + 后面是纯中文音译，避免误伤
 * "（外）祖母"、"（口语）爸爸" 这类真正的语境限定。
 */
const REGION_WORDS = new Set([
  '英',
  '美',
  '法',
  '德',
  '意',
  '西',
  '俄',
  '荷',
  '葡',
  '日',
  '韩',
  '泰',
  '印',
  '土',
  '挪',
  '丹',
  '瑞典',
  '阿拉伯',
  '伊朗',
  '希',
  '波',
  '捷',
  '匈',
  '罗',
  '芬',
  '冰',
  '爱尔兰',
  '苏格兰',
  '威尔士',
  '加拿大',
  '澳大利亚',
  '新西兰',
  '南非',
  '巴西',
  '墨西哥',
  '阿根廷',
  '以色列',
  '越南',
  '缅甸',
  '菲律宾',
  '马来',
  '印尼',
]);

function isNameTransliteration(seg) {
  const m = /^[（(]([^)）]{1,12})[)）]([\u4e00-\u9fff·]{1,8})$/.exec(String(seg).trim());
  if (!m) return false;
  const regions = m[1]
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!regions.length) return false;
  return regions.every((r) => REGION_WORDS.has(r));
}

/**
 * 把一条条释义整理成 "a；b；c"：
 *   - 按分号 / 竖线拆成义项（源数据两种分隔符都在用），逐条清洗
 *   - 丢掉空义项、相邻重复、纯屈折变化（"X的复数形式"）
 *   - 多义项时丢掉单字残片（"糖尿病；1型糖尿病；病" 里的"病"）
 *   - 最多保留 maxSenses 个，总量超长时按分号截断
 *
 * @param {string[]} parts  源释义数组
 * @param {string} headword 词条本身，用来识别 "testis: 睾丸" 这种自我重复
 */
function tidyTranslation(parts, headword = '', maxSenses = 3) {
  const flat = [];
  for (const part of parts) {
    for (const line of splitLines(part)) {
      if (DOMAIN_LINE.test(line)) continue;
      let scrubbed = scrubGloss(fixPosAmpersand(line));

      // 词条名自我重复："testis: 睾丸" → "睾丸"
      if (headword) {
        const esc = headword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        scrubbed = scrubbed.replace(new RegExp(`\\b${esc}\\s*:\\s*`, 'gi'), '');
      }

      for (const seg of scrubbed.split(/[;；|]/)) {
        let s = tidyText(seg);
        // 去掉开头结尾的零散标点与引号
        s = s.replace(/^[,，、·.\s"“]+/, '').replace(/[,，、·.\s"”]+$/, '');
        if (!s) continue;
        if (INFLECTION_ONLY.test(s)) continue;
        if (isNameTransliteration(s)) continue;
        if (flat.length && flat[flat.length - 1] === s) continue;
        flat.push(s);
      }
    }
  }

  // 多义项时，单字中文残片基本都是切分产物，丢掉
  const kept =
    flat.length > 1 ? flat.filter((s) => !(s.length === 1 && /[\u4e00-\u9fff]/.test(s))) : flat;
  const finalSenses = kept.length ? kept : flat;

  // 同一义项内被空格重复的片段折叠掉："睾丸 睾丸" → "睾丸"
  const deduped = finalSenses.map((s) => {
    const tokens = s.split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of tokens) if (out[out.length - 1] !== t) out.push(t);
    return out.join(' ');
  });

  const picked = deduped.slice(0, maxSenses);
  let out = picked.join('；');
  if (out.length > MAX_GLOSS_LEN) {
    out = picked[0].slice(0, MAX_GLOSS_LEN).replace(/[,，、]$/, '');
  }
  return out;
}

/**
 * 单词是否可接受。过滤：
 *   - 词根碎片（"." / "-" 开头，如 "-able"）
 *   - 非字母开头、含中日韩 / 方括号 / 花括号 / 等号 / 竖线等脏字符
 *   - 长度越界、含换行
 * 保留：字母、空格、连字符、撇号、点（缩写）、斜杠、圆括号
 */
function acceptWord(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length < 1 || text.length > MAX_WORD_LEN) return null;
  if (/^[.\-]/.test(text)) return null;
  if (!/^[A-Za-z]/.test(text)) return null;
  if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af[\]{}=|<>@#$%^*_\\]/.test(text)) return null;
  if (!/^[A-Za-z][A-Za-z '\-.&/()]*$/.test(text)) return null;
  // 两字母全大写基本是生僻缩写，挡掉（少数字科缩写如 IT 会在源里以其他形式出现）
  if (/^[A-Z]{2}$/.test(text)) return null;
  return text;
}

/** 音标归一：去掉源里自带的 /…/ 或 […] 外壳，统一成 /…/ */
function normalizePhone(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return '';
  text = text
    .replace(/^[/[]+/, '')
    .replace(/[/\]]+$/, '')
    .trim();
  if (!text) return '';
  if (text.includes('/')) {
    text = text
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 60) return '';
  return `/${text}/`;
}

function firstString(obj, keys) {
  for (const key of keys) {
    const v = obj?.[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** 把 trans 字段统一成字符串数组（兼容 string / string[] / {tranCn}） */
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
      .filter((s) => typeof s === 'string' && s.trim());
  }
  if (typeof raw === 'string' && raw.trim()) return [raw];
  return [];
}

/**
 * 单词归一：
 *   - 人民教育出版社的分册词表把词组/句子写成 "house." / "go swimming." /
 *     "You're welcome."——末尾的句号是排版残留，不是单词的一部分。
 *   - 但真正的缩写要保留点号：a.m. / p.m. / P.E. / Mr. / Ms. / Dr. …
 *   - "how about..." / "from... to..." 这种省略号统一成全角 "…"，
 *     更符合中文词表的排版习惯，也避免和缩写点混淆。
 */

/** 常见缩写白名单（小写比较）：末尾点号是词的一部分 */
const ABBREV = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'st',
  'jr',
  'sr',
  'vs',
  'etc',
  'no',
  'fig',
  'eg',
  'ie',
  'am',
  'pm',
  'pe',
  'pa',
  'encl',
  'inc',
  'ltd',
  'co',
  'dept',
  'est',
  'approx',
  'esp',
  'min',
  'max',
  'ft',
  'lb',
  'oz',
  'mt',
  'km',
  'cm',
  'mm',
  'kg',
  'hr',
  'sec',
]);

function normalizeHeadword(text) {
  let out = text.trim();

  // 省略号：>=2 个连续点 → 单个 …；"..." 前后若紧贴字母也照样替换
  out = out.replace(/\.{2,}/g, '…').replace(/…\s*…/g, '…');
  out = out.replace(/\s+/g, ' ').trim();

  // 末尾单点：只有缩写才保留，其余当作排版残留砍掉
  if (/\.$/.test(out) && !out.endsWith('…')) {
    const stem = out.slice(0, -1).trim();
    const looksAbbrev =
      /\./.test(stem) || // 内部已有点，如 "P.E." / "a.m."
      ABBREV.has(stem.toLowerCase());
    if (!looksAbbrev) out = stem;
  }

  return out.trim();
}

/** 单条源记录 → WordEntry 或 null */
function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const raw = acceptWord(firstString(entry, ['name', 'word', 'w']));
  if (!raw) return null;

  const w = normalizeHeadword(raw);
  if (!w) return null;

  const t = tidyTranslation(toTransList(entry), w);
  if (!t) return null;

  const out = { w, t };
  const p = normalizePhone(
    firstString(entry, ['usphone', 'usPhone', 'phone', 'phonetic']) ||
      firstString(entry, ['ukphone', 'ukPhone']),
  );
  if (p) out.p = p;
  return out;
}

/* ------------------------------ 保留下游富化 ------------------------------ */

/**
 * scripts/build-rich-dicts.mjs 会给词条补 defs（词性释义）与 sentences（Tatoeba 例句），
 * 并在 meta.source 末尾追加署名。本脚本重跑时如果把整个文件覆盖掉，
 * 就会把那条流水线的成果抹掉（且例句抓取很慢、代价高）。
 *
 * 所以重建时先读旧文件，把 defs / sentences 按单词小写键接回来；
 * 旧 source 若以本次的基础 source 开头且更长，说明它带着下游追加的署名，沿用它。
 */
async function loadDownstreamEnrichment(id, baseSource) {
  const file = path.join(OUT_DIR, `${id}.json`);
  let prev;
  try {
    prev = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return { fields: new Map(), source: baseSource };
  }
  if (!prev?.meta || !Array.isArray(prev?.words)) return { fields: new Map(), source: baseSource };

  const fields = new Map();
  for (const w of prev.words) {
    if (typeof w?.w !== 'string') continue;
    if (w.defs === undefined && w.sentences === undefined) continue;
    const keep = {};
    if (w.defs !== undefined) keep.defs = w.defs;
    if (w.sentences !== undefined) keep.sentences = w.sentences;
    fields.set(w.w.toLowerCase(), keep);
  }

  // 只有在旧 source 明确是本轮 source 的"加长版"时才沿用（避免把别的来源当成本库）
  const prevSource = typeof prev.meta.source === 'string' ? prev.meta.source : '';
  const source =
    prevSource.startsWith(baseSource) && prevSource.length > baseSource.length
      ? prevSource
      : baseSource;

  return { fields, source };
}

/** 把富化字段接回词条（原地改 words 数组的元素） */
function applyEnrichment(words, fields) {
  if (fields.size === 0) return { restored: 0 };
  let restored = 0;
  for (const word of words) {
    const keep = fields.get(word.w.toLowerCase());
    if (!keep) continue;
    if (keep.defs !== undefined) word.defs = keep.defs;
    if (keep.sentences !== undefined) word.sentences = keep.sentences;
    restored += 1;
  }
  return { restored };
}

function sourceLabel(files) {
  if (files.length === 1) return `Qwerty Learner (MIT) · public/dicts/${files[0]}`;
  return `Qwerty Learner (MIT) · public/dicts/${files[0]} 等 ${files.length} 个分册`;
}

async function collectWords(def) {
  const drop = new Set((def.drop ?? []).map((s) => s.toLowerCase()));
  const words = [];
  const seen = new Set();
  let rawTotal = 0;
  let droppedEmpty = 0;
  let droppedDup = 0;
  let droppedManual = 0;

  for (const fileName of def.files) {
    const sha = await shaFor(fileName);
    if (!sha) fail(`${def.id}: 目录里找不到 ${fileName}`);
    const { text } = await readBlobText(sha);

    let entries;
    try {
      const data = JSON.parse(text.replace(/^\uFEFF/, ''));
      entries = Array.isArray(data) ? data : (data?.words ?? data?.data ?? data?.list);
    } catch (err) {
      fail(`${def.id}: ${fileName} 不是合法 JSON（${err.message}）`);
    }
    if (!Array.isArray(entries)) fail(`${def.id}: ${fileName} 里没有词条数组`);

    rawTotal += entries.length;
    for (const entry of entries) {
      if (def.limit && words.length >= def.limit) break;

      const word = cleanEntry(entry);
      if (!word) {
        droppedEmpty += 1;
        continue;
      }
      const key = word.w.toLowerCase();
      if (drop.has(key)) {
        droppedManual += 1;
        continue;
      }
      if (seen.has(key)) {
        droppedDup += 1;
        continue;
      }
      seen.add(key);
      words.push(word);
    }
  }

  return { words, rawTotal, droppedEmpty, droppedDup, droppedManual };
}

/* ------------------------------ index.json ------------------------------ */

/**
 * 汇总磁盘上实际存在的词库 meta（已构建的直接用内存里的，其余读文件），
 * 按 ORDER 排序后写 index.json。
 * 这样 build-dicts.mjs 与 build-more-dicts.mjs 交替跑都不会丢条目。
 */
async function rebuildIndex(knownMeta) {
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const metas = new Map();
  for (const file of files) {
    const id = path.basename(file, '.json');
    if (knownMeta.has(id)) {
      metas.set(id, knownMeta.get(id));
      continue;
    }
    try {
      const data = JSON.parse(await readFile(path.join(OUT_DIR, file), 'utf8'));
      if (data?.meta?.id === id) metas.set(id, data.meta);
    } catch {
      warn(`  ! index: 跳过无法解析的 ${file}`);
    }
  }

  const rank = (id) => {
    const i = ORDER.indexOf(id);
    return i === -1 ? ORDER.length : i;
  };
  const banks = [...metas.values()].sort(
    (a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id),
  );

  const indexFile = path.join(OUT_DIR, 'index.json');
  let generatedAt = new Date().toISOString();
  try {
    const prev = JSON.parse(await readFile(indexFile, 'utf8'));
    if (prev?.generatedAt && JSON.stringify(prev?.banks) === JSON.stringify(banks)) {
      generatedAt = prev.generatedAt;
    }
  } catch {
    /* 没有旧 index，用当前时间 */
  }
  const result = await writeIfChanged(indexFile, JSON.stringify({ generatedAt, banks }));
  return { result, banks };
}

/* ------------------------------ 自检 ------------------------------ */

function selfCheck(def, words) {
  const problems = [];
  if (words.length < MIN_WORDS) problems.push(`词条仅 ${words.length}，低于下限 ${MIN_WORDS}`);

  const seen = new Set();
  let dup = 0;
  let emptyT = 0;
  let badW = 0;
  let badP = 0;
  let janky = 0;
  for (const word of words) {
    if (typeof word.w !== 'string' || !word.w || word.w !== word.w.trim()) badW += 1;
    else if (word.w.length > MAX_WORD_LEN) badW += 1;
    else if (/[\r\n]/.test(word.w)) badW += 1;
    else if (/^[.\-]/.test(word.w)) badW += 1;

    if (typeof word.t !== 'string' || !word.t.trim()) emptyT += 1;
    else if (/\\n|\[[^\]]*$|释义：|\?\?/.test(word.t)) janky += 1;

    const key = typeof word.w === 'string' ? word.w.toLowerCase() : '';
    if (key) {
      if (seen.has(key)) dup += 1;
      else seen.add(key);
    }
    if (word.p !== undefined) {
      const p = word.p;
      if (typeof p !== 'string' || !p.startsWith('/') || !p.endsWith('/') || p.length < 3)
        badP += 1;
    }
  }
  if (dup) problems.push(`重复单词 ${dup} 条`);
  if (emptyT) problems.push(`空释义 ${emptyT} 条`);
  if (badW) problems.push(`非法单词 ${badW} 条`);
  if (badP) problems.push(`音标格式不合规 ${badP} 条`);
  if (janky) problems.push(`释义含残留噪声 ${janky} 条`);
  return problems;
}

/* ------------------------------ 全量契约校验 ------------------------------ */

const META_KEYS = ['category', 'count', 'description', 'id', 'name', 'source'];
const CATEGORIES = new Set(['exam', 'programming', 'basic']);

/**
 * 与 scripts/verify-data.mjs 的 A 部分等价，但词库清单从 index.json 动态读取。
 * 逐项校验：文件可解析、meta 六字段齐全、id 与文件名一致、count 与
 * words.length 一致、无重复 w、无空 t、w 长度 1–64 且无换行、p 形如 /…/、
 * index.banks 与各文件 meta 逐字段一致、count 之和与总数一致。
 */
async function verifyAll() {
  const problems = [];
  const fail2 = (scope, msg) => problems.push(`[${scope}] ${msg}`);

  let index;
  try {
    index = JSON.parse(await readFile(path.join(OUT_DIR, 'index.json'), 'utf8'));
  } catch (err) {
    fail2('index', `缺失或不可解析（${err.message}）`);
    reportVerify(problems, 0, 0, 0);
    return;
  }

  if (!Array.isArray(index.banks) || index.banks.length === 0) {
    fail2('index', 'banks 不是非空数组');
    reportVerify(problems, 0, 0, 0);
    return;
  }
  if (typeof index.generatedAt !== 'string' || Number.isNaN(Date.parse(index.generatedAt))) {
    fail2('index', 'generatedAt 不是合法 ISO 时间');
  }

  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const metas = new Map();
  let totalWords = 0;
  let totalBytes = 0;

  console.log('  词库        条数      体积  类别');
  console.log('  ' + '-'.repeat(46));

  for (const bank of index.banks) {
    const id = bank?.id;
    if (typeof id !== 'string' || !id) {
      fail2('index', '有一个 bank 缺 id');
      continue;
    }
    const file = path.join(OUT_DIR, `${id}.json`);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      fail2(id, '文件不存在或不可读');
      continue;
    }
    totalBytes += Buffer.byteLength(text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      fail2(id, `不是合法 JSON（${err.message}）`);
      continue;
    }

    const meta = data?.meta;
    const words = data?.words;
    if (!meta || typeof meta !== 'object') {
      fail2(id, '缺 meta');
      continue;
    }
    if (!Array.isArray(words)) {
      fail2(id, 'words 不是数组');
      continue;
    }

    if (Object.keys(meta).sort().join(',') !== META_KEYS.join(',')) {
      fail2(id, `meta 字段应为 ${META_KEYS.join(',')}`);
    }
    if (meta.id !== id) fail2(id, `meta.id=${meta.id} 与文件名不一致`);
    if (!CATEGORIES.has(meta.category)) fail2(id, `category 非法：${meta.category}`);
    if (typeof meta.name !== 'string' || !meta.name.trim()) fail2(id, 'name 为空');
    if (typeof meta.description !== 'string' || !meta.description.trim())
      fail2(id, 'description 为空');
    if (typeof meta.source !== 'string' || !/qwerty\s*learner/i.test(meta.source))
      fail2(id, `source 未标注 Qwerty Learner：${meta.source}`);
    if (!/\(MIT\)/.test(String(meta.source))) fail2(id, 'source 未标注 MIT 许可');

    if (words.length !== meta.count) {
      fail2(id, `count 不符：words=${words.length} meta.count=${meta.count}`);
    }
    if (words.length < MIN_WORDS) fail2(id, `词条仅 ${words.length}，低于下限 ${MIN_WORDS}`);

    if (JSON.stringify(bank) !== JSON.stringify(meta)) {
      fail2(id, 'index.banks 与单文件 meta 不一致');
    }

    problems.push(...selfCheck({ id }, words).map((p) => `[${id}] ${p}`));

    metas.set(id, meta);
    totalWords += words.length;

    const bad = problems.some((p) => p.startsWith(`[${id}]`));
    console.log(
      `  ${id.padEnd(10)} ${String(words.length).padStart(5)} ${human(Buffer.byteLength(text)).padStart(9)}  ` +
        `${String(meta.category).padEnd(11)} ${bad ? '✗' : '✓'}`,
    );
  }

  // 磁盘与 index 的互查：两边都不能有孤儿
  for (const id of metas.keys()) {
    if (!files.includes(`${id}.json`)) fail2(id, 'index 里有但磁盘上没有');
  }
  for (const f of files) {
    const id = path.basename(f, '.json');
    if (!metas.has(id)) fail2(id, '磁盘上有但 index 里没有');
  }

  const sum = index.banks.reduce((s, b) => s + (b.count || 0), 0);
  if (sum !== totalWords) fail2('index', `banks 的 count 之和 ${sum} 与总数 ${totalWords} 不符`);

  reportVerify(problems, metas.size, totalWords, totalBytes);
}

function reportVerify(problems, bankCount, totalWords, totalBytes) {
  if (problems.length) {
    console.log('');
    console.log(`✗ 校验失败，共 ${problems.length} 项：`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log('');
  console.log(`✓ 全部通过：${bankCount} 个词库 / ${totalWords} 词条 / ${human(totalBytes)}`);
  process.exit(0);
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  if (VERIFY) {
    log('EnglishMate 词库契约校验');
    log(`  目录：${path.relative(ROOT, OUT_DIR)}`);
    log('');
    await verifyAll();
    return;
  }

  log('EnglishMate 扩展词库构建');
  log(`  仓库：${REPO}@master`);
  log(`  缓存：${path.relative(ROOT, CACHE_DIR)}`);
  log(`  输出：${path.relative(ROOT, OUT_DIR)}`);
  if (OFFLINE) log('  模式：离线（仅用缓存）');
  if (DRY) log('  模式：体检（不写盘）');
  if (ONLY) log(`  子集：${[...ONLY].join(', ')}`);
  log('');

  const targets = BANKS.filter((d) => !ONLY || ONLY.has(d.id));
  if (targets.length === 0) fail('--only 没有匹配到任何词库');

  await mkdir(OUT_DIR, { recursive: true });

  const knownMeta = new Map();
  const rows = [];
  let failed = 0;

  for (const def of targets) {
    log(`■ ${def.id}（${def.name}）`);
    const { words, rawTotal, droppedEmpty, droppedDup, droppedManual } = await collectWords(def);

    // 先把下游流水线补的 defs / sentences 接回来，再算 meta
    const baseSource = sourceLabel(def.files);
    const downstream = await loadDownstreamEnrichment(def.id, baseSource);
    const { restored } = applyEnrichment(words, downstream.fields);

    const meta = {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      count: words.length,
      source: downstream.source,
    };

    const problems = selfCheck(def, words);
    if (problems.length) {
      failed += 1;
      for (const p of problems) warn(`  ✗ ${p}`);
    }

    const payload = JSON.stringify({ meta, words });
    const bytes = Buffer.byteLength(payload);
    if (!DRY) {
      const { changed } = await writeIfChanged(path.join(OUT_DIR, `${def.id}.json`), payload);
      rows.push({ id: def.id, count: words.length, bytes, changed, problems });
    } else {
      rows.push({ id: def.id, count: words.length, bytes, changed: false, problems });
    }
    if (bytes > WARN_BYTES) warn(`  ! 体积 ${human(bytes)} 超过建议上限 ${human(WARN_BYTES)}`);

    log(
      `  ${String(words.length).padStart(5)} 词条  ${human(bytes).padStart(9)}` +
        `  (原始 ${rawTotal}，丢空释义 ${droppedEmpty}，去重 ${droppedDup}` +
        `${droppedManual ? `，人工剔除 ${droppedManual}` : ''}` +
        `${restored ? `，保留富化 ${restored}` : ''})`,
    );
    if (problems.length === 0) log('  ✓ 自检通过');
    log('');

    knownMeta.set(def.id, meta);
  }

  if (!DRY) {
    const { banks } = await rebuildIndex(knownMeta);
    const total = banks.reduce((s, b) => s + (b.count || 0), 0);
    log('■ index.json');
    log(`  ${banks.length} 个词库 / ${total} 词条`);
    log(`  ${banks.map((b) => `${b.id}(${b.count})`).join(' / ')}`);
    log('');
  }

  log('  词库              产出词条       体积  状态');
  log('  ' + '-'.repeat(52));
  for (const row of rows) {
    log(
      `  ${row.id.padEnd(10)} ${String(row.count).padStart(8)} ${human(row.bytes).padStart(11)}  ` +
        `${row.problems.length ? '✗ 有问题' : '✓'}${row.changed ? ' / 已写入' : ''}`,
    );
  }
  log('  ' + '-'.repeat(52));

  if (failed) fail(`${failed} 个词库自检未通过`);
  log('');
  log(DRY ? '✓ 体检完成（未写盘）' : '✓ 构建完成');
}

main().catch((err) => {
  console.error('');
  console.error(`✗ 构建失败：${err?.message || err}`);
  process.exit(1);
});

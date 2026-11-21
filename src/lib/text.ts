/**
 * 文本归一化：把"排版用的"字符映射成"键盘能打出来的"字符。
 *
 * 为什么需要：文章语料里有 `…`（三连点）和 `’`（弯撇号）这类印刷字符，
 * 但标准键盘打不出来——用户照着打 `Liberty…` 永远不可能正确，
 * 这是打字类应用必须处理的实际问题。对比前把两边都归一化即可。
 */

/** 单字符级的归一化映射 */
const CHAR_MAP: Record<string, string> = {
  // 各种省略号 → 三个点
  '\u2026': '...',
  // 弯引号 → 直引号（英文撇号/单引号）
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  // 弯双引号
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  // 各种破折号/连字符 → 键盘上的连字符
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  // 不间断空格 → 普通空格
  '\u00A0': ' ',
};

/**
 * 归一化用于比较的文本。
 * 不改变显示内容（用户看到的仍是原文），只用于判定是否打对。
 */
export function normalizeForCompare(input: string): string {
  let out = '';
  for (const ch of input) {
    out += CHAR_MAP[ch] ?? ch;
  }
  // 连续空白压成一个空格，首尾去掉
  return out.replace(/\s+/g, ' ').trim();
}

/** 词两端要剥掉的标点/符号（只剥两端，不动词内部） */
const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * 取一个词的"纯拼写"：剥掉两端标点，去掉词内撇号。
 *
 * ── 为什么要这么做（来自真实用户反馈）────────────────────────────────────
 * 用户把「I want to ensure my phone has good customer support.」逐字打对，
 * 只因为没打句末那个 `.`，`support` 与 `support.` 就被判成不一致、整句标红。
 * 同样地，`don't` 打成 `dont`（漏了撇号）也被判错。
 *
 * 这两类都不该算错：
 *  1. **标点不是这个练习要考的东西**。句子练习考的是词形、搭配、语序；
 *     句末句号、问号、逗号在飞快打整句时最容易漏。
 *  2. **撇号是最容易漏的字符**。`dont` 与 `don't` 的差异是排版，
 *     不是"没记住这个词"。
 *
 * ── 边界（刻意保守）──────────────────────────────────────────────────────
 * 只剥**两端**，词内部的其他标点保留：
 *  - `well-known` 的连字符在中间，保留（拆词比较会把一个词变成两个）
 *  - `3.14` 的小数点在中间，保留
 * 剥完两端后词内只剩撇号需要抹掉（`don't` → `dont`）。
 *
 * 只用于**比较**，绝不用于显示：界面上的标准答案必须保留原始
 * `don't` / `support.`，否则用户无从照着打。
 */
export function spellingOf(word: string): string {
  if (typeof word !== 'string') return '';
  const stripped = word.replace(EDGE_PUNCT, '');
  return stripped.replace(/['\u2018\u2019\u02BC]/g, '');
}

/**
 * 比较用的词形：先归一化印刷字符，再取纯拼写，最后统一小写。
 *
 * 大小写不算错是既有约定（打字练习不是拼写考试），这里沿用。
 */
export function compareKey(word: string): string {
  return spellingOf(normalizeForCompare(word)).toLowerCase();
}

/** 按词切分（归一化之后切，避免 `…` 粘在词上造成误判） */
export function tokenizeForCompare(input: string): string[] {
  return normalizeForCompare(input).split(' ').filter(Boolean);
}

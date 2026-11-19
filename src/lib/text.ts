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

/** 按词切分（归一化之后切，避免 `…` 粘在词上造成误判） */
export function tokenizeForCompare(input: string): string[] {
  return normalizeForCompare(input).split(' ').filter(Boolean);
}

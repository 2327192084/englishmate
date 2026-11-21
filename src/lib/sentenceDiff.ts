/**
 * 整句对比：把「用户打的句子」和「目标句子」按词逐位对齐。
 *
 * 为什么按词而不是按字符：长句逐字符校验会把体验变成"红一片"，
 * 而且一个词打错会让后面每个字符都错位。按词对齐后，错误被定位到具体的词，
 * 用户一眼就知道是哪个词没记住（和 ArticlesPage 的 ArticlePlayer 同一套口径）。
 *
 * 比较口径（三条，都是踩过真实反馈才定下的）：
 *  1. **大小写不算错** —— 打字练习不是拼写考试
 *  2. **词两端标点不算错** —— 漏句号/问号不该让整句标红（用户实际反馈）
 *  3. **词内撇号不算错** —— don't 打成 dont 是漏打，不是记错词（用户实际反馈）
 *
 * 边界见 `text.ts` 的 `spellingOf`：词内部的其他标点（连字符、小数点）保留。
 *
 * 本文件是纯函数，不许引入任何 React / 状态库依赖——它要能脱离界面单测。
 */
import { compareKey, normalizeForCompare, tokenizeForCompare } from './text';

export type WordDiff = {
  /** 目标句里的这个位置应该是哪个词（已归一化，可直接展示） */
  word: string;
  /** ok=打对；wrong=同一位置打成了别的词；missing=少打了这个词 */
  state: 'ok' | 'wrong' | 'missing';
  /** 仅 state==='wrong' 时存在：用户实际打的那个词 */
  typed?: string;
};

/**
 * 逐位比较两句。
 *
 * 多打的词只会在末尾多出来，这里直接忽略：多打一个词不该把整句判成错误，
 * 也不影响目标句每个位置的判定。少打的词记为 missing，这样「漏词」和
 * 「打错词」在界面上是两种不同的提示。
 */
export function diffSentence(target: string, typed: string): WordDiff[] {
  const targetWords = tokenizeForCompare(target);
  const typedWords = tokenizeForCompare(typed);

  return targetWords.map((word, i) => {
    const got = typedWords[i];
    if (got === undefined) return { word, state: 'missing' as const };
    /**
     * 用 compareKey 而不是直接小写比较：
     * 它额外剥掉两端标点与词内撇号，见文件头三条口径。
     * 展示用的 `word` / `typed` 保持归一化后的原样（含标点），
     * 这样用户看到的对照仍是「support.」而不是被抹掉句号的版本。
     */
    if (compareKey(got) === compareKey(word)) return { word, state: 'ok' as const };
    return { word, state: 'wrong' as const, typed: got };
  });
}

/** 错词的个数：wrong + missing 都算 */
export function mistakeCount(diffs: WordDiff[]): number {
  let n = 0;
  for (const d of diffs) if (d.state !== 'ok') n += 1;
  return n;
}

/**
 * 把词拼回一句，给「标准答案」展示用。
 *
 * 注意入参通常是归一化后的词（来自 WordDiff.word），所以句子里原本的 `…`
 * 会显示成 `...`。这是刻意为之：标准答案要能被用户照着打出来。
 */
export function joinSentence(words: string[]): string {
  return words
    .map((w) => normalizeForCompare(w))
    .filter(Boolean)
    .join(' ');
}

/**
 * 错误分类 —— 纯逻辑，零 DOM / 零 React 依赖，可在 node 环境单测。
 *
 * 为什么只从「期望字符 vs 实际按下的字符」推分类：
 * 打字练习能拿到的信号只有这一对。做行为分析（测按键间隔、猜注意力）既不准
 * 也没必要——用户要的是「我的错属于哪一类，该练什么」，不是心理画像。
 *
 * 分类之间是**互斥**的，按下面的优先级判定，第一个命中的就是结果：
 *   1. order     顺序错：把上一个字符又打了一遍，或者抢按了下一个字符
 *   2. adjacent  邻键误触：两个键在 QWERTY 上相邻（含斜向）
 *   3. similar   形近混淆：b/d、p/q、m/n 这类看起来像的一对
 *   4. unrelated 其他：想不起来怎么拼，按了个不相干的字
 *
 * 「大小写不一致」不算错误（打字练习不是拼写考试），所以这里根本不会收到
 * 只差大小写的一对字符——判定在 src/lib/typing.ts 的 sameChar 里已经放行了。
 */
import type { MistakeCounts, MistakeKind } from '@/types';
import { normalizeChar } from './typing';

/**
 * QWERTY 键盘的三行字母键（物理顺序，按标准 US 布局）。
 *
 * 邻键判定只用这三行，外加「上下行斜向相邻」——实际误触绝大多数发生在
 * 同一根手指管的那一列附近，用行内相邻 + 斜向就够覆盖，不必画完整键位图。
 */
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const;

/** 字符 → [行号, 列号]，非字母键不参与邻键判定 */
const KEY_POS = new Map<string, [number, number]>();
KEY_ROWS.forEach((row, r) => {
  for (let c = 0; c < row.length; c += 1) KEY_POS.set(row[c], [r, c]);
});

/**
 * 看起来像的一对字符。
 *
 * 只收真正会混淆的：镜像对（b/d、p/q）、字形残缺时难以区分的（m/n、h/n、u/v），
 * 以及小写连写时容易糊在一起的（i/l、c/e、s/z）。这些不是拼写知识问题，
 * 是视觉辨别问题，练法完全不同（对比辨词，而不是反复抄写）。
 */
const SIMILAR_PAIRS = new Set([
  'bd',
  'db',
  'pq',
  'qp',
  'mn',
  'nm',
  'hn',
  'nh',
  'uv',
  'vu',
  'il',
  'li',
  'ij',
  'ji',
  'ce',
  'ec',
  'sz',
  'zs',
  'ft',
  'tf',
  'rc',
  'cr',
  'vw',
  'wv',
  'gy',
  'yg',
]);

/** 顺序错判定里，允许回看的字符数（上一个 / 下一个） */
const ORDER_WINDOW = 1;

/** 归一到小写单字符；返回 null 表示这个输入无法参与分类 */
function asLetter(ch: string | null | undefined): string | null {
  if (!ch) return null;
  const norm = normalizeChar(ch);
  if (norm.length !== 1) return null;
  const lower = norm.toLowerCase();
  return /^[a-z]$/.test(lower) ? lower : null;
}

/** 两个字符在 QWERTY 上是否相邻（行内左右、上下行斜向） */
export function isAdjacentKey(a: string, b: string): boolean {
  const pa = KEY_POS.get(a);
  const pb = KEY_POS.get(b);
  if (!pa || !pb) return false;
  const [ra, ca] = pa;
  const [rb, cb] = pb;
  const rowGap = Math.abs(ra - rb);
  // 同行只算紧邻（隔一个键的误触太罕见了，算进来会把 unrelated 吃掉）
  if (rowGap === 0) return Math.abs(ca - cb) === 1;
  // 相邻行：列差 0 或 1 都算斜向相邻
  if (rowGap === 1) return Math.abs(ca - cb) <= 1;
  return false;
}

/**
 * 给一次错误分类。
 *
 * @param expected 期望字符（光标处目标字符）
 * @param actual   用户实际按下的字符
 * @param typed    当前已经打对的部分（目标串前缀），用于识别「重复上一个字符」
 * @param rest     光标之后剩余的目标串，用于识别「抢按下一个字符」
 */
export function classifyMistake(
  expected: string,
  actual: string,
  typed = '',
  rest = '',
): MistakeKind {
  const act = asLetter(actual);
  const exp = asLetter(expected);
  // 非字母（标点、数字、空格）不参与邻键/形近判定；能走到这里的都不是大小写差异
  if (!act) return 'unrelated';

  // 1. 顺序错：打成了刚打过的那个字符，或抢按了紧接着的那个字符
  if (typed) {
    const prev = asLetter(typed.slice(-ORDER_WINDOW));
    if (prev && act === prev) return 'order';
  }
  if (rest) {
    const next = asLetter(rest.slice(0, ORDER_WINDOW));
    if (next && act === next) return 'order';
  }

  if (!exp) return 'unrelated';

  // 2. 邻键误触
  if (isAdjacentKey(act, exp)) return 'adjacent';

  // 3. 形近混淆
  if (SIMILAR_PAIRS.has(act + exp)) return 'similar';

  // 4. 其余一律归「想不起来」
  return 'unrelated';
}

/** 全零的错误分类计数 */
export function emptyMistakeCounts(): MistakeCounts {
  return { order: 0, adjacent: 0, similar: 0, unrelated: 0 };
}

/** 累加一次分类，返回新对象（不就地改，避免 store 里共享引用被悄悄改掉） */
export function addMistakeKind(
  counts: MistakeCounts | undefined,
  kind: MistakeKind,
): MistakeCounts {
  const base = counts ?? emptyMistakeCounts();
  return { ...base, [kind]: base[kind] + 1 };
}

/** 是否有任何已分类的错误（用于区分「老数据没记过」和「记过但都是 0」） */
export function hasMistakeData(counts: MistakeCounts | undefined): boolean {
  if (!counts) return false;
  return counts.order + counts.adjacent + counts.similar + counts.unrelated > 0;
}

/**
 * 这个词最常犯的是哪一类错。
 *
 * 用「占比最高」而不是「有过就算」来做分组：
 * 一个词可能同时有邻键和形近的失误，如果按「有过」归组，同一个词会出现在
 * 好几个分组里，看起来数量对不上、也没法回答「我最该练哪一类」。
 *
 * 平票时按 MISTAKE_KINDS 的顺序取靠前的，保证同一份数据每次分组结果一致。
 * 返回 null 表示没有分类数据（老记录或辨认模式）。
 */
export function dominantMistakeKind(counts: MistakeCounts | undefined): MistakeKind | null {
  if (!hasMistakeData(counts)) return null;
  let best: MistakeKind = 'order';
  // counts 非空由 hasMistakeData 保证，这里的兜底只是让类型收窄
  const safe = counts as MistakeCounts;
  for (const kind of MISTAKE_KINDS) {
    if (safe[kind] > safe[best]) best = kind;
  }
  return best;
}

/** 分类的展示信息：名称 / 一句话解释 / 练习建议 */
export const MISTAKE_KINDS: MistakeKind[] = ['order', 'adjacent', 'similar', 'unrelated'];

export const MISTAKE_KIND_LABELS: Record<
  MistakeKind,
  { name: string; hint: string; advice: string }
> = {
  order: {
    name: '顺序错',
    hint: '重复或抢打相邻的字符',
    advice: '多半是手比眼睛快。放慢一点，把词当成整体读一遍再落键。',
  },
  adjacent: {
    name: '邻键误触',
    hint: '按到了旁边那个键',
    advice: '手指定位漂了。注意回到家键位，别用眼睛找键。',
  },
  similar: {
    name: '形近混淆',
    hint: 'b/d、p/q、m/n 这类长得像的',
    advice: '这是视觉辨别问题，不是记不住。把成对的词放一起对比着看更有效。',
  },
  unrelated: {
    name: '想不起来',
    hint: '按了个不相干的字符',
    advice: '对这个词的拼写还不够熟。先看一遍发音和例句，再回来默写。',
  },
};

/**
 * 求分类计数之和。
 * 用于把多个词/多次作答的错误合并成一份分布。
 */
export function totalMistakes(counts: MistakeCounts | undefined): number {
  if (!counts) return 0;
  return counts.order + counts.adjacent + counts.similar + counts.unrelated;
}

/**
 * 完形填空（cloze）：把例句里的目标词挖空，让用户填回去。
 *
 * ── 为什么这个功能值得做 ────────────────────────────────────────────────
 * 单词级练习（跟打/默写/听写）只验证「能不能想起这个词」，
 * 句子级完形多考一层「能不能在句子里用对」：时态、单复数、搭配都在这一层。
 * 语料是现成的——57,257 条例句全部中英对照，不需要任何新数据。
 *
 * ── 挖空的三个真实约束（都是实测出来的，不是假设）────────────────────────
 * 1. **目标词不一定以原形出现**：实测 21.2% 的例句里只有屈折形式
 *    （pencil → "any pencils?"、go → "went"）。只按原形匹配会漏掉五分之一。
 * 2. **目标词可能在句中重复出现**（0.3%）：挖掉第一个，第二个会把答案
 *    直接泄露给用户。这类句子标记为 ambiguous，由调用方丢弃。
 * 3. **有 540 个短语词条**（"pencil box"、"living room"）：匹配必须按
 *    词序列做，不能只按单个 token 比较，否则 "pencil" 会误挖短语里的一半。
 *
 * ── 这个文件是纯函数，不许引入任何 React / Dexie 依赖 ────────────────────
 * 它必须能脱离界面单测（见 cloze.test.ts）。
 */
import { normalizeForCompare } from './text';

/**
 * 不规则屈折表。
 *
 * 只收动词与少数不规则名词。刻意没收 -ly：那是派生不是屈折，
 * 把 "hard" 匹配成 "hardly" 会挖错词（两者是不同词条），
 * 完形挖错的代价比漏掉几个句子高得多。
 */
const IRREGULAR: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  go: ['goes', 'went', 'gone', 'going'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  make: ['made', 'making'],
  take: ['took', 'taken', 'taking'],
  come: ['came', 'coming'],
  see: ['saw', 'seen', 'seeing'],
  get: ['got', 'gotten', 'getting'],
  give: ['gave', 'given', 'giving'],
  find: ['found', 'finding'],
  think: ['thought', 'thinking'],
  know: ['knew', 'known', 'knowing'],
  say: ['said', 'saying'],
  tell: ['told', 'telling'],
  become: ['became', 'becoming'],
  leave: ['left', 'leaving'],
  feel: ['felt', 'feeling'],
  bring: ['brought', 'bringing'],
  begin: ['began', 'begun', 'beginning'],
  hold: ['held', 'holding'],
  write: ['wrote', 'written', 'writing'],
  stand: ['stood', 'standing'],
  hear: ['heard', 'hearing'],
  mean: ['meant', 'meaning'],
  meet: ['met', 'meeting'],
  run: ['ran', 'running'],
  pay: ['paid', 'paying'],
  sit: ['sat', 'sitting'],
  speak: ['spoke', 'spoken', 'speaking'],
  lead: ['led', 'leading'],
  grow: ['grew', 'grown', 'growing'],
  lose: ['lost', 'losing'],
  fall: ['fell', 'fallen', 'falling'],
  send: ['sent', 'sending'],
  build: ['built', 'building'],
  understand: ['understood', 'understanding'],
  draw: ['drew', 'drawn', 'drawing'],
  break: ['broke', 'broken', 'breaking'],
  spend: ['spent', 'spending'],
  rise: ['rose', 'risen', 'rising'],
  drive: ['drove', 'driven', 'driving'],
  buy: ['bought', 'buying'],
  wear: ['wore', 'worn', 'wearing'],
  choose: ['chose', 'chosen', 'choosing'],
  eat: ['ate', 'eaten', 'eating'],
  drink: ['drank', 'drunk', 'drinking'],
  sleep: ['slept', 'sleeping'],
  teach: ['taught', 'teaching'],
  catch: ['caught', 'catching'],
  throw: ['threw', 'thrown', 'throwing'],
  fly: ['flew', 'flown', 'flying'],
  forget: ['forgot', 'forgotten', 'forgetting'],
  win: ['won', 'winning'],
  sing: ['sang', 'sung', 'singing'],
  swim: ['swam', 'swum', 'swimming'],
  child: ['children'],
  man: ['men'],
  woman: ['women'],
  foot: ['feet'],
  tooth: ['teeth'],
  mouse: ['mice'],
  person: ['people'],
};

/** 挖空占位符。用下划线而不是「____」以外的符号，是为了在任何主题下都看得见 */
export const BLANK = '____';

export interface Token {
  text: string;
  /** 在原文里的起始下标（含） */
  start: number;
  /** 在原文里的结束下标（不含） */
  end: number;
}

/**
 * 切出「词」并保留在原文中的位置。
 *
 * 不用 `\b` 之类的花招：句子里有 `don't`、`three-headed` 这类带撇号/连字符的词，
 * `\b` 会把它们切碎。允许撇号与连字符留在词内，才能整体比较。
 *
 * 每次调用都新建正则：带 `g` 标志的正则对象有可变的 `lastIndex`，
 * 放模块级会被跨调用污染（并发/重入时会静默跳过开头几个词）。
 */
export function tokenizeWithOffsets(sentence: string): Token[] {
  const out: Token[] = [];
  if (typeof sentence !== 'string' || sentence.length === 0) return out;
  const re = /[A-Za-z][A-Za-z'-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** 比较用的归一化：弯引号/省略号先规整，再忽略大小写 */
function norm(text: string): string {
  return normalizeForCompare(text).toLowerCase();
}

/**
 * 一个词条在句子里所有可接受的表面形式：原形 + 屈折形式。
 *
 * 规则按英语拼写习惯分四类（咝音加 -es、辅音+y 变 -ies、以 e 结尾去 e 加 -ing、
 * 重读闭音节双写），再加一张不规则表。覆盖率见文件头的实测数字。
 */
export function inflectionCandidates(word: string): Set<string> {
  const out = new Set<string>();
  if (typeof word !== 'string') return out;
  const w = norm(word);
  if (!w) return out;

  out.add(w);
  for (const v of IRREGULAR[w] ?? []) out.add(v);

  // 短语只管最后一个词形变（"pencil boxes"），前半部分必须原样匹配
  const parts = w.split(' ');
  const head = parts[parts.length - 1] ?? w;
  if (!head) return out;
  const prefix = parts.slice(0, -1);

  /**
   * 把「词干 + 新结尾」拼成完整候选（短语还要带上前半部分）。
   *
   * 关键：词干与结尾是两个独立参数。早期版本把它们合成一个 suffix 直接接在
   * head 后面，于是 study → "studyies"、run → "runned"、
   * make → "makeing" 全部生成了一堆不存在的词。虽然多出来的错候选不会
   * 造成误挖（它们匹配不到任何真实文本），但正确形式会因此缺失——
   * 下面每个分支都必须给出真正的词干。
   */
  const withStem = (stem: string) => prefix.concat(stem).join(' ');
  const plain = (...suffixes: string[]) => {
    for (const s of suffixes) {
      out.add(withStem(head + s));
    }
  };

  const sibilant = /(s|x|z|ch|sh)$/.test(head);
  const consonantY = /[^aeiou]y$/.test(head);
  const endsE = /e$/.test(head);
  const cvc = /[^aeiou][aeiou][bdglmnprt]$/.test(head);

  /**
   * 不规则动词不生成规则过去式。
   *
   * 否则 run 会多出 "runned"、make 多出 "maked"、go 多出 "goed"——
   * 这些词在真实语料里不存在，属于纯噪声。第三人称 -s 和 -ing 仍然要生成
   * （"runs" / "running" / "makes" / "making" 都是真实的规则变化）。
   */
  const irregular = IRREGULAR[head] !== undefined;

  if (sibilant) {
    // watch → watches / watched / watching（-es，不是 -s）
    out.add(withStem(head + 'es'));
    if (!irregular) plain('ed');
    plain('ing');
  } else if (consonantY) {
    // study → studies / studied / studying（y → i，且 -ing 保留 y）
    const stem = head.slice(0, -1);
    out.add(withStem(stem + 'ies'));
    if (!irregular) out.add(withStem(stem + 'ied'));
    out.add(withStem(head + 'ing'));
  } else if (endsE) {
    // use → uses / used / using（去 e 加 -ing）；make → made 走不规则表
    out.add(withStem(head + 's'));
    if (!irregular) out.add(withStem(head + 'd'));
    out.add(withStem(head.slice(0, -1) + 'ing'));
  } else if (cvc) {
    // run → runs / running（双写辅音）；run 的过去式是 ran，来自不规则表
    const doubled = head + head.slice(-1);
    out.add(withStem(head + 's'));
    if (!irregular) out.add(withStem(doubled + 'ed'));
    out.add(withStem(doubled + 'ing'));
  } else {
    out.add(withStem(head + 's'));
    if (!irregular) plain('ed');
    plain('ing');
  }

  /**
   * 刻意**不生成** -er / -est / -ly 这类派生形式。
   *
   * 实测（57,257 条例句）：加上比较级只多覆盖 94 句（0.17%），
   * 但会引入真正的误挖——`fold` 会匹配到 "folder"、而 folder 在词库里
   * 是另一个独立词条，挖掉它等于考了一个用户没在学的词。
   * 0.17% 的覆盖换一类会挖错词的 bug，不划算。
   *
   * 剩下的误匹配都是真屈折（help → helping、go → going），可以接受。
   */

  return out;
}

export interface ClozeSpan {
  start: number;
  end: number;
  /** 原文里被挖掉的那一段（保留原始大小写） */
  text: string;
}

/**
 * 在句子里找出目标词（含屈折形式、含短语）占据的所有位置。
 *
 * 短语按「词序列」匹配：前 n-1 个词必须原形一致，最后一个词允许屈折。
 * 这样 "pencil box" 不会在 "pencil" 单独出现时误挖。
 */
export function findTargetSpans(sentence: string, word: string): ClozeSpan[] {
  if (typeof sentence !== 'string' || typeof word !== 'string') return [];
  const tokens = tokenizeWithOffsets(sentence);
  const targetTokens = tokenizeWithOffsets(word).map((t) => norm(t.text));
  if (tokens.length === 0 || targetTokens.length === 0) return [];

  const candidates = inflectionCandidates(word);
  const spans: ClozeSpan[] = [];
  const spanLen = targetTokens.length;

  for (let i = 0; i + spanLen <= tokens.length; i++) {
    const first = tokens[i]!;
    const lastToken = tokens[i + spanLen - 1]!;
    /**
     * 用**整段**去比对候选集，而不是只比最后一个词。
     *
     * 候选集里存的是带前缀的完整形式（"pencil boxes"），只比最后那个
     * "boxes" 永远匹配不到——这正是短语词条一个都挖不出来的原因。
     * 同时这也自动满足了「短语前半部分必须原形一致」的要求：
     * "pencils box" 拼出来的整段不在候选集里。
     */
    const surface = norm(sentence.slice(first.start, lastToken.end));
    if (!candidates.has(surface)) continue;

    spans.push({
      start: first.start,
      end: lastToken.end,
      text: sentence.slice(first.start, lastToken.end),
    });
    // 跳过这个跨度，避免同一处被重复计入
    i += spanLen - 1;
  }

  return spans;
}

export type ClozeState = 'ok' | 'no-target' | 'ambiguous';

export interface ClozeItem {
  state: ClozeState;
  /** 原句，用于答完后回看 */
  sentence: string;
  /** 句中可读的中文译文（没有就空串） */
  zh: string;
  /** 这句例句归属的词条 */
  word: string;
  /** 挖空后的题目 */
  question: string;
  /** 标准答案（原文里的表面形式，保留大小写） */
  answer: string;
  spans: ClozeSpan[];
}

/**
 * 构造一道完形题。
 *
 * 返回 state 而不是抛错：调用方（页面）是在批量筛题，
 * 「这句做不了」是正常情况，不是异常。
 */
export function buildCloze(sentence: string, word: string, zh = ''): ClozeItem {
  const base: ClozeItem = {
    state: 'no-target',
    sentence: typeof sentence === 'string' ? sentence : '',
    zh: typeof zh === 'string' ? zh : '',
    word: typeof word === 'string' ? word : '',
    question: typeof sentence === 'string' ? sentence : '',
    answer: '',
    spans: [],
  };
  if (!base.sentence || !base.word) return base;

  const spans = findTargetSpans(base.sentence, base.word);
  if (spans.length === 0) return base;
  if (spans.length > 1) {
    // 重复出现会把答案泄露给用户（挖掉第一个，第二个还在），整句弃用
    return { ...base, state: 'ambiguous', spans };
  }

  const span = spans[0]!;
  const question = base.sentence.slice(0, span.start) + BLANK + base.sentence.slice(span.end);
  return { ...base, state: 'ok', question, answer: span.text, spans };
}

export type AnswerVerdict = 'correct' | 'inflection' | 'wrong';

/**
 * 判定用户填的答案。
 *
 * 三档而不是两档：答成原形但句子需要屈折形式（题面是 "boxes"，用户填 "box"）
 * 是**语法错误**，不是拼写错误——单独报出来才有教学价值，
 * 混在「错了」里用户不知道自己其实想起了正确的词。
 */
export function judgeAnswer(input: string, item: ClozeItem): AnswerVerdict {
  if (typeof input !== 'string') return 'wrong';
  const got = norm(input);
  if (!got) return 'wrong';

  const answer = norm(item.answer);
  if (got === answer) return 'correct';

  // 表面形式就是原形时，"差一个屈折" 这档不成立
  const lemma = norm(item.word);
  if (answer !== lemma && got === lemma) return 'inflection';

  return 'wrong';
}

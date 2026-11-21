/**
 * 句子练习页 —— 把词放回句子里，练的是搭配和语序。
 *
 * 与单词练习的取舍：单词练习是「逐字输入、即时判对错」，语料长成句子以后
 * 这种模式会变成红一片，所以这里沿用文章练习的「整句提交 + 逐词着色」，
 * 用户回车才判一次，错误定位到词而不是字符。
 *
 * 两种练法共用同一个取句入口（same items），只换作答形态：
 *   - 整句输入：把整句打出来，逐词对照
 *   - 完形填空：只挖掉目标词，考「在句子里用对」这一层
 * 之所以塞进同一页而不是新开一页：两者素材完全相同，
 * 用户真正要选的是「怎么练」，不该先选「进哪个页面」。
 *
 * 状态全部留在本组件内（useState/useRef），不进全局 store：这是一次性的
 * 会话视图，中途退出即丢弃，没有跨页共享的必要，也没有值得持久化的进度。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WordbankMeta } from '@/types';
import { loadBankIndex } from '@/data/wordbanks';
import { getNarrowBatch, listNarrowBatches, type NarrowBatch } from '@/data/narrowSources';
import { sentencesForBank, sentencesForUserWords, type SentenceItem } from '@/data/sentences';
import { buildCloze, judgeAnswer, type AnswerVerdict, type ClozeItem } from '@/lib/cloze';
import {
  buildPassPlan,
  advance,
  countListens,
  progressPercent,
  visibleText,
  type ListenPosition,
} from '@/lib/narrowListen';
import { diffSentence, joinSentence, mistakeCount } from '@/lib/sentenceDiff';
import { speak, stopSpeaking } from '@/lib/speech';
import { playFinishSound, playKeySound } from '@/lib/sound';
import { saveSession, recordAttempt } from '@/services/learning';
import { useSettings } from '@/store/settings';
import { EmptyState, Progress, Segmented, Skeleton } from '@/components/ui';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook,
  IconCheck,
  IconRefresh,
  IconVolume,
} from '@/components/Icons';

/**
 * 取句来源。
 *
 * `article` 只在精听模式下出现：一篇文章本身就是一个天然的窄式批次
 * （同作者、同主题、同语域），用它听三轮才是真正的「窄式」。
 * 完形/整句输入不提供这个来源——它们要的是跨文章的练习量，
 * 一篇文章只有 4–10 句，凑不满一轮。
 */
type Source = 'wrong' | 'favorite' | 'bank' | 'article';

/** 作答形态：整句输入 / 完形挖空 / 窄式精听 */
export type AnswerMode = 'full' | 'cloze' | 'listen';

/** 一轮固定 10 句：整句输入比单词慢得多，再长用户会中途疲劳 */
const ROUND_SIZE = 10;

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'wrong', label: '错词本' },
  { value: 'favorite', label: '收藏' },
  { value: 'bank', label: '按词库' },
];

const MODE_OPTIONS: { value: AnswerMode; label: string; hint: string }[] = [
  { value: 'full', label: '整句输入', hint: '照着打整句，练搭配和语序' },
  { value: 'cloze', label: '完形填空', hint: '只填被挖掉的那个词，练「在句子里用对」' },
  {
    value: 'listen',
    label: '窄式精听',
    hint: '同一批句子听三轮：盲听 → 看中文 → 看英文。用耳朵过一遍同一批材料',
  },
];

/** 空状态的文案随来源变化：告诉用户"为什么没有"比只说"没有"有用 */
const EMPTY_HINT: Record<Source, { title: string; hint: string }> = {
  wrong: {
    title: '错词本还是空的',
    hint: '先去练几个词，打错的词会自动进错词本，再回来练它们的例句。',
  },
  favorite: {
    title: '还没有收藏的词',
    hint: '在词库或练习页点星标收藏，被收藏词的例句就会出现在这里。',
  },
  bank: {
    title: '这个词库暂时没有可用例句',
    hint: '例句库里不是每个词都有例句，换一个词库或改练错词本试试。',
  },
  article: {
    title: '这篇文章没有可用句子',
    hint: '文章语料是构建期生成的，选中一篇有内容的文章再试。',
  },
};

export default function SentencesPage() {
  const [source, setSource] = useState<Source>('wrong');
  const [bankId, setBankId] = useState('cet4');
  const [articleId, setArticleId] = useState('');
  const [answerMode, setAnswerMode] = useState<AnswerMode>('full');
  const [banks, setBanks] = useState<WordbankMeta[]>([]);
  const [loading, setLoading] = useState(false);
  /** null = 还在选择来源；数组（可能为空）= 已经点过开始 */
  const [items, setItems] = useState<SentenceItem[] | null>(null);
  /**
   * 当前这一批的标题（来自文章时有值）。结算页要显示「听完了《葛底斯堡演说》」，
   * 只说「听完了」用户不知道刚听的是什么。
   */
  const [batchTitle, setBatchTitle] = useState('');
  /**
   * 窄式批次列表。只在精听模式下用得到，所以不放到全局 store：
   * 它是一次性的选择列表，没有跨页共享的需求。
   */
  const [batches] = useState(() => listNarrowBatches());
  /**
   * 第几轮。用来给播放器换一个实例：虽然 `start()` 会先经过 loading 骨架、
   * 播放器本来就会卸载重挂，但这层因果太隐晦，谁把骨架去掉就会踩坑；
   * 显式给个 key，让「新一轮必须从第 1 句开始」成为代码里看得见的事实。
   */
  const [round, setRound] = useState(0);

  // 词库下拉要的是完整列表：loadBankIndex 自己会在失败时退回静态元信息，不会抛
  useEffect(() => {
    let alive = true;
    void loadBankIndex().then((idx) => {
      if (!alive) return;
      setBanks(idx.banks);
      if (idx.banks.length > 0 && !idx.banks.some((b) => b.id === 'cet4')) {
        setBankId(idx.banks[0].id);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const start = useCallback(async () => {
    setLoading(true);
    try {
      /**
       * 按文章听：直接用该文章的句子，不经过例句库。
       *
       * 这是「窄式」的正确形态——同一篇里的句子是同作者、同主题、同语域，
       * 词汇与句式会自然复现。此前按词汇相似度聚类被实测否掉了
       * （真同主题文本平均只共享 0.11–0.36 个内容词，聚不出主题），
       * 详见 src/data/narrowSources.ts 文件头。
       */
      if (source === 'article') {
        const batch = getNarrowBatch(articleId);
        setItems(batch ? batch.items : []);
        setBatchTitle(batch ? batch.titleZh || batch.title : '');
        setRound((r) => r + 1);
        return;
      }

      const list =
        source === 'bank'
          ? await sentencesForBank(bankId, ROUND_SIZE)
          : await sentencesForUserWords(source, ROUND_SIZE);
      setBatchTitle('');
      /**
       * 完形模式要预先筛一遍：不是每句都能挖空（目标词可能不在句里、
       * 或重复出现会泄露答案）。筛完再截到一轮的量，否则用户会
       * 遇到「这一组只有 3 句」的落差。
       *
       * 精听不需要筛句：它不挖空，任何句子都能听，直接用上面取到的列表。
       */
      if (answerMode === 'cloze') {
        const usable = list
          .map((it) => ({ it, cloze: buildCloze(it.en, it.word, it.zh) }))
          .filter((x) => x.cloze.state === 'ok');
        // 筛完不够就如实少给几句，不要用别的句子凑数（那会混进不一致的题）
        setItems(usable.slice(0, ROUND_SIZE).map((x) => x.it));
      } else {
        setItems(list);
      }
      /**
       * 每一轮都换一次 key，强制重挂播放器。
       *
       * 这一步不能省：「再来一组」和「换了模式」都会走到这里，
       * 而播放器内部有 idx/input/submitted 三份局部状态，
       * 不重挂就会带着上一组的进度进来（表现为一进来就是「第 8/10 句」）。
       */
      setRound((r) => r + 1);
    } finally {
      setLoading(false);
    }
  }, [source, bankId, articleId, answerMode]);

  // 换来源就回到选择页，避免"来源已经改了但还在做上一组"的错位
  const changeSource = (s: Source) => {
    setSource(s);
    setItems(null);
  };

  // 换作答形态同理：已经把整句打出来了，不该接着做完形的下一句
  const changeAnswerMode = (m: AnswerMode) => {
    setAnswerMode(m);
    setItems(null);
    /**
     * 「按文章」只存在于精听模式。切到完形/整句时如果还停在 article，
     * 来源按钮会指向一个不在选项里的值——Segmented 上没有对应项，
     * 界面表现为「来源区空了但开始按钮还在」。
     */
    if (m !== 'listen' && source === 'article') setSource('bank');
  };

  /**
   * 首次进入精听时默认选中第一篇文章。
   *
   * 不设默认值的话下拉框显示的是空字符串，用户点「开始」会拿到空批次，
   * 看到一个「这篇文章没有可用句子」的空状态——那会让人以为功能坏了。
   */
  useEffect(() => {
    if (articleId) return;
    const first = batches[0];
    if (first) setArticleId(first.id);
  }, [articleId, batches]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <Skeleton className="mb-3 h-6 w-32" />
        <Skeleton className="mb-2 h-4 w-64" />
        <Skeleton className="mt-6 h-24 w-full" />
        <Skeleton className="mt-3 h-24 w-full" />
      </div>
    );
  }

  if (items === null) {
    return (
      <SetupView
        source={source}
        bankId={bankId}
        banks={banks}
        articleId={articleId}
        batches={batches}
        answerMode={answerMode}
        onSource={changeSource}
        onBank={setBankId}
        onArticle={setArticleId}
        onAnswerMode={changeAnswerMode}
        onStart={() => void start()}
      />
    );
  }

  if (items.length === 0) {
    const empty = EMPTY_HINT[source];
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <button
          type="button"
          onClick={() => setItems(null)}
          className="mb-6 flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <IconArrowLeft width={14} height={14} />
          换来源
        </button>
        <EmptyState
          icon={<IconBook width={28} height={28} />}
          title={empty.title}
          hint={empty.hint}
          action={
            <button type="button" onClick={() => setItems(null)} className="tf-btn text-xs">
              返回选择
            </button>
          }
        />
      </div>
    );
  }

  return answerMode === 'listen' ? (
    <NarrowListenPlayer
      key={round}
      items={items}
      batchTitle={batchTitle}
      onExit={() => setItems(null)}
      onAgain={() => void start()}
    />
  ) : (
    <SentencePlayer
      key={round}
      items={items}
      answerMode={answerMode}
      onExit={() => setItems(null)}
      onAgain={() => void start()}
    />
  );
}

/** 来源选择页 */
function SetupView({
  source,
  bankId,
  banks,
  articleId,
  batches,
  answerMode,
  onSource,
  onBank,
  onArticle,
  onAnswerMode,
  onStart,
}: {
  source: Source;
  bankId: string;
  banks: WordbankMeta[];
  articleId: string;
  batches: NarrowBatch[];
  answerMode: AnswerMode;
  onSource: (s: Source) => void;
  onBank: (id: string) => void;
  onArticle: (id: string) => void;
  onAnswerMode: (m: AnswerMode) => void;
  onStart: () => void;
}) {
  /**
   * 「按文章」只在精听模式下提供。
   *
   * 完形/整句输入要的是跨文章的练习量，而一篇文章只有 4–10 句，
   * 凑不满一轮 10 题；精听则相反，它要的正是「同一篇反复听」。
   */
  const sourceOptions = useMemo(
    () =>
      answerMode === 'listen'
        ? [...SOURCE_OPTIONS, { value: 'article' as const, label: '按文章' }]
        : SOURCE_OPTIONS,
    [answerMode],
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-lg font-semibold text-ink">句子练习</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        单词认得出，未必用得对。把词放回句子里打一遍，练的是搭配和语序。
      </p>

      <div className="tf-card mt-6 px-4 py-4">
        <div className="mb-2 text-[11px] font-medium text-muted">练法</div>
        <Segmented<AnswerMode> value={answerMode} onChange={onAnswerMode} options={MODE_OPTIONS} />
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          {MODE_OPTIONS.find((o) => o.value === answerMode)?.hint}
        </p>
      </div>

      <div className="tf-card mt-3 px-4 py-4">
        <div className="mb-2 text-[11px] font-medium text-muted">来源</div>
        <Segmented<Source> value={source} onChange={onSource} options={sourceOptions} />

        {source === 'bank' && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-medium text-muted">词库</div>
            <select
              value={bankId}
              onChange={(e) => onBank(e.target.value)}
              className="tf-input text-sm"
              aria-label="选择词库"
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {source === 'article' && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-medium text-muted">文章</div>
            <select
              value={articleId}
              onChange={(e) => onArticle(e.target.value)}
              className="tf-input text-sm"
              aria-label="选择文章"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.titleZh || b.title}（{b.items.length} 句{b.level ? ` · ${b.level}` : ''}）
                </option>
              ))}
            </select>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              一篇文章就是一个天然的窄式批次：同一作者、同一主题， 词汇和句式会在这一批里反复出现。
            </p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">
            {source === 'article'
              ? '整篇听完三轮'
              : `一轮 ${ROUND_SIZE} 句，只取 100 字符以内的句子`}
          </span>
          <button type="button" onClick={onStart} className="tf-btn tf-btn-primary text-xs">
            开始
            <IconArrowRight width={14} height={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 练习主视图：整句输入 + 逐词对照；完形模式下换成挖空单空作答 */
function SentencePlayer({
  items,
  answerMode,
  onExit,
  onAgain,
}: {
  items: SentenceItem[];
  answerMode: AnswerMode;
  onExit: () => void;
  onAgain: () => void;
}) {
  const settings = useSettings((s) => s.settings);
  const navigate = useNavigate();
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showZh, setShowZh] = useState(true);
  const [results, setResults] = useState<{ ok: boolean; mistakes: number }[]>([]);
  const [startedAt] = useState(Date.now());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** 完形模式用单行输入：答案就是一个词，给 textarea 反而容易误按回车换行 */
  const singleRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);

  const item = items[idx];
  const finished = idx >= items.length;

  const isCloze = answerMode === 'cloze';

  /**
   * 当前这句的完形题。
   *
   * 这里再构造一次而不是让上游把题目一起传下来：上游筛过一遍（只留 state==='ok'），
   * 但把 ClozeItem 塞进 SentenceItem 会让取句模块反过来依赖完形逻辑，
   * 两个纯模块就此耦合。重复构造的代价是一次正则扫描，可以忽略。
   */
  const cloze: ClozeItem | null = useMemo(
    () => (item && isCloze ? buildCloze(item.en, item.word, item.zh) : null),
    [item, isCloze],
  );

  const diffs = useMemo(() => (item ? diffSentence(item.en, input) : []), [item, input]);

  /** 完形模式的判定结果；整句模式恒为 null */
  const verdict: AnswerVerdict | null = useMemo(() => {
    if (!isCloze || !cloze || !submitted) return null;
    return judgeAnswer(input, cloze);
  }, [isCloze, cloze, submitted, input]);

  const mistakes = isCloze ? (verdict === 'correct' ? 0 : 1) : mistakeCount(diffs);

  useEffect(() => {
    if (isCloze) singleRef.current?.focus();
    else inputRef.current?.focus();
  }, [idx, isCloze]);

  // 换句 / 退出时把上一句的朗读打断：不然点了"下一句"还在念上一条
  useEffect(() => () => stopSpeaking(), []);

  const submit = () => {
    if (submitted || !item || !input.trim()) return;
    setSubmitted(true);
    /**
     * 完形模式下「答成原形但句子要屈折形式」记为错。
     *
     * 这一档在界面上会单独提示（用户其实想起了正确的词，只是没变形），
     * 但它确实没答对句子里的那个位置，计入错误才不会让正确率虚高。
     */
    const ok = isCloze
      ? judgeAnswer(input, cloze ?? buildCloze(item.en, item.word)) === 'correct'
      : mistakeCount(diffs) === 0;
    setResults((r) => [...r, { ok, mistakes: isCloze ? (ok ? 0 : 1) : mistakeCount(diffs) }]);
    if (settings.keySound) {
      if (ok) playFinishSound(settings.keyVolume);
      else playKeySound(settings.keyVolume, 'error');
    }

    /**
     * 完形把作答写进「用户词库 + FSRS」，答错的词会自动进错词本。
     *
     * 为什么只有完形写、整句输入不写：整句输入的作答单位是「句子」，
     * 一句里可能错三个词，无法归因到某一个词条；而完形每个空的答案
     * 都精确对应一个词条，是天然的「这个词会不会用」信号。
     *
     * 关于 mistakes 的取值（这是刻意的）：
     *  - 答对给 0
     *  - 答错给 1，而不是给「字符差异数」——完形没有逐字符输入，
     *    编一个差异数会让 FSRS 的评分失真（deriveRating 按 mistakes 分档）
     *
     * 关于错误分类：**不传 mistakeKinds**。
     * 完形没有按键级输入，无法区分「顺序错/邻键误触/形近」。硬塞一个
     * 'unrelated' 会让错词本的四类统计里混进一批并非按键错误的样本，
     * 而那个统计的意义正是回答「我在哪类按键错上栽得多」。
     * 不传时 recordAttempt 会保留原值，这是既有约定。
     */
    if (isCloze && item.bankId && item.word) {
      void recordAttempt({
        entry: {
          w: item.word,
          t: item.trans || '',
          ...(item.phonetic ? { p: item.phonetic } : {}),
        },
        bankId: item.bankId,
        correct: ok,
        mistakes: ok ? 0 : 1,
      }).catch(() => {
        // 落库失败不该让练习中断：界面已经给出判定，用户继续做下一句
      });
    }
  };

  const next = () => {
    setSubmitted(false);
    setInput('');
    setIdx((i) => i + 1);
  };

  /**
   * 键盘处理同时服务 textarea（整句）和 input（完形）。
   *
   * 泛型写成两者的共同父类型而不是 any：Enter/Tab 的判定只用到
   * preventDefault 和 key，但留一个具体类型能让将来加 Shift+Enter
   * 之类的分支时，编译器还能帮忙检查。
   */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    // Enter 换行在这类练习里只会带来误触；Shift+Enter 留给确实要换行的人
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (submitted) next();
      else submit();
      return;
    }
    // Tab 默认会跳焦点，但练习流里用户想要的正是"提交/下一句"
    if (e.key === 'Tab') {
      e.preventDefault();
      if (submitted) next();
      else submit();
    }
  };

  /** 一轮做完落一次 session：句数少（10），一次记完比分句记更省事 */
  useEffect(() => {
    if (idx < items.length || savedRef.current) return;
    savedRef.current = true;
    const attempts = items.map((it, i) => ({
      word: it.en.slice(0, 60),
      correct: results[i]?.ok ?? false,
      mistakes: results[i]?.mistakes ?? 0,
      ms: 1,
      /**
       * bankId 用不同的值区分两种练法。
       *
       * 统计页按 bankId 分组，混用同一个值会让「整句输入」的成绩里
       * 掺进完形的成绩——两者难度根本不是一回事，混在一起看不出任何东西。
       */
      bankId: isCloze ? 'cloze' : 'sentences',
    }));
    void saveSession({
      mode: 'typing',
      bankId: isCloze ? 'cloze' : 'sentences',
      startedAt,
      endedAt: Date.now(),
      attempts,
    });
  }, [idx, items, results, startedAt, isCloze]);

  if (finished) {
    const ok = results.filter((r) => r.ok).length;
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-correct/15 text-correct">
          <IconCheck width={24} height={24} />
        </div>
        <h1 className="text-lg font-semibold text-ink">这一组做完了</h1>
        <p className="mt-1 text-sm text-muted">
          一次打对 {ok} / {items.length} 句
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onAgain} className="tf-btn tf-btn-primary text-xs">
            <IconRefresh width={14} height={14} />
            再来一组
          </button>
          <button type="button" onClick={onExit} className="tf-btn text-xs">
            换来源
          </button>
          <button type="button" onClick={() => navigate('/practice')} className="tf-btn text-xs">
            去练单词
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <IconArrowLeft width={14} height={14} />
          换来源
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowZh((v) => !v)}
            className={`text-[11px] ${showZh ? 'text-accent' : 'text-muted'} hover:underline`}
          >
            {showZh ? '隐藏译文' : '显示译文'}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <Progress value={(idx / items.length) * 100} />
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
          <span>
            第 {idx + 1}/{items.length} 句
          </span>
          <span>来自词条 {item?.word}</span>
        </div>
      </div>

      {/* 目标句：完形模式下显示挖空后的题面 */}
      <div className="tf-card mb-3 px-4 py-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="text-[11px] font-medium text-muted">
            {isCloze ? '把空填上' : '目标句'}
          </div>
          <button
            type="button"
            onClick={() =>
              item && speak(item.en, { accent: settings.accent, rate: settings.speechRate })
            }
            className="rounded p-1 text-muted hover:text-accent"
            aria-label="朗读整句"
          >
            <IconVolume width={14} height={14} />
          </button>
        </div>
        <p className="tf-mono text-base leading-relaxed text-ink">
          {isCloze ? (cloze?.question ?? item?.en) : item?.en}
        </p>
        {/* 完形答完后把完整原句放回去：用户需要看到自己填的那个空在原句里长什么样 */}
        {isCloze && submitted && item && (
          <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-muted">
            原句：<span className="tf-mono">{item.en}</span>
          </p>
        )}
        {showZh && item?.zh && (
          <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-muted">
            {item.zh}
          </p>
        )}
      </div>

      {/* 输入区 */}
      <div className="tf-card mb-3 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
          <span>{isCloze ? '填这个词' : '你的输入'}</span>
          {submitted &&
            (isCloze ? (
              <span
                className={
                  verdict === 'correct'
                    ? 'text-correct'
                    : verdict === 'inflection'
                      ? 'text-pending'
                      : 'text-error'
                }
              >
                {verdict === 'correct'
                  ? '完全正确'
                  : verdict === 'inflection'
                    ? '词对了，但句子里要变形'
                    : '不对'}
              </span>
            ) : (
              <span className={mistakes === 0 ? 'text-correct' : 'text-error'}>
                {mistakes === 0 ? '完全正确' : `${mistakes} 处不一致`}
              </span>
            ))}
        </div>
        {isCloze ? (
          <input
            ref={singleRef}
            value={input}
            onChange={(e) => {
              if (submitted) return;
              setInput(e.target.value);
              if (settings.keySound) playKeySound(settings.keyVolume, 'down');
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="只填被挖掉的那个词，Enter 提交…"
            className="tf-input tf-mono text-sm"
            aria-label="填空答案"
          />
        ) : (
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              if (submitted) return;
              setInput(e.target.value);
              if (settings.keySound) playKeySound(settings.keyVolume, 'down');
            }}
            onKeyDown={onKeyDown}
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="在这里输入整句，Enter 提交…"
            className="tf-input tf-mono resize-none text-sm leading-relaxed"
          />
        )}
      </div>

      {/* 完形：答完后给答案，并按判定分档解释 */}
      {isCloze && submitted && cloze && (
        <div className="tf-card mb-3 px-4 py-3">
          <div className="mb-1 text-[11px] font-medium text-muted">答案</div>
          <p className={`tf-mono text-sm ${verdict === 'correct' ? 'text-correct' : 'text-ink'}`}>
            {cloze.answer}
          </p>
          {verdict === 'inflection' && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              你想起的是原形 <span className="tf-mono">{cloze.word}</span>
              ，但这句里要用它的屈折形式。这是语法问题，不是记错词。
            </p>
          )}
          {verdict === 'wrong' && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              这个词条是 <span className="tf-mono">{cloze.word}</span>
              。回看整句，注意它在句中的位置和形式。
            </p>
          )}
          {cloze.zh && (
            <p className="mt-1.5 border-t border-line pt-1.5 text-[11px] leading-relaxed text-muted">
              {cloze.zh}
            </p>
          )}
        </div>
      )}

      {/* 逐词对照：只有整句模式才需要 */}
      {!isCloze && submitted && (
        <div className="tf-card mb-3 px-4 py-3">
          <div className="mb-2 text-[11px] font-medium text-muted">逐词对照</div>
          <div className="flex flex-wrap gap-x-1.5 gap-y-1.5">
            {diffs.map((d, i) => (
              <span
                key={i}
                className={`tf-mono rounded px-1 py-0.5 text-sm ${
                  d.state === 'ok'
                    ? 'bg-correct/10 text-correct'
                    : d.state === 'wrong'
                      ? 'bg-error/10 text-error line-through'
                      : 'bg-surface2 text-muted/60'
                }`}
                title={d.state === 'wrong' ? `你打的：${d.typed}` : undefined}
              >
                {d.state === 'wrong' ? d.typed : d.word}
              </span>
            ))}
          </div>
          {mistakes > 0 && item && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span>正确：</span>
              {/* 用目标词拼回整句：与上方对照区同一批词，口径一致 */}
              <span className="tf-mono text-correct">{joinSentence(diffs.map((d) => d.word))}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <kbd className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[10px]">
            Enter
          </kbd>
          {submitted ? '下一句' : '提交'}
        </div>
        {submitted ? (
          <button type="button" onClick={next} className="tf-btn tf-btn-primary text-xs">
            {idx + 1 >= items.length ? '完成' : '下一句'}
            <IconArrowRight width={14} height={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!input.trim()}
            className="tf-btn tf-btn-primary text-xs"
          >
            提交
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 窄式精听播放器。
 *
 * 与 SentencePlayer 分开写而不是塞进去：两者除了「用同一批句子」之外
 * 没有任何共享状态——精听没有输入、没有判定、没有错词落库，
 * 硬合并只会让那个组件里到处是 `if (isListen)` 分支。
 *
 * 翻页由用户驱动（点「下一句」），因为 Web Speech 没有查时长的 API，
 * 无法自动判断一句何时播完（见 docs/learning-method-plan.md 1.3）。
 */
function NarrowListenPlayer({
  items,
  batchTitle,
  onExit,
  onAgain,
}: {
  items: SentenceItem[];
  /** 这一批的标题（来自文章时有值），结算页要显示听的是什么 */
  batchTitle?: string;
  onExit: () => void;
  onAgain: () => void;
}) {
  const settings = useSettings((s) => s.settings);
  const [passes] = useState(() => buildPassPlan());
  const [pos, setPos] = useState<ListenPosition>({ pass: 0, index: 0 });
  const [listens, setListens] = useState<Record<string, number>>({});
  const [startedAt] = useState(Date.now());
  const savedRef = useRef(false);

  const sentenceCount = items.length;
  const passCount = passes.length;
  const finished = pos.pass >= passCount;

  const item = !finished ? items[pos.index] : undefined;
  const plan = passes[Math.min(pos.pass, passCount - 1)];
  const shown = plan && item ? visibleText(plan.cue, item.en, item.zh) : null;

  const play = useCallback(() => {
    if (!item) return;
    speak(item.en, { accent: settings.accent, rate: settings.speechRate });
    setListens((s) => countListens(s, pos.pass, pos.index));
  }, [item, settings.accent, settings.speechRate, pos.pass, pos.index]);

  // 进入每一句自动播一次：盲听轮用户没有任何文字提示，不自动播就等于空屏
  useEffect(() => {
    if (!item) return;
    speak(item.en, { accent: settings.accent, rate: settings.speechRate });
    setListens((s) => countListens(s, pos.pass, pos.index));
    // 只在切句时触发；语速变化不该重播
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.pass, pos.index]);

  useEffect(() => () => stopSpeaking(), []);

  const next = () => {
    const n = advance(pos, sentenceCount, passCount);
    if (n) setPos(n);
    else setPos({ pass: passCount, index: 0 });
  };

  /** 整批听完落一次 session：bankId 单独标记，统计里才看得出是精听 */
  useEffect(() => {
    if (!finished || savedRef.current || sentenceCount === 0) return;
    savedRef.current = true;
    const attempts = items.map((it) => ({
      word: it.word,
      correct: true,
      mistakes: 0,
      ms: 1,
      bankId: 'listening',
    }));
    void saveSession({
      mode: 'typing',
      bankId: 'listening',
      startedAt,
      endedAt: Date.now(),
      attempts,
    });
  }, [finished, items, sentenceCount, startedAt]);

  if (sentenceCount === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <EmptyState
          icon={<IconBook width={28} height={28} />}
          title="没有可听的句子"
          hint="换一个来源试试。"
          action={
            <button type="button" onClick={onExit} className="tf-btn text-xs">
              返回选择
            </button>
          }
        />
      </div>
    );
  }

  if (finished) {
    const totalListens = Object.values(listens).reduce((a, b) => a + b, 0);
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-correct/15 text-correct">
          <IconCheck width={24} height={24} />
        </div>
        <h1 className="text-lg font-semibold text-ink">
          {batchTitle ? `《${batchTitle}》听完了` : '这一批听完了'}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {sentenceCount} 句 × {passCount} 轮，共播放 {totalListens} 次
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          精听的价值在「同一批材料反复听」，不在于听了多少不同的句子。
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onAgain} className="tf-btn tf-btn-primary text-xs">
            <IconRefresh width={14} height={14} />
            再来一批
          </button>
          <button type="button" onClick={onExit} className="tf-btn text-xs">
            换来源
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <IconArrowLeft width={14} height={14} />
          换来源
        </button>
        <span className="text-[11px] text-muted">
          第 {pos.pass + 1}/{passCount} 轮 · {plan?.label}
        </span>
      </div>

      {batchTitle && (
        <div className="mb-2 text-center text-[11px] text-muted">《{batchTitle}》</div>
      )}

      <Progress value={progressPercent(pos, sentenceCount, passCount)} />
      <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
        <span>
          第 {pos.index + 1}/{sentenceCount} 句
        </span>
        {/*
          盲听轮**不显示词条**：那等于把答案印在屏幕上。
          「来自词条 banana」在给中文/英文的轮次里是有用的定位信息，
          但在盲听轮会让「只听声音」变成「看着单词听」。
        */}
        {plan && plan.cue !== 'none' && <span>来自词条 {item?.word}</span>}
      </div>

      <div className="tf-card mt-4 px-5 py-10 text-center">
        {shown === null ? (
          <>
            <p className="text-sm text-muted">先只听，不看文字</p>
            <p className="mt-1 text-[11px] text-muted/70">听不懂是正常的，这一轮只让耳朵熟悉它</p>
          </>
        ) : (
          <p
            className={`text-base leading-relaxed ${plan?.cue === 'en' ? 'tf-mono' : ''} text-ink`}
          >
            {shown || '（这一句没有内容）'}
          </p>
        )}

        <button
          type="button"
          onClick={play}
          className="tf-btn tf-btn-primary mx-auto mt-6 text-xs"
          aria-label="再听一遍"
        >
          <IconVolume width={14} height={14} />
          再听一遍
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">{plan?.hint}</p>

      <div className="mt-4 flex items-center justify-end">
        <button type="button" onClick={next} className="tf-btn tf-btn-primary text-xs">
          {pos.index + 1 >= sentenceCount ? '下一轮' : '下一句'}
          <IconArrowRight width={14} height={14} />
        </button>
      </div>
    </div>
  );
}

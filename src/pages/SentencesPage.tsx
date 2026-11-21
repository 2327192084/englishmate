/**
 * 句子练习页 —— 把词放回句子里，练的是搭配和语序。
 *
 * 与单词练习的取舍：单词练习是「逐字输入、即时判对错」，语料长成句子以后
 * 这种模式会变成红一片，所以这里沿用文章练习的「整句提交 + 逐词着色」，
 * 用户回车才判一次，错误定位到词而不是字符。
 *
 * 状态全部留在本组件内（useState/useRef），不进全局 store：这是一次性的
 * 会话视图，中途退出即丢弃，没有跨页共享的必要，也没有值得持久化的进度。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WordbankMeta } from '@/types';
import { loadBankIndex } from '@/data/wordbanks';
import {
  sentencesForBank,
  sentencesForUserWords,
  type SentenceItem,
} from '@/data/sentences';
import { diffSentence, joinSentence, mistakeCount } from '@/lib/sentenceDiff';
import { speak, stopSpeaking } from '@/lib/speech';
import { playFinishSound, playKeySound } from '@/lib/sound';
import { saveSession } from '@/services/learning';
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

type Source = 'wrong' | 'favorite' | 'bank';

/** 一轮固定 10 句：整句输入比单词慢得多，再长用户会中途疲劳 */
const ROUND_SIZE = 10;

const SOURCE_OPTIONS: { value: Source; label: string }[] = [
  { value: 'wrong', label: '错词本' },
  { value: 'favorite', label: '收藏' },
  { value: 'bank', label: '按词库' },
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
};

export default function SentencesPage() {
  const [source, setSource] = useState<Source>('wrong');
  const [bankId, setBankId] = useState('cet4');
  const [banks, setBanks] = useState<WordbankMeta[]>([]);
  const [loading, setLoading] = useState(false);
  /** null = 还在选择来源；数组（可能为空）= 已经点过开始 */
  const [items, setItems] = useState<SentenceItem[] | null>(null);
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
      const list =
        source === 'bank'
          ? await sentencesForBank(bankId, ROUND_SIZE)
          : await sentencesForUserWords(source, ROUND_SIZE);
      setRound((r) => r + 1);
      setItems(list);
    } finally {
      setLoading(false);
    }
  }, [source, bankId]);

  // 换来源就回到选择页，避免"来源已经改了但还在做上一组"的错位
  const changeSource = (s: Source) => {
    setSource(s);
    setItems(null);
  };

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
        onSource={changeSource}
        onBank={setBankId}
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

  return (
    <SentencePlayer
      key={round}
      items={items}
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
  onSource,
  onBank,
  onStart,
}: {
  source: Source;
  bankId: string;
  banks: WordbankMeta[];
  onSource: (s: Source) => void;
  onBank: (id: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-lg font-semibold text-ink">句子练习</h1>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        单词认得出，未必用得对。把词放回句子里打一遍，练的是搭配和语序。
      </p>

      <div className="tf-card mt-6 px-4 py-4">
        <div className="mb-2 text-[11px] font-medium text-muted">来源</div>
        <Segmented<Source> value={source} onChange={onSource} options={SOURCE_OPTIONS} />

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

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">
            一轮 {ROUND_SIZE} 句，只取 100 字符以内的句子
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

/** 练习主视图：整句输入 + 逐词对照 */
function SentencePlayer({
  items,
  onExit,
  onAgain,
}: {
  items: SentenceItem[];
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
  const savedRef = useRef(false);

  const item = items[idx];
  const finished = idx >= items.length;

  const diffs = useMemo(
    () => (item ? diffSentence(item.en, input) : []),
    [item, input],
  );
  const mistakes = mistakeCount(diffs);

  useEffect(() => {
    inputRef.current?.focus();
  }, [idx]);

  // 换句 / 退出时把上一句的朗读打断：不然点了"下一句"还在念上一条
  useEffect(() => () => stopSpeaking(), []);

  const submit = () => {
    if (submitted || !item) return;
    setSubmitted(true);
    const ok = mistakes === 0;
    setResults((r) => [...r, { ok, mistakes }]);
    if (settings.keySound) {
      if (ok) playFinishSound(settings.keyVolume);
      else playKeySound(settings.keyVolume, 'error');
    }
  };

  const next = () => {
    setSubmitted(false);
    setInput('');
    setIdx((i) => i + 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      bankId: 'sentences',
    }));
    void saveSession({
      mode: 'typing',
      bankId: 'sentences',
      startedAt,
      endedAt: Date.now(),
      attempts,
    });
  }, [idx, items, results, startedAt]);

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

      {/* 目标句 */}
      <div className="tf-card mb-3 px-4 py-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="text-[11px] font-medium text-muted">目标句</div>
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
        <p className="tf-mono text-base leading-relaxed text-ink">{item?.en}</p>
        {showZh && item?.zh && (
          <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-muted">
            {item.zh}
          </p>
        )}
      </div>

      {/* 输入区 */}
      <div className="tf-card mb-3 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
          <span>你的输入</span>
          {submitted && (
            <span className={mistakes === 0 ? 'text-correct' : 'text-error'}>
              {mistakes === 0 ? '完全正确' : `${mistakes} 处不一致`}
            </span>
          )}
        </div>
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
      </div>

      {/* 逐词对照 */}
      {submitted && (
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

/**
 * 文章练习页 —— 逐句跟打 / 默写，中英对照。
 *
 * 与单词练习的区别：长句逐字符校验体验差，所以这里用「整句提交 + 逐词着色」：
 * 用户输入完整句，回车提交，逐词对比正确/错误。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ARTICLES } from '@/data/articles';
import type { Article } from '@/types';
import { speak, stopSpeaking } from '@/lib/speech';
import { tokenizeForCompare } from '@/lib/text';
import { useSettings } from '@/store/settings';
import { playKeySound, playFinishSound } from '@/lib/sound';
import { saveSession } from '@/services/learning';
import { Segmented, Progress } from '@/components/ui';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconVolume,
  IconX,
} from '@/components/Icons';

type ArticleMode = 'typing' | 'dictation';

export default function ArticlesPage() {
  const [active, setActive] = useState<Article | null>(null);
  return active ? (
    <ArticlePlayer article={active} onExit={() => setActive(null)} />
  ) : (
    <ArticleList onPick={setActive} />
  );
}

const LEVELS = ['全部', 'CET-4', 'CET-6', '考研', '雅思'] as const;
type LevelFilter = (typeof LEVELS)[number];

function ArticleList({ onPick }: { onPick: (a: Article) => void }) {
  const settings = useSettings((s) => s.settings);
  /**
   * 文章已到 75 篇，平铺一长串让人无从下手。
   * 按难度筛选 + 搜索标题，能快速定位。
   */
  const [level, setLevel] = useState<LevelFilter>('全部');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(20);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return ARTICLES.filter((a) => {
      if (level !== '全部' && a.level !== level) return false;
      if (!kw) return true;
      return (
        a.title.toLowerCase().includes(kw) ||
        a.titleZh.includes(kw) ||
        a.author.toLowerCase().includes(kw)
      );
    });
  }, [level, q]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of ARTICLES) m.set(a.level, (m.get(a.level) ?? 0) + 1);
    return m;
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">文章练习</h1>
        <p className="mt-1 text-sm text-muted">
          共 {ARTICLES.length} 篇 · 逐句跟打或听写，把词汇放进真实语境里记
        </p>
      </header>

      {/* 难度筛选 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {LEVELS.map((lv) => {
          const active = level === lv;
          const n = lv === '全部' ? ARTICLES.length : (counts.get(lv) ?? 0);
          if (lv !== '全部' && n === 0) return null;
          return (
            <button
              key={lv}
              type="button"
              onClick={() => {
                setLevel(lv);
                setLimit(20);
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                active
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              {lv} <span className="opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setLimit(20);
        }}
        placeholder="搜索标题或作者…"
        className="tf-input mb-3 max-w-xs text-sm"
      />

      <div className="grid gap-2">
        {filtered.slice(0, limit).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a)}
            className="tf-card group flex items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:border-accent/60"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{a.title}</span>
                <span className="text-[11px] text-muted">· {a.titleZh}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {a.author} · {a.sentences.length} 句
              </div>
              <div className="mt-1 text-[11px] text-muted/60">{a.source}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="tf-chip">{a.level}</span>
              <IconArrowRight
                width={15}
                height={15}
                className="text-muted group-hover:text-accent"
              />
            </div>
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">没有匹配的文章，换个关键词试试。</p>
      )}

      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 20)}
          className="tf-btn mt-3 w-full text-xs"
        >
          加载更多（还剩 {filtered.length - limit} 篇）
        </button>
      )}

      <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-[11px] leading-relaxed text-muted">
        <strong className="text-ink">为什么练文章</strong>：孤立的单词记得快忘得也快。把词放回句子，
        你能同时记住搭配、语序和语气——这也是「打字即学习」比单纯背词更有价值的地方。
        <span className="mt-1 block text-muted/70">
          发音使用系统语音（{settings.accent === 'en-US' ? '美音' : '英音'}），可在设置里切换。
        </span>
      </div>
    </div>
  );
}

function ArticlePlayer({ article, onExit }: { article: Article; onExit: () => void }) {
  const settings = useSettings((s) => s.settings);
  const navigate = useNavigate();
  const [mode, setMode] = useState<ArticleMode>('typing');
  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showZh, setShowZh] = useState(true);
  const [results, setResults] = useState<{ ok: boolean; mistakes: number }[]>([]);
  const [startedAt] = useState(Date.now());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(false);

  const sentence = article.sentences[idx];
  const finished = idx >= article.sentences.length;

  const wordDiff = useMemo(() => {
    if (!sentence) return [];
    // 用归一化后的词做对比：语料里有 … / ’ 这类键盘打不出的印刷字符
    const target = tokenizeForCompare(sentence.en);
    const typed = tokenizeForCompare(input);
    return target.map((w, i) => {
      const t = typed[i];
      if (t === undefined) return { word: w, state: 'missing' as const };
      if (t.toLowerCase() === w.toLowerCase()) return { word: w, state: 'ok' as const };
      return { word: w, state: 'wrong' as const, typed: t };
    });
  }, [sentence, input]);

  const mistakeCount = wordDiff.filter((d) => d.state !== 'ok').length;

  /** 自动发音 */
  useEffect(() => {
    if (!sentence || mode !== 'dictation') return;
    speak(sentence.en, { accent: settings.accent, rate: settings.speechRate });
    return () => stopSpeaking();
  }, [idx, sentence, mode, settings.accent, settings.speechRate]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [idx, mode]);

  const submit = () => {
    if (submitted || !sentence) return;
    setSubmitted(true);
    const ok = mistakeCount === 0;
    setResults((r) => [...r, { ok, mistakes: mistakeCount }]);
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

  /** 全部做完：落一次 session 记录 */
  useEffect(() => {
    if (idx < article.sentences.length || savedRef.current) return;
    savedRef.current = true;
    const attempts = article.sentences.map((s, i) => ({
      word: s.en.slice(0, 60),
      correct: results[i]?.ok ?? false,
      mistakes: results[i]?.mistakes ?? 0,
      ms: 1,
      bankId: `article:${article.id}`,
    }));
    void saveSession({
      mode: 'typing',
      bankId: `article:${article.id}`,
      startedAt,
      endedAt: Date.now(),
      attempts,
    });
  }, [idx, article, results, startedAt]);

  if (finished) {
    const ok = results.filter((r) => r.ok).length;
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-correct/15 text-correct">
          <IconCheck width={24} height={24} />
        </div>
        <h1 className="text-lg font-semibold text-ink">{article.title} · 完成</h1>
        <p className="mt-1 text-sm text-muted">
          一次打对 {ok} / {results.length} 句
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIdx(0);
              setInput('');
              setSubmitted(false);
              setResults([]);
            }}
            className="tf-btn tf-btn-primary text-xs"
          >
            <IconRefresh width={14} height={14} />
            再来一遍
          </button>
          <button type="button" onClick={onExit} className="tf-btn text-xs">
            换一篇
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
          返回列表
        </button>
        <div className="flex items-center gap-2">
          <Segmented<ArticleMode>
            value={mode}
            onChange={(m) => {
              setMode(m);
              setInput('');
              setSubmitted(false);
            }}
            size="sm"
            options={[
              { value: 'typing', label: '跟打' },
              { value: 'dictation', label: '听写' },
            ]}
          />
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
        <Progress value={(idx / article.sentences.length) * 100} />
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
          <span>
            {article.title} · 第 {idx + 1}/{article.sentences.length} 句
          </span>
          <span>{article.level}</span>
        </div>
      </div>

      {/* 目标句 */}
      <div className="tf-card mb-3 px-4 py-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="text-[11px] font-medium text-muted">目标句</div>
          <button
            type="button"
            onClick={() =>
              speak(sentence.en, { accent: settings.accent, rate: settings.speechRate })
            }
            className="rounded p-1 text-muted hover:text-accent"
            aria-label="朗读整句"
          >
            <IconVolume width={14} height={14} />
          </button>
        </div>

        {mode === 'typing' ? (
          <p className="tf-mono text-base leading-relaxed text-ink">{sentence.en}</p>
        ) : (
          <p className="text-sm text-muted">（听写模式：听发音，凭记忆写出整句）</p>
        )}

        {showZh && (
          <p className="mt-2 border-t border-line pt-2 text-xs leading-relaxed text-muted">
            {sentence.zh}
          </p>
        )}
      </div>

      {/* 输入区 */}
      <div className="tf-card mb-3 px-4 py-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
          <span>你的输入</span>
          {submitted && (
            <span className={mistakeCount === 0 ? 'text-correct' : 'text-error'}>
              {mistakeCount === 0 ? '完全正确' : `${mistakeCount} 处不一致`}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (submitted) next();
              else submit();
            }
            if (e.key === 'Tab') {
              e.preventDefault();
              if (submitted) next();
              else submit();
            }
          }}
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="在这里输入整句，Enter 提交…"
          className="tf-input tf-mono resize-none text-sm leading-relaxed"
        />
      </div>

      {/* 对比结果 */}
      {submitted && (
        <div className="tf-card mb-3 px-4 py-3">
          <div className="mb-2 text-[11px] font-medium text-muted">逐词对照</div>
          <div className="flex flex-wrap gap-x-1.5 gap-y-1.5">
            {wordDiff.map((d, i) => (
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
          {mistakeCount > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span>正确：</span>
              <span className="tf-mono text-correct">{sentence.en}</span>
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
            {idx + 1 >= article.sentences.length ? '完成' : '下一句'}
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
            {mistakeCount > 0 && <IconX width={13} height={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

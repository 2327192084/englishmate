/**
 * 文章练习页 —— 逐句跟打 / 默写，中英对照。
 *
 * 与单词练习的区别：长句逐字符校验体验差，所以这里用「整句提交 + 逐词着色」：
 * 用户输入完整句，回车提交，逐词对比正确/错误。
 *
 * 除了内置的 75 篇，用户还可以导入自己的文章（存 IndexedDB，见
 * `@/data/customArticles`）。自定义文章和内置文章在列表里合并展示，
 * 点进去走同一个 ArticlePlayer——练习逻辑不需要为自定义内容分叉。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ARTICLES } from '@/data/articles';
import {
  ARTICLE_LEVELS,
  ArticleImportError,
  deleteCustomArticle,
  listCustomArticles,
  normalizeLevel,
  parseArticleTextDetailed,
  readArticleFile,
  saveCustomArticle,
  titleFromFilename,
  type ArticleLevel,
} from '@/data/customArticles';
import type { Article, WordEntry } from '@/types';
import {
  loadArticleGlossary,
  lookupInGlossary,
  type ArticleGlossary,
} from '@/data/articleGlossary';
import { speak, stopSpeaking } from '@/lib/speech';
import { tokenizeForCompare } from '@/lib/text';
import { useSettings } from '@/store/settings';
import { playKeySound, playFinishSound } from '@/lib/sound';
import { saveSession } from '@/services/learning';
import { Segmented, Progress } from '@/components/ui';
import { WordDetail } from '@/components/WordDetail';
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconTrash,
  IconUpload,
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

  /** 用户自己导入的文章 */
  const [customs, setCustoms] = useState<Article[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 待确认的导入：解析完先给用户过一眼标题 / 难度，确认后才落库 */
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [importMsg, setImportMsg] = useState<ImportMessage | null>(null);

  const reloadCustoms = useCallback(async () => {
    setCustoms(await listCustomArticles());
  }, []);

  useEffect(() => {
    void reloadCustoms();
  }, [reloadCustoms]);

  /** 内置 + 自定义合并，自定义排前面（刚导入的容易找） */
  const all = useMemo(() => [...customs, ...ARTICLES], [customs]);
  /** 自定义文章的 id 集合：列表里要打标记 + 给删除按钮 */
  const customIds = useMemo(() => new Set(customs.map((a) => a.id)), [customs]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return all.filter((a) => {
      if (level !== '全部' && a.level !== level) return false;
      if (!kw) return true;
      return (
        a.title.toLowerCase().includes(kw) ||
        a.titleZh.includes(kw) ||
        a.author.toLowerCase().includes(kw)
      );
    });
  }, [all, level, q]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all) m.set(a.level, (m.get(a.level) ?? 0) + 1);
    return m;
  }, [all]);

  /**
   * 读文件 → 解析 → 进"确认"状态。
   * 解析在这一步就做掉，失败立刻反馈（尤其是 GBK 乱码），
   * 用户不会填完标题才被告知文件读不了。
   */
  const handleFile = async (file: File) => {
    setImportMsg(null);
    setPending(null);
    try {
      const { text, encoding } = await readArticleFile(file);
      const { article, warnings } = parseArticleTextDetailed(text, file.name);
      if (encoding === 'gbk') {
        warnings.unshift('检测到 GBK 编码，已自动转成 UTF-8（建议以后存成 UTF-8）。');
      }
      setPending({ article, warnings });
    } catch (e) {
      setImportMsg({
        tone: 'error',
        text:
          e instanceof ArticleImportError
            ? e.message
            : e instanceof Error
              ? `导入失败：${e.message}`
              : '导入失败',
      });
    }
  };

  /** 确认保存 */
  const confirmImport = async (draft: Article) => {
    try {
      await saveCustomArticle(draft);
      await reloadCustoms();
      setPending(null);
      setImportMsg({
        tone: 'ok',
        text: `已导入「${draft.title}」，共 ${draft.sentences.length} 句。`,
      });
    } catch (e) {
      setImportMsg({
        tone: 'error',
        text: e instanceof Error ? `保存失败：${e.message}` : '保存失败',
      });
    }
  };

  const removeArticle = async (a: Article) => {
    if (!window.confirm(`删除自定义文章「${a.title}」？已练过的记录会保留。`)) return;
    await deleteCustomArticle(a.id);
    await reloadCustoms();
    setImportMsg({ tone: 'ok', text: `已删除「${a.title}」。` });
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">文章练习</h1>
        <p className="mt-1 text-sm text-muted">
          共 {all.length} 篇（{ARTICLES.length} 篇内置
          {customs.length > 0 ? ` · ${customs.length} 篇自定义` : ''}）·
          逐句跟打或听写，把词汇放进真实语境里记
        </p>
      </header>

      {/* 导入入口 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="tf-btn text-xs">
          <IconUpload width={14} height={14} />
          导入文章
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.json,.tsv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <span className="text-[11px] text-muted">
          支持双语对照 .txt / .md、纯英文文本，或带 sentences 的 .json
        </span>
      </div>

      {importMsg && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
            importMsg.tone === 'ok'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-error/40 bg-error/10 text-error'
          }`}
        >
          {importMsg.text}
        </div>
      )}

      {pending && (
        <ImportConfirm
          draft={pending.article}
          warnings={pending.warnings}
          onCancel={() => setPending(null)}
          onConfirm={(a) => void confirmImport(a)}
        />
      )}

      {/* 难度筛选 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {LEVELS.map((lv) => {
          const active = level === lv;
          const n = lv === '全部' ? all.length : (counts.get(lv) ?? 0);
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
          <div
            key={a.id}
            className="tf-card group flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:border-accent/60"
          >
            <button type="button" onClick={() => onPick(a)} className="min-w-0 flex-1 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{a.title}</span>
                {a.titleZh && <span className="text-[11px] text-muted">· {a.titleZh}</span>}
                {customIds.has(a.id) && (
                  <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-px text-[10px] text-accent">
                    自定义
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">
                {a.author} · {a.sentences.length} 句
              </div>
              <div className="mt-1 text-[11px] text-muted/60">{a.source}</div>
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="tf-chip">{a.level}</span>
              {customIds.has(a.id) ? (
                <button
                  type="button"
                  onClick={() => void removeArticle(a)}
                  className="rounded p-1 text-muted hover:text-error"
                  aria-label={`删除 ${a.title}`}
                  title="删除这篇自定义文章"
                >
                  <IconTrash width={14} height={14} />
                </button>
              ) : (
                <IconArrowRight
                  width={15}
                  height={15}
                  className="text-muted group-hover:text-accent"
                />
              )}
            </div>
          </div>
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

/** 一条导入反馈 */
interface ImportMessage {
  tone: 'ok' | 'error';
  text: string;
}

/** 解析完成、等用户确认的草稿 */
interface PendingImport {
  article: Article;
  warnings: string[];
}

/**
 * 导入确认表单：让用户改标题 / 难度，并预览前几句。
 * 文件名推断出来的标题、难度只是默认值，用户可以改。
 */
function ImportConfirm({
  draft,
  warnings,
  onCancel,
  onConfirm,
}: {
  draft: Article;
  warnings: string[];
  onCancel: () => void;
  onConfirm: (a: Article) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [titleZh, setTitleZh] = useState(draft.titleZh);
  const [level, setLevel] = useState<ArticleLevel>(normalizeLevel(draft.level));

  /** 标题被清空时退回文件名推断值，避免存出无名文章 */
  const finalTitle = title.trim() || titleFromFilename(draft.source);

  return (
    <div className="tf-card mb-3 px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">确认导入</span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-muted hover:text-ink"
          aria-label="取消导入"
        >
          <IconX width={14} height={14} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-[11px] text-muted">英文标题</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="tf-input text-sm"
            placeholder="文章标题"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] text-muted">中文标题（可留空）</span>
          <input
            value={titleZh}
            onChange={(e) => setTitleZh(e.target.value)}
            className="tf-input text-sm"
            placeholder="中文标题"
          />
        </label>
      </div>

      <div className="mt-2 grid gap-1">
        <span className="text-[11px] text-muted">难度</span>
        <div className="flex flex-wrap gap-1.5">
          {ARTICLE_LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel(lv)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                level === lv
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              {lv}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-line bg-surface2/50 px-3 py-2">
        <div className="text-[11px] text-muted">共 {draft.sentences.length} 句 · 预览前 3 句</div>
        <div className="mt-1 grid gap-1">
          {draft.sentences.slice(0, 3).map((s, i) => (
            <div key={i} className="text-[11px] leading-relaxed">
              <div className="tf-mono text-ink">{s.en}</div>
              {s.zh && <div className="text-muted">{s.zh}</div>}
            </div>
          ))}
        </div>
      </div>

      {warnings.length > 0 && (
        <ul className="mt-2 grid gap-0.5 text-[11px] text-amber-400">
          {warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="tf-btn text-xs">
          取消
        </button>
        <button
          type="button"
          onClick={() =>
            onConfirm({
              ...draft,
              title: finalTitle,
              titleZh: titleZh.trim(),
              level,
            })
          }
          className="tf-btn tf-btn-primary text-xs"
        >
          <IconCheck width={14} height={14} />
          保存到我的文章
        </button>
      </div>
    </div>
  );
}

/**
 * 可点词的目标句。
 *
 * 点词查释义是「增强」而非「必需」：释义表没加载完 / 加载失败 / 这个词
 * 本来就没收录（古语 hath、专名 Stanford）时，一律渲染成普通文本，
 * 不加下划线和手型，避免点了没反应。
 *
 * 用 span 而不是 button 包每个词：一屏几十个词，几十个 button 会拖慢
 * 键盘 Tab 焦点漫游（用户按 Tab 是想切到输入框，不是逐词漫游）。
 * 所以可点的词给 role="button" + tabIndex={-1}，只响应鼠标与触摸。
 */
function ClickableSentence({
  text,
  glossary,
  onPick,
}: {
  text: string;
  glossary: ArticleGlossary | null;
  onPick: (entry: WordEntry) => void;
}) {
  const parts = useMemo(() => {
    if (!glossary) return null;
    // 按空白切分但保留原始分隔符，拼回去时与原文逐字一致
    const tokens = text.split(/(\s+)/);
    return tokens.map((token) => {
      if (!token.trim()) return { token, entry: null as WordEntry | null };
      return { token, entry: lookupInGlossary(glossary, token) };
    });
  }, [text, glossary]);

  if (!parts) return <>{text}</>;

  return (
    <>
      {parts.map(({ token, entry }, i) =>
        entry ? (
          <span
            key={i}
            role="button"
            tabIndex={-1}
            title={`${entry.w} ${entry.t}`}
            onClick={(e) => {
              e.stopPropagation();
              onPick(entry);
            }}
            className="cursor-pointer rounded-sm decoration-dotted underline-offset-4 hover:bg-accent/10 hover:text-accent hover:underline"
          >
            {token}
          </span>
        ) : (
          <span key={i}>{token}</span>
        ),
      )}
    </>
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
  const [glossary, setGlossary] = useState<ArticleGlossary | null>(null);
  const [picked, setPicked] = useState<WordEntry | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const savedRef = useRef(false);

  // 点词释义表：进文章就开始下，没下完也不挡练习（词先当普通文本）
  useEffect(() => {
    let alive = true;
    void loadArticleGlossary().then((g) => {
      if (alive) setGlossary(g);
    });
    return () => {
      alive = false;
    };
  }, []);

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
          <p className="tf-mono text-base leading-relaxed text-ink">
            <ClickableSentence text={sentence.en} glossary={glossary} onPick={setPicked} />
          </p>
        ) : (
          <p className="text-sm text-muted">（听写模式：听发音，凭记忆写出整句）</p>
        )}

        {glossary && mode === 'typing' && (
          <div className="mt-1.5 text-[11px] text-muted/70">点句中的单词可查释义</div>
        )}

        {showZh && sentence.zh && (
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

      {/* 点词查释义 */}
      <WordDetail
        entry={picked}
        open={picked !== null}
        onClose={() => setPicked(null)}
      />
    </div>
  );
}

/**
 * 词库页：管理和浏览词库，导入自定义词库，查看错词本 / 收藏 / 已掌握。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CustomBank } from '@/db';
import { listCustomBanks, loadBankIndex, CATEGORY_LABEL, invalidateCache } from '@/data/wordbanks';
import type { MistakeKind, UserWord, WordbankMeta, WordEntry } from '@/types';
import { Chip, EmptyState, Segmented, Skeleton } from '@/components/ui';
import { IconBook, IconStar, IconTrash, IconUpload, IconVolume } from '@/components/Icons';
import { speak } from '@/lib/speech';
import { useSettings } from '@/store/settings';
import {
  MISTAKE_KINDS,
  MISTAKE_KIND_LABELS,
  dominantMistakeKind,
  hasMistakeData,
} from '@/lib/mistakeKind';

type Tab = 'banks' | 'wrong' | 'favorite' | 'mastered';

export default function WordsPage() {
  const [tab, setTab] = useState<Tab>('banks');
  /**
   * 内置词库数量。
   *
   * 原来这里硬编码 `内置 {8} 个词库`，词库扩到 16 个后文案就一直错着——
   * 写死数字必然随数据变化而失真。改为从 index.json 动态读，
   * 未加载完成时显示为空（不显示错误的数字比显示错误数字好）。
   */
  const [builtinCount, setBuiltinCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void loadBankIndex().then((idx) => {
      if (alive) setBuiltinCount(idx.banks.length);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">词库</h1>
        <p className="mt-1 text-sm text-muted">
          {builtinCount === null ? '加载中…' : `内置 ${builtinCount} 个词库`}，也可导入自己的词表
        </p>
      </header>

      <div className="mb-5">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'banks', label: '全部词库' },
            { value: 'wrong', label: '错词本' },
            { value: 'favorite', label: '收藏' },
            { value: 'mastered', label: '已掌握' },
          ]}
        />
      </div>

      {tab === 'banks' ? <BanksTab /> : <WordListTab tab={tab} />}
    </div>
  );
}

function BanksTab() {
  const [banks, setBanks] = useState<WordbankMeta[] | null>(null);
  const userWords = useLiveQuery(() => db.userWords.toArray(), [], []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const load = async () => {
    const [idx, custom] = await Promise.all([loadBankIndex(), listCustomBanks()]);
    setBanks([...idx.banks, ...custom]);
  };

  useEffect(() => {
    void load();
  }, []);

  const progress = useMemo(() => {
    const map = new Map<string, { learned: number; mastered: number }>();
    for (const w of userWords ?? []) {
      const cur = map.get(w.bankId) ?? { learned: 0, mastered: 0 };
      cur.learned += 1;
      if (w.mastered) cur.mastered += 1;
      map.set(w.bankId, cur);
    }
    return map;
  }, [userWords]);

  /** 导入格式：每行 "word<TAB 或逗号>释义[<TAB>音标]"，也接受 JSON 数组 */
  const handleFile = async (file: File) => {
    setImportMsg(null);
    try {
      const text = await file.text();
      let words: WordEntry[] = [];
      const trimmed = text.trim();

      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed) as
          WordEntry[] | { words?: WordEntry[] } | { list?: { name: string; trans?: string[] }[] };
        if (Array.isArray(parsed)) {
          words = parsed.map(normalizeEntry).filter((w): w is WordEntry => !!w);
        } else if ('words' in parsed && Array.isArray(parsed.words)) {
          words = parsed.words.map(normalizeEntry).filter((w): w is WordEntry => !!w);
        } else if ('list' in parsed && Array.isArray(parsed.list)) {
          // 兼容 Qwerty Learner 的原始格式
          words = parsed.list
            .map((it) => normalizeEntry({ w: it.name, t: (it.trans ?? []).join('；') }))
            .filter((w): w is WordEntry => !!w);
        }
      } else {
        words = trimmed
          .split(/\r?\n/)
          .map((line) => {
            const parts = line.split(/\t|,(?=[^\t]*$)/);
            const w = (parts[0] ?? '').trim();
            const t = (parts[1] ?? '').trim();
            const p = (parts[2] ?? '').trim();
            return normalizeEntry({ w, t, p: p || undefined });
          })
          .filter((w): w is WordEntry => !!w);
      }

      if (words.length === 0) {
        setImportMsg('没有解析出有效词条，请检查文件格式。');
        return;
      }

      const id = `u${Date.now().toString(36)}`;
      const bank: CustomBank = {
        id,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '自定义词库',
        description: `导入自 ${file.name}`,
        createdAt: Date.now(),
        words,
      };
      await db.customBanks.put(bank);
      invalidateCache(`custom:${id}`);
      await load();
      setImportMsg(`已导入 ${words.length} 个词条。`);
    } catch (e) {
      setImportMsg(e instanceof Error ? `导入失败：${e.message}` : '导入失败');
    }
  };

  const removeBank = async (meta: WordbankMeta) => {
    if (!meta.id.startsWith('custom:')) return;
    if (!window.confirm(`删除词库「${meta.name}」？已学的记录会保留。`)) return;
    await db.customBanks.delete(meta.id.slice('custom:'.length));
    await load();
  };

  if (!banks) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => fileRef.current?.click()} className="tf-btn text-xs">
          <IconUpload width={14} height={14} />
          导入自定义词库
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.tsv,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <span className="text-[11px] text-muted">
          支持 .txt / .csv / .tsv（每行 <code className="text-muted">word,释义</code>）与 .json
        </span>
      </div>

      {importMsg && (
        <div className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          {importMsg}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {banks.map((b) => {
          const prog = progress.get(b.id) ?? { learned: 0, mastered: 0 };
          const pct = b.count ? Math.round((prog.learned / b.count) * 100) : 0;
          const isCustom = b.id.startsWith('custom:');
          return (
            <div key={b.id} className="tf-card group flex flex-col gap-2 px-3.5 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-ink">{b.name}</span>
                    {isCustom && <Chip>自定义</Chip>}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">
                    {b.description}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    to={`/practice?bank=${encodeURIComponent(b.id)}`}
                    className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10"
                  >
                    练
                  </Link>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => void removeBank(b)}
                      className="rounded p-1 text-muted opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                      aria-label="删除词库"
                    >
                      <IconTrash width={13} height={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <span className="tf-mono shrink-0 text-[10px] tabular-nums text-muted">
                  {prog.learned}/{b.count}
                </span>
              </div>
              <div className="text-[10px] text-muted/60">{CATEGORY_LABEL[b.category]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WordListTab({ tab }: { tab: 'wrong' | 'favorite' | 'mastered' }) {
  const settings = useSettings((s) => s.settings);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  /**
   * 错词本的错误类型筛选。
   *
   * 只做筛选不做分组列表：错词本还要按错误数排序、还要能搜索，
   * 一旦按类型拆成多个列表，同一个词出现在几处、点进点出会乱。
   * 筛一下就能回答用户真正的问题——「我的邻键失误是哪些词」。
   */
  const [kind, setKind] = useState<'all' | MistakeKind>('all');

  const rows = useLiveQuery(
    async () => {
      const all = await db.userWords.toArray();
      if (tab === 'wrong') {
        return all
          .filter((w) => w.mistakes > 0 && !w.mastered)
          .sort((a, b) => b.mistakes - a.mistakes);
      }
      if (tab === 'favorite')
        return all.filter((w) => w.favorite).sort((a, b) => b.updatedAt - a.updatedAt);
      return all.filter((w) => w.mastered).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [tab],
    [],
  );

  /** 错词本里各类错误的总数分布，用于筛选按钮上的计数 */
  const kindTally = useMemo(() => {
    const tally = { order: 0, adjacent: 0, similar: 0, unrelated: 0, unclassified: 0 };
    for (const w of rows ?? []) {
      if (!hasMistakeData(w.mistakeKinds)) {
        // 老记录（本功能上线前）没有分类数据，单独计数，不硬塞进某一类
        if (w.mistakes > 0) tally.unclassified += 1;
        continue;
      }
      tally[dominantMistakeKind(w.mistakeKinds) as MistakeKind] += 1;
    }
    return tally;
  }, [rows]);

  /** 有分类数据的词数（不含旧记录），决定要不要显示筛选条 */
  const totalClassified = useMemo(
    () => kindTally.order + kindTally.adjacent + kindTally.similar + kindTally.unrelated,
    [kindTally],
  );

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const byKind =
      tab === 'wrong' && kind !== 'all'
        ? list.filter((w) => dominantMistakeKind(w.mistakeKinds) === kind)
        : list;
    if (!q.trim()) return byKind;
    const lower = q.trim().toLowerCase();
    return byKind.filter(
      (w) => w.word.toLowerCase().includes(lower) || w.trans.toLowerCase().includes(lower),
    );
  }, [rows, q, tab, kind]);

  if (!rows) return <Skeleton className="h-40" />;

  if (rows.length === 0) {
    const copy = {
      wrong: {
        title: '错词本是空的',
        hint: '练习中打错或答错的词会自动收进这里，并优先出现在后续练习中。',
      },
      favorite: {
        title: '还没有收藏',
        hint: '在词条上点星标即可收藏，收藏的词会优先复习。',
      },
      mastered: {
        title: '还没有已掌握的词',
        hint: '在词条上点「已掌握」即可标记，之后不再出现在新词队列里。',
      },
    }[tab];
    return (
      <EmptyState
        icon={<IconBook width={32} height={32} />}
        title={copy.title}
        hint={copy.hint}
        action={
          <Link to="/practice" className="tf-btn tf-btn-primary mt-2 text-xs">
            去练习
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索单词或释义…"
          className="tf-input max-w-xs"
        />
        <span className="tf-mono text-xs text-muted">{filtered.length} 条</span>
      </div>

      {tab === 'wrong' && totalClassified > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setKind('all')}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                kind === 'all'
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              全部 <span className="tf-mono tabular-nums">{rows.length}</span>
            </button>
            {MISTAKE_KINDS.map((k) => {
              const meta = MISTAKE_KIND_LABELS[k];
              const n = kindTally[k];
              return (
                <button
                  key={k}
                  type="button"
                  title={`${meta.hint}。${meta.advice}`}
                  onClick={() => setKind(k)}
                  disabled={n === 0}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    kind === k
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-line text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40'
                  }`}
                >
                  {meta.name} <span className="tf-mono tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed text-muted/80">
            {kind === 'all'
              ? `按最主要的错误类型分组，共 ${totalClassified} 个词有分类数据${
                  kindTally.unclassified > 0
                    ? `；另有 ${kindTally.unclassified} 个词是旧记录，还没记录错误类型`
                    : ''
                }。`
              : MISTAKE_KIND_LABELS[kind].advice}
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="max-h-[65vh] divide-y divide-line overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-muted">
              这一类里还没有词。换个类型，或者继续练习积累数据。
            </p>
          )}
          {filtered.slice(0, limit).map((w) => (
            <WordRow key={w.id} uw={w} accent={settings.accent} />
          ))}
        </div>
      </div>
      {filtered.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 100)}
          className="tf-btn mt-3 w-full text-xs"
        >
          加载更多（还剩 {filtered.length - limit} 条）
        </button>
      )}
    </div>
  );
}

function WordRow({ uw, accent }: { uw: UserWord; accent: 'en-US' | 'en-GB' }) {
  const toggle = async (field: 'favorite' | 'mastered') => {
    await db.userWords.put({ ...uw, [field]: !uw[field], updatedAt: Date.now() });
  };
  /**
   * 错误类型明细，只显示计数大于 0 的类别。
   * 排序按 MISTAKE_KINDS 固定顺序，不按数量——位置固定才好扫视，
   * 每行都在动的话反而看不出规律。
   */
  const kinds = uw.mistakeKinds
    ? MISTAKE_KINDS.filter((k) => (uw.mistakeKinds?.[k] ?? 0) > 0).map((k) => ({
        kind: k,
        count: uw.mistakeKinds?.[k] ?? 0,
        meta: MISTAKE_KIND_LABELS[k],
      }))
    : [];
  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface2/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="tf-mono text-sm font-medium text-ink">{uw.word}</span>
          {uw.phonetic && <span className="tf-mono text-[10px] text-muted/70">{uw.phonetic}</span>}
        </div>
        <div className="truncate text-[11px] text-muted">{uw.trans}</div>
        {kinds.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {kinds.map(({ kind, count, meta }) => (
              <span
                key={kind}
                title={`${meta.hint}。${meta.advice}`}
                className="rounded-full border border-line/70 bg-surface2/60 px-1.5 py-0.5 text-[10px] text-muted"
              >
                {meta.name}
                <span className="tf-mono ml-0.5 tabular-nums">{count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {uw.mistakes > 0 && (
          <span className="tf-mono mr-1 text-[10px] tabular-nums text-error">{uw.mistakes}✗</span>
        )}
        <button
          type="button"
          onClick={() => speak(uw.word, { accent })}
          className="rounded p-1.5 text-muted hover:text-accent"
          aria-label="朗读"
        >
          <IconVolume width={13} height={13} />
        </button>
        <button
          type="button"
          onClick={() => void toggle('favorite')}
          className={`rounded p-1.5 ${uw.favorite ? 'text-amber-400' : 'text-muted hover:text-amber-400'}`}
          aria-label="收藏"
        >
          <IconStar width={13} height={13} fill={uw.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          onClick={() => void toggle('mastered')}
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            uw.mastered ? 'text-correct' : 'text-muted hover:text-correct'
          }`}
        >
          {uw.mastered ? '已掌握' : '标记掌握'}
        </button>
      </div>
    </div>
  );
}

/** 规范化一条导入的词条，字段缺失或非法返回 null */
function normalizeEntry(raw: unknown): WordEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const w = String(r.w ?? r.name ?? r.word ?? '').trim();
  if (!w || w.length > 64) return null;
  let t = '';
  if (typeof r.t === 'string') t = r.t;
  else if (Array.isArray(r.trans)) t = r.trans.map(String).join('；');
  else if (typeof r.translation === 'string') t = r.translation;
  t = t.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  const p = typeof r.p === 'string' && r.p.trim() ? r.p.trim() : undefined;
  return { w, t, ...(p ? { p } : {}) };
}

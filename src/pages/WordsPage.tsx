/**
 * 词库页：管理和浏览词库，导入自定义词库，查看错词本 / 收藏 / 已掌握。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CustomBank } from '@/db';
import { listCustomBanks, loadBankIndex, CATEGORY_LABEL, invalidateCache } from '@/data/wordbanks';
import type { UserWord, WordbankMeta, WordEntry } from '@/types';
import { Chip, EmptyState, Segmented, Skeleton } from '@/components/ui';
import { IconBook, IconStar, IconTrash, IconUpload, IconVolume } from '@/components/Icons';
import { speak } from '@/lib/speech';
import { useSettings } from '@/store/settings';

type Tab = 'banks' | 'wrong' | 'favorite' | 'mastered';

export default function WordsPage() {
  const [tab, setTab] = useState<Tab>('banks');

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ink">词库</h1>
        <p className="mt-1 text-sm text-muted">内置 {8} 个词库，也可导入自己的词表</p>
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

  const filtered = useMemo(() => {
    const list = rows ?? [];
    if (!q.trim()) return list;
    const lower = q.trim().toLowerCase();
    return list.filter(
      (w) => w.word.toLowerCase().includes(lower) || w.trans.toLowerCase().includes(lower),
    );
  }, [rows, q]);

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

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="max-h-[65vh] divide-y divide-line overflow-y-auto">
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
  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface2/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="tf-mono text-sm font-medium text-ink">{uw.word}</span>
          {uw.phonetic && <span className="tf-mono text-[10px] text-muted/70">{uw.phonetic}</span>}
        </div>
        <div className="truncate text-[11px] text-muted">{uw.trans}</div>
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

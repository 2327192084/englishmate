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
import {
  IconArrowRight,
  IconBook,
  IconDownload,
  IconStar,
  IconTrash,
  IconUpload,
  IconVolume,
} from '@/components/Icons';
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
  /** 众包入口的操作提示，与导入提示分开，避免互相覆盖 */
  const [contribMsg, setContribMsg] = useState<string | null>(null);

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

  /**
   * 把自定义词库转成官方词库的贡献格式（public/dicts/<id>.json 的结构）。
   *
   * 只做纯数据转换，不碰 DOM —— 这样「导出」和「提交」两条路共用同一份产物，
   * 也方便单测直接对比结果。真正触发下载由 downloadJson 负责。
   */
  const buildContribution = async (meta: WordbankMeta): Promise<WordContributionExport> => {
    const rawId = meta.id.slice('custom:'.length);
    const row = await db.customBanks.get(rawId);
    if (!row) throw new Error('词库数据已不存在，可能刚被删除');
    return toWordContribution(row, meta);
  };

  /** 导出为贡献格式并触发浏览器下载 */
  const handleExportContribution = async (meta: WordbankMeta) => {
    setContribMsg(null);
    try {
      const contribution = await buildContribution(meta);
      downloadJson(contribution.json, contribution.fileName);
      setContribMsg(
        `已导出 ${contribution.meta.count} 个词条，可提交到 GitHub Issues 或放进 public/dicts/。` +
          (contribution.warnings.length ? ` 注意：${contribution.warnings.join('；')}` : ''),
      );
    } catch (e) {
      setContribMsg(e instanceof Error ? `导出失败：${e.message}` : '导出失败');
    }
  };

  /** 拼一个预填好标题/正文的 GitHub Issue 并打开（不经过任何后端） */
  const handleSubmitToGitHub = async (meta: WordbankMeta) => {
    setContribMsg(null);
    try {
      const contribution = await buildContribution(meta);
      const url = buildIssueUrl(contribution);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      // 被弹窗拦截时给出可点击的备用提示，而不是静默失败
      if (!win) {
        setContribMsg(`提交页被浏览器拦截了，请手动打开：${url}`);
        return;
      }
      // Issue 正文里请用户粘贴 JSON，所以这里顺手把文件也导出到下载目录
      downloadJson(contribution.json, contribution.fileName);
      setContribMsg(
        `已打开 GitHub 提交页，同时导出了 JSON 文件（${contribution.fileName}），` +
          '请把文件内容粘贴进 Issue 正文的代码块里。',
      );
    } catch (e) {
      setContribMsg(e instanceof Error ? `打开提交页失败：${e.message}` : '打开提交页失败');
    }
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

      {contribMsg && (
        <div className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          {contribMsg}
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

              {/* 众包入口：只有自定义词库能导出回馈社区，内置词库的来源已固定 */}
              {isCustom && (
                <div className="flex flex-wrap items-center gap-1 border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => void handleExportContribution(b)}
                    className="tf-btn px-2 py-1 text-[10px]"
                    title="导出成可直接提交给官方的词库 JSON"
                  >
                    <IconDownload width={11} height={11} />
                    导出为贡献格式
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmitToGitHub(b)}
                    className="tf-btn px-2 py-1 text-[10px]"
                    title="在 GitHub 上开一个 Issue，附上导出的 JSON"
                  >
                    <IconArrowRight width={11} height={11} />
                    提交到 GitHub
                  </button>
                </div>
              )}
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

/* ------------------------- 词库众包：导出与提交 -------------------------
 *
 * 用户自己攒的词表往往是最有价值的贡献源，但导入后只能自己用。
 * 这里把自定义词库转成**官方词库的贡献格式**（public/dicts/<id>.json 的结构），
 * 再借 GitHub Issues 当提交入口——不需要自建后端。
 *
 * 下面的函数全部是纯函数（除了 downloadIssue/downloadJson 这类 DOM 操作），
 * 目的是让「导出的文件能不能过 scripts/verify-data.mjs」这件事可被直接验证。
 */

/**
 * 贡献文件的结构，必须与 public/dicts/<id>.json 完全一致。
 *
 * 注意 meta 的**字段集合与顺序**都是硬约束：
 * - 字段集合：verify-data.mjs 要求恰好是 category/count/description/id/name/source 六个；
 * - 字段顺序：index.json 里的 bank 条目要和单文件 meta 做 JSON.stringify 全等比较，
 *   所以两边必须用同一套插入顺序（本顺序与现有 16 个词库一致）。
 */
export interface WordContributionFile {
  meta: WordbankMeta;
  words: WordEntry[];
}

/** 一次导出的完整产物：文件对象 + 文本 + 建议文件名 + 给用户的提醒 */
export interface WordContributionExport {
  meta: WordbankMeta;
  file: WordContributionFile;
  json: string;
  fileName: string;
  /** 会导致 CI 红灯或维护者退回的问题，导出时直接告诉用户 */
  warnings: string[];
}

/**
 * 贡献文件的 source 文案。
 *
 * 必须同时满足 scripts/verify-data.mjs 的两条硬检查（该脚本只读、不能改）：
 *   1. 含 `qwerty learner`（大小写不敏感）——沿用上游词库的格式与字段规范；
 *   2. 含半角 `(MIT)` ——许可必须标清楚。
 * 所以这里既写明「用户贡献」这个真实出处，也说明格式继承自 Qwerty Learner。
 */
const CONTRIBUTION_SOURCE = '用户贡献 (MIT) · 词库格式与字段规范沿用 Qwerty Learner (MIT)';

/** 词条数下限，与 verify-data.mjs 的 MIN_WORDS 保持一致 */
const MIN_CONTRIBUTION_WORDS = 100;

/**
 * 生成贡献用的词库 id（同时也是文件名）。
 *
 * verify-data.mjs 会断言 meta.id 与文件名一致，且文件按 `<id>.json` 拼路径，
 * 所以这里只产 ASCII 小写字母/数字/连字符；纯中文名生成不出 ASCII 时
 * 退回词库的本地主键（DB 里天然唯一）。
 */
export function contributionIdFor(bank: CustomBank): string {
  const ascii = bank.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const raw = ascii.length >= 2 ? `user-${ascii}` : `user-${bank.id}`;
  return (
    raw
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'user-custom'
  );
}

/** 音标是否满足 verify-data.mjs 的要求：形如 /…/ 且长度 ≥ 3 */
function isVerifiedPhonetic(p: string): boolean {
  return p.length >= 3 && p.startsWith('/') && p.endsWith('/');
}

/**
 * 把一条自定义词条清洗成合法词条；不合法返回 null。
 *
 * 对应 verify-data.mjs 的逐条检查：w 非空且首尾无空白、长度 ≤ 64、不含换行、
 * t 非空、p 要么省略要么形如 /…/。
 */
function cleanWordEntry(word: { w: string; t: string; p?: string }): WordEntry | null {
  const w = String(word?.w ?? '').trim();
  const t = String(word?.t ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!w || w.length > 64 || /[\r\n]/.test(w)) return null;
  if (!t) return null;
  const p = typeof word?.p === 'string' ? word.p.trim() : '';
  // 音标不合规就丢掉这个字段，而不是让整份文件校验失败
  return { w, t, ...(isVerifiedPhonetic(p) ? { p } : {}) };
}

/**
 * 自定义词库 → 贡献格式（纯函数，不碰 DOM / 数据库）。
 *
 * 负责三件事：去重（大小写不敏感）、清洗非法词条、按契约填好 meta。
 */
export function toWordContribution(bank: CustomBank, meta: WordbankMeta): WordContributionExport {
  const seen = new Set<string>();
  const words: WordEntry[] = [];
  let dropped = 0;

  for (const raw of bank.words ?? []) {
    const entry = cleanWordEntry(raw);
    if (!entry) {
      dropped += 1;
      continue;
    }
    const key = entry.w.toLowerCase();
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    words.push(entry);
  }

  const id = contributionIdFor(bank);
  const contributionMeta: WordbankMeta = {
    id,
    name: (meta.name || bank.name || '用户贡献词库').trim().slice(0, 60),
    category: 'basic',
    description:
      (meta.description || bank.description || `用户贡献的 ${words.length} 词词表`)
        .trim()
        .slice(0, 200) || `用户贡献的 ${words.length} 词词表`,
    count: words.length,
    source: CONTRIBUTION_SOURCE,
  };

  const file: WordContributionFile = { meta: contributionMeta, words };

  const warnings: string[] = [];
  if (dropped > 0) warnings.push(`已丢弃 ${dropped} 条重复或不合规的词条`);
  if (words.length < MIN_CONTRIBUTION_WORDS) {
    warnings.push(
      `只有 ${words.length} 个词条，低于官方下限 ${MIN_CONTRIBUTION_WORDS}，` +
        `直接合并会校验失败（更适合作为内容补充提交）`,
    );
  }

  return {
    meta: contributionMeta,
    file,
    // 2 空格缩进 + 结尾换行：便于维护者 review 与 git diff
    json: `${JSON.stringify(file, null, 2)}\n`,
    fileName: `${id}.json`,
    warnings,
  };
}

/** 用 Blob + createObjectURL 触发下载（与 SettingsPage 的备份导出同一套写法） */
function downloadJson(json: string, fileName: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** 项目 Issues 新建页，正文用 query 预填，不需要任何后端 */
const ISSUE_NEW_URL = 'https://github.com/2327192084/englishmate/issues/new';

/**
 * 拼 GitHub Issue 的预填 URL。
 *
 * 正文里必须写清词库名与词条数（便于维护者先判断价值），
 * 并明确提示用户把导出的 JSON **粘贴在下面**——Issue 正文无法附件上传文件内容。
 */
export function buildIssueUrl(contribution: WordContributionExport): string {
  const { meta, warnings } = contribution;
  const lines = [
    `## 词库名`,
    meta.name,
    '',
    `## 词条数`,
    `${meta.count} 条`,
    '',
    `## 建议的 id 与文件名`,
    `public/dicts/${meta.id}.json`,
    '',
    `## 许可`,
    `本人原创或有权分发，同意以 MIT 许可并入本项目。`,
    '',
    `## 词库简介`,
    meta.description,
    '',
    ...(warnings.length ? ['## 自查提醒', ...warnings.map((w) => `- ${w}`), ''] : []),
    `## 请把导出的 JSON 文件内容粘贴在下面`,
    '',
    '```json',
    '（在这里粘贴 ' + contribution.fileName + ' 的全部内容）',
    '```',
    '',
    '> 导出的文件已按 public/dicts/<id>.json 的格式生成，`meta.count` 与 `words.length` 已对齐。',
  ];
  const title = `[词库贡献] ${meta.name}（${meta.count} 词）`;
  return `${ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

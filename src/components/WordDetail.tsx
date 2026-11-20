/**
 * 词条详情面板。
 *
 * 设计要点：**所有区块按字段存在性渲染**。
 * 我们的词库目前只有 w/t/p，所以现在打开只会看到释义；
 * 等富数据接进来（例句/短语/近义词），同一份代码自动显示新内容，
 * 不需要改这里。
 */
import { useEffect, useRef, useState } from 'react';
import type { WordEntry } from '@/types';
import { hasRichContent } from '@/types';
import { getFamily, getLookalike, isGraphLoaded, loadWordGraph } from '@/data/wordGraph';
import { speak } from '@/lib/speech';
import { useSettings } from '@/store/settings';
import { IconVolume, IconX } from './Icons';

export function WordDetail({
  entry,
  open,
  onClose,
}: {
  entry: WordEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const settings = useSettings((s) => s.settings);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 打开时把焦点移进面板，方便键盘用户
  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  /**
   * 词形变化与形近词来自独立的 word-graph.json（覆盖 1.5 万词）。
   * 这个文件是异步加载的，面板可能在它加载完之前就打开——
   * 所以这里等一次加载完成再取值，否则首次打开会显示空区块。
   *
   * 注意：**Hooks 必须放在任何提前 return 之前**。
   * 最初把这几个 Hook 写在 `if (!open || !entry) return null` 之后，
   * 导致「面板关闭时不调 Hook、打开时调 Hook」，React 直接抛 error #310
   * （Rendered more hooks than during the previous render）。
   */
  const [graphReady, setGraphReady] = useState(isGraphLoaded());
  useEffect(() => {
    if (graphReady) return;
    let alive = true;
    void loadWordGraph().then(() => {
      if (alive) setGraphReady(true);
    });
    return () => {
      alive = false;
    };
  }, [graphReady]);

  if (!open || !entry) return null;

  const family = graphReady ? getFamily(entry.w) : [];
  const lookalike = graphReady ? getLookalike(entry.w) : [];

  const rich = hasRichContent(entry);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.w} 的详细释义`}
        className="tf-card tf-fade-in max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 outline-none sm:rounded-2xl"
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="tf-mono text-2xl font-semibold text-ink">{entry.w}</span>
              <button
                type="button"
                onClick={() =>
                  speak(entry.w, { accent: settings.accent, rate: settings.speechRate })
                }
                className="rounded p-1 text-muted hover:bg-surface2 hover:text-accent"
                aria-label="朗读"
              >
                <IconVolume width={15} height={15} />
              </button>
            </div>
            {(entry.p || entry.pUk) && (
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                {entry.p && (
                  <span className="tf-mono">
                    <span className="mr-0.5 text-[10px] text-muted/60">美</span>
                    {entry.p}
                  </span>
                )}
                {entry.pUk && (
                  <span className="tf-mono">
                    <span className="mr-0.5 text-[10px] text-muted/60">英</span>
                    {entry.pUk}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded p-1.5 text-muted hover:bg-surface2 hover:text-ink"
            aria-label="关闭"
          >
            <IconX width={16} height={16} />
          </button>
        </div>

        {/* 释义 */}
        <Section title="释义">
          {entry.defs?.length ? (
            <ul className="space-y-1">
              {entry.defs.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="shrink-0 text-xs italic text-accent">{d.pos}</span>
                  <span className="text-ink">{d.cn}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-relaxed text-ink">{entry.t}</p>
          )}
        </Section>

        {/* 例句 */}
        {!!entry.sentences?.length && (
          <Section title="例句" count={entry.sentences.length}>
            <ul className="space-y-2.5">
              {entry.sentences.map((s, i) => (
                <li key={i} className="group">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        speak(s.en, { accent: settings.accent, rate: settings.speechRate })
                      }
                      className="mt-0.5 shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                      aria-label="朗读例句"
                    >
                      <IconVolume width={12} height={12} />
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed text-ink">
                        {highlightWord(s.en, entry.w)}
                      </p>
                      {s.zh && <p className="mt-0.5 text-xs leading-relaxed text-muted">{s.zh}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 短语 */}
        {!!entry.phrases?.length && (
          <Section title="短语" count={entry.phrases.length}>
            <ul className="space-y-1.5">
              {entry.phrases.map((p, i) => (
                <li key={i} className="text-sm">
                  <span className="text-ink">{p.en}</span>
                  {p.zh && <span className="ml-2 text-xs text-muted">{p.zh}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 近义词 */}
        {!!entry.synos?.length && (
          <Section title="近义词">
            <ul className="space-y-1.5">
              {entry.synos.map((s, i) => (
                <li key={i} className="text-sm">
                  <span className="mr-1.5 text-xs italic text-accent">{s.pos}</span>
                  <span className="tf-mono text-ink">{s.words.join(', ')}</span>
                  {s.cn && <span className="ml-2 text-xs text-muted">{s.cn}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* 词形变化与形近词 —— 来自 word-graph.json（ECDICT 挖掘） */}
        {family.length > 0 && (
          <Section title="词形变化" count={family.length}>
            <div className="flex flex-wrap gap-1.5">
              {family.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => speak(w, { accent: settings.accent, rate: settings.speechRate })}
                  className="tf-mono rounded bg-surface2 px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-accent"
                  title="点击朗读"
                >
                  {w}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted/70">
              同一词根的不同形式，拼写时容易混淆，建议一起记。
            </p>
          </Section>
        )}

        {lookalike.length > 0 && (
          <Section title="形近易混" count={lookalike.length}>
            <div className="flex flex-wrap gap-1.5">
              {lookalike.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => speak(w, { accent: settings.accent, rate: settings.speechRate })}
                  className="tf-mono rounded bg-amber-400/10 px-1.5 py-0.5 text-xs text-amber-400 transition-colors hover:bg-amber-400/20"
                  title="拼写相近，注意区分（点击朗读）"
                >
                  {w}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted/70">
              长得像但意思不同，是拼写错误的高发区。
            </p>
          </Section>
        )}

        {/* 同根词 */}
        {!!entry.relWords?.length && (
          <Section title="同根词">
            <div className="flex flex-wrap gap-1.5">
              {entry.relWords.map((w, i) => (
                <span
                  key={i}
                  className="tf-mono rounded bg-surface2 px-1.5 py-0.5 text-xs text-muted"
                >
                  {w}
                </span>
              ))}
            </div>
          </Section>
        )}

        {!rich && (
          <p className="mt-4 rounded-lg bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-muted">
            当前词库只提供基础释义。例句、短语等扩展内容将在接入更丰富的词库数据后显示。
          </p>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
        {count !== undefined && (
          <span className="ml-1 font-normal normal-case opacity-60">({count})</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** 把例句里的目标词加粗标色，便于快速定位 */
function highlightWord(sentence: string, word: string): React.ReactNode {
  if (!word) return sentence;
  // 按词边界匹配，避免 "art" 命中 "start"
  const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
  const parts = sentence.split(re);
  if (parts.length === 1) return sentence;
  return parts.map((part, i) =>
    re.test(part) && part.toLowerCase() === word.toLowerCase() ? (
      <strong key={i} className="font-semibold text-accent">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

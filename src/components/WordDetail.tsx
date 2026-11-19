/**
 * 词条详情面板。
 *
 * 设计要点：**所有区块按字段存在性渲染**。
 * 我们的词库目前只有 w/t/p，所以现在打开只会看到释义；
 * 等富数据接进来（例句/短语/近义词），同一份代码自动显示新内容，
 * 不需要改这里。
 */
import { useEffect, useRef } from 'react';
import type { WordEntry } from '@/types';
import { hasRichContent } from '@/types';
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

  if (!open || !entry) return null;

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

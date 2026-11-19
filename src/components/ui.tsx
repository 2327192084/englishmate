/** 通用小组件：标签、进度条、空状态、分段控件 */
import type { ReactNode } from 'react';

export function Chip({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'correct' | 'error' | 'warn';
}) {
  const toneCls =
    tone === 'accent'
      ? 'text-accent border-accent/40 bg-accent/10'
      : tone === 'correct'
        ? 'text-correct border-correct/40 bg-correct/10'
        : tone === 'error'
          ? 'text-error border-error/40 bg-error/10'
          : tone === 'warn'
            ? 'text-amber-400 border-amber-400/40 bg-amber-400/10'
            : '';
  return <span className={`tf-chip ${toneCls}`}>{children}</span>;
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface2 ${className}`}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-muted opacity-50">{icon}</div>}
      <div className="text-base font-medium text-ink">{title}</div>
      {hint && <div className="max-w-sm text-sm leading-relaxed text-muted">{hint}</div>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-surface2 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.hint}
            className={`rounded-md font-medium transition-colors ${
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
            } ${active ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatBlock({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="tf-card px-4 py-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tf-mono text-2xl font-semibold tabular-nums text-ink">{value}</span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

/** 骨架屏，加载词库时用 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface2 ${className}`} />;
}

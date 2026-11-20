/** 设置页：学习目标、发音、音效、主题、数据管理 */
import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, clearAllData, exportAllData, importAllData } from '@/db';
import { useSettings } from '@/store/settings';
import type { Accent } from '@/types';
import { DEFAULT_SHORTCUTS } from '@/types';
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  assignShortcut,
  assignableKeyError,
  formatKeyLabel,
  isDefaultShortcuts,
} from '@/lib/keys';
import { Segmented } from '@/components/ui';
import { IconDownload, IconRefresh, IconTrash, IconUpload, IconVolume } from '@/components/Icons';
import { canSpeak, speak } from '@/lib/speech';
import { playKeySound } from '@/lib/sound';

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const counts = useLiveQuery(
    async () => {
      const [w, s] = await Promise.all([db.userWords.count(), db.sessions.count()]);
      return { words: w, sessions: s };
    },
    [],
    { words: 0, sessions: 0 },
  );

  const flash = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setMsg({ text, tone });
    window.setTimeout(() => setMsg(null), 4000);
  };

  const handleExport = async () => {
    const json = await exportAllData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `englishmate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('已导出备份文件');
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const r = await importAllData(text);
      flash(`导入成功：${r.words} 个词、${r.sessions} 条记录`);
    } catch (e) {
      flash(e instanceof Error ? e.message : '导入失败', 'err');
    }
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空所有学习数据？此操作不可恢复，建议先导出备份。')) return;
    if (!window.confirm('再确认一次：所有学习进度、错词本、成就记录都会被删除。')) return;
    await clearAllData();
    flash('已清空所有学习数据');
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink">设置</h1>
        <p className="mt-1 text-sm text-muted">偏好保存在本地，换设备请用备份导入</p>
      </header>

      {msg && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            msg.tone === 'ok'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-error/40 bg-error/10 text-error'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* 学习目标 */}
      <Section title="学习目标" hint="决定每天给你排多少新词、复习上限">
        <Row label="每日新词目标" hint="10–100">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={settings.dailyNewTarget}
              onChange={(e) => void update({ dailyNewTarget: Number(e.target.value) })}
              className="w-32 accent-[rgb(var(--tf-accent))]"
            />
            <span className="tf-mono w-8 text-right text-sm tabular-nums text-ink">
              {settings.dailyNewTarget}
            </span>
          </div>
        </Row>
        <Row label="每轮词数" hint="10–50">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={settings.roundSize}
              onChange={(e) => void update({ roundSize: Number(e.target.value) })}
              className="w-32 accent-[rgb(var(--tf-accent))]"
            />
            <span className="tf-mono w-8 text-right text-sm tabular-nums text-ink">
              {settings.roundSize}
            </span>
          </div>
        </Row>
        <Row label="每日复习上限" hint="超过上限的到期词顺延">
          <input
            type="number"
            min={20}
            max={500}
            step={10}
            value={settings.dailyReviewLimit}
            onChange={(e) => void update({ dailyReviewLimit: Number(e.target.value) })}
            className="tf-input w-24 text-right"
          />
        </Row>
      </Section>

      {/* 发音 */}
      <Section title="发音" hint="使用浏览器内置语音合成，无需联网">
        <Row label="口音">
          <Segmented<Accent>
            value={settings.accent}
            onChange={(v) => void update({ accent: v })}
            size="sm"
            options={[
              { value: 'en-US', label: '美音' },
              { value: 'en-GB', label: '英音' },
            ]}
          />
        </Row>
        <Row label="语速" hint={`${Math.round(settings.speechRate * 100)}%`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={settings.speechRate}
              onChange={(e) => void update({ speechRate: Number(e.target.value) })}
              className="w-32 accent-[rgb(var(--tf-accent))]"
            />
            <button
              type="button"
              onClick={() =>
                speak('Vocabulary is the gateway to language.', {
                  accent: settings.accent,
                  rate: settings.speechRate,
                })
              }
              className="tf-btn text-xs"
            >
              <IconVolume width={13} height={13} />
              试听
            </button>
          </div>
        </Row>
        <Row label="自动发音" hint="进入每个词时自动朗读">
          <Toggle value={settings.autoSpeak} onChange={(v) => void update({ autoSpeak: v })} />
        </Row>
        {!canSpeak() && (
          <p className="text-[11px] text-amber-400">
            当前浏览器不支持语音合成，发音功能将不可用。建议使用 Chrome / Edge。
          </p>
        )}
      </Section>

      {/* 音效 */}
      <Section title="键盘" hint="音效由 Web Audio 实时合成，不加载音频文件">
        <Row label="键盘音效">
          <Toggle value={settings.keySound} onChange={(v) => void update({ keySound: v })} />
        </Row>
        <Row label="音效音量" hint={`${Math.round(settings.keyVolume * 100)}%`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.keyVolume}
              onChange={(e) => void update({ keyVolume: Number(e.target.value) })}
              className="w-32 accent-[rgb(var(--tf-accent))]"
            />
            <button
              type="button"
              onClick={() => playKeySound(settings.keyVolume, 'down')}
              className="tf-btn text-xs"
            >
              试听
            </button>
          </div>
        </Row>
        <Row label="严格纠错" hint="打错必须退格改对才能继续">
          <Toggle
            value={settings.strictCorrection}
            onChange={(v) => void update({ strictCorrection: v })}
          />
        </Row>
      </Section>

      {/* 快捷键 */}
      <Section
        title="练习快捷键"
        hint="只在练习界面生效（网页上的输入框里不受影响）；点按钮后按下想用的键"
      >
        {SHORTCUT_ACTIONS.map((action) => (
          <Row key={action} label={SHORTCUT_LABELS[action].label} hint={SHORTCUT_LABELS[action].hint}>
            <KeyCapture
              value={settings.shortcuts[action]}
              onPick={(key) => {
                const next = assignShortcut(settings.shortcuts, action, key);
                // 交换了别的动作的键位时明确告诉用户，否则他会发现另一个键悄悄变了
                const swapped = SHORTCUT_ACTIONS.filter(
                  (a) => a !== action && next[a] !== settings.shortcuts[a],
                );
                void update({ shortcuts: next });
                if (swapped.length > 0) {
                  flash(
                    `${SHORTCUT_LABELS[action].label} 与 ${swapped
                      .map((a) => SHORTCUT_LABELS[a].label)
                      .join('、')} 已互换键位`,
                  );
                }
              }}
              onInvalid={(reason) => flash(reason, 'err')}
            />
          </Row>
        ))}
        <div className="flex items-center justify-between gap-3 pt-0.5">
          <p className="text-[11px] leading-relaxed text-muted">
            字母键不能绑定：它们是练习内容本身，绑上去会让打字直接坏掉。
          </p>
          <button
            type="button"
            disabled={isDefaultShortcuts(settings.shortcuts, DEFAULT_SHORTCUTS)}
            onClick={() => {
              void update({ shortcuts: DEFAULT_SHORTCUTS });
              flash('已恢复默认键位');
            }}
            className="tf-btn shrink-0 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconRefresh width={13} height={13} />
            恢复默认
          </button>
        </div>
      </Section>

      {/* 外观 */}
      <Section title="外观">
        <Row label="主题">
          <Segmented<'dark' | 'light'>
            value={settings.theme}
            onChange={(v) => void update({ theme: v })}
            size="sm"
            options={[
              { value: 'dark', label: '深色' },
              { value: 'light', label: '浅色' },
            ]}
          />
        </Row>
      </Section>

      {/* 数据 */}
      <Section
        title="数据"
        hint={`本机已存 ${counts.words} 个词的学习记录、${counts.sessions} 条练习历史`}
      >
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void handleExport()} className="tf-btn text-xs">
            <IconDownload width={13} height={13} />
            导出备份
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className="tf-btn text-xs">
            <IconUpload width={13} height={13} />
            导入备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => void handleClear()}
            className="tf-btn text-xs text-error hover:border-error"
          >
            <IconTrash width={13} height={13} />
            清空数据
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          EnglishMate 不收集任何个人信息，所有数据都在这台设备的浏览器里（IndexedDB）。
          清理浏览器数据会导致记录丢失，建议定期导出备份。
        </p>
      </Section>

      {/* 关于 */}
      <Section title="关于">
        <div className="space-y-1.5 text-[11px] leading-relaxed text-muted">
          <p>
            <strong className="text-ink">EnglishMate</strong> ·
            打字即学习。开源、免费、无广告、无内购。
          </p>
          <p>
            复习算法采用 FSRS（Free Spaced Repetition Scheduler），实现上参考了 Type Words
            的产品形态。
          </p>
          {/*
            数据来源必须逐项标明许可——开源项目里这是硬性要求，
            Tatoeba 的 CC-BY 尤其要求署名，不能省。
          */}
          <div className="mt-1 rounded-lg bg-surface2/60 px-2.5 py-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted/80">
              数据来源
            </div>
            <ul className="space-y-0.5">
              <li>
                词表 ·{' '}
                <a
                  href="https://github.com/RealKai42/qwerty-learner"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Qwerty Learner
                </a>{' '}
                <span className="text-muted/70">MIT</span>
              </li>
              <li>
                词性释义 ·{' '}
                <a
                  href="https://github.com/skywind3000/ECDICT"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  ECDICT
                </a>{' '}
                <span className="text-muted/70">MIT</span>
              </li>
              <li>
                英中例句 ·{' '}
                <a
                  href="https://tatoeba.org"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Tatoeba
                </a>{' '}
                <span className="text-muted/70">CC-BY 2.0 FR</span>
              </li>
            </ul>
          </div>
          <p className="text-muted/70">版本 0.1.0 · MIT License</p>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="mb-2.5">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="text-[11px] leading-tight text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * 快捷键录制按钮。
 *
 * 为什么不做一个「下拉框选键」：键盘上有上百个键，枚举出来既长又难找，
 * 而且用户想绑的往往是 F 区或小键盘这种下拉里排到很后面的键。
 * 直接按键最直观——想绑哪个键就按哪个键。
 *
 * 录制期间用**捕获阶段**监听 window 的 keydown：录入的键必须比页面上
 * 任何其他键盘处理先被拿到，否则像 Space 会先触发页面滚动、
 * Tab 会先跑焦点漫游，用户按下去看到的是页面在动而不是键在录。
 */
function KeyCapture({
  value,
  onPick,
  onInvalid,
}: {
  value: string;
  onPick: (key: string) => void;
  onInvalid: (reason: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      /**
       * Esc 一律当取消，不当绑定目标。
       *
       * 录制态下按 Esc 的意图几乎总是「我不想改了」（这是所有软件的通用直觉），
       * 把它当绑定目标会让取消变得非常反直觉。想恢复 Esc 键位用「恢复默认」。
       */
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }
      const reason = assignableKeyError(e.key);
      if (reason) {
        // 保留录制态：用户按了字母被拒后，应该能直接换一个键再按
        onInvalid(reason);
        return;
      }
      setRecording(false);
      onPick(e.key);
    };
    // 点页面别处 = 放弃录制，避免按钮一直停在「按任意键」
    const onPointerDown = (e: PointerEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      setRecording(false);
    };

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [recording, onPick, onInvalid]);

  return (
    <button
      ref={btnRef}
      type="button"
      onClick={() => setRecording((r) => !r)}
      className={`tf-btn min-w-[5.5rem] justify-center font-mono text-xs ${
        recording ? 'border-accent text-accent' : ''
      }`}
      title={recording ? '按下想用的键，Esc 取消' : '点击后按下新键位'}
    >
      {recording ? '按任意键…' : formatKeyLabel(value)}
    </button>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        value ? 'bg-accent' : 'border border-line bg-surface2'
      }`}
    >
      {/*
       * 圆钮必须显式钉在 left，否则绝对定位元素会沿用静态位置，
       * 在窄轨道里直接跑到轨道外（曾经实测偏移 36px / 轨道宽 36px）。
       * 轨道 36px、圆钮 16px、两侧各留 2px → 可移动 16px。
       */}
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-150 ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

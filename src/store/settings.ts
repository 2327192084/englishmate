/**
 * 全局设置 store（Zustand）。
 *
 * 设置是 UI 的横切关注点（主题、音效、发音），
 * 放 store 里避免每个组件都去 await IndexedDB。
 */
import { create } from 'zustand';
import type { Settings } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';
import { getSettings, saveSettings } from '@/db';
import { primeVoices } from '@/lib/speech';

interface SettingsState {
  settings: Settings;
  ready: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement;
  root.classList.toggle('theme-light', theme === 'light');
  root.classList.toggle('theme-dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: { id: 1, ...DEFAULT_SETTINGS },
  ready: false,

  load: async () => {
    const settings = await getSettings();
    applyTheme(settings.theme);
    primeVoices();
    set({ settings, ready: true });
  },

  update: async (patch) => {
    const next = await saveSettings(patch);
    if (patch.theme) applyTheme(next.theme);
    set({ settings: next });
    // 让调用方可以立刻读到最新值
    void get();
  },
}));

/** 便捷选择器 */
export const useSetting = <K extends keyof Settings>(key: K): Settings[K] =>
  useSettings((s) => s.settings[key]);

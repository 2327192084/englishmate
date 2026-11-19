/**
 * 发音：Web Speech API。
 *
 * 为什么不内置音频文件：词库上万词，音频体积会让首屏和仓库都爆炸；
 * 浏览器自带的语音合成覆盖全部单词，且离线可用（取决于系统语音包）。
 */
import type { Accent } from '@/types';

let cachedVoices: SpeechSynthesisVoice[] = [];

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/** 浏览器语音列表是异步加载的，第一次可能是空的 */
export function primeVoices(): void {
  const s = synth();
  if (!s) return;
  const load = () => {
    cachedVoices = s.getVoices();
  };
  load();
  if (typeof s.addEventListener === 'function') {
    s.addEventListener('voiceschanged', load, { once: false });
  }
}

function pickVoice(accent: Accent): SpeechSynthesisVoice | undefined {
  const s = synth();
  if (!s) return undefined;
  const voices = cachedVoices.length ? cachedVoices : s.getVoices();
  if (!voices.length) return undefined;
  const wantLang = accent.toLowerCase();
  // 1) 语言完全匹配
  const exact = voices.find((v) => v.lang.toLowerCase().replace('_', '-') === wantLang);
  if (exact) return exact;
  // 2) 同语族（en-US / en-GB 互相兜底）
  const family = voices.find((v) => v.lang.toLowerCase().startsWith('en'));
  return family;
}

export interface SpeakOptions {
  accent?: Accent;
  rate?: number;
  /** 朗读一段话时用 false 可以少做一次取消操作 */
  interrupt?: boolean;
}

/** 朗读一个单词或句子。浏览器不支持时静默失败，不抛错。 */
export function speak(text: string, opts: SpeakOptions = {}): void {
  const s = synth();
  if (!s || !text.trim()) return;
  try {
    if (opts.interrupt !== false) s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = opts.accent ?? 'en-US';
    u.rate = Math.min(1.5, Math.max(0.5, opts.rate ?? 0.9));
    u.pitch = 1;
    const voice = pickVoice(opts.accent ?? 'en-US');
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    s.speak(u);
  } catch {
    /* 语音不可用不影响练习 */
  }
}

export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    /* noop */
  }
}

/** 当前环境是否具备语音合成能力 */
export function canSpeak(): boolean {
  return !!synth();
}

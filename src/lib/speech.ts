/**
 * 发音：优先 Web Speech API，桌面端缺英文语音时回落到主进程 SAPI。
 *
 * ── 为什么需要回落（这是真实用户反馈促成的）────────────────────────────────
 * 用户反馈「长难句朗读口齿不清、听不清」。排查发现根因不是语速参数，
 * 而是**引擎根本不匹配**：
 *
 *   Chromium 的 Web Speech API 只枚举 OneCore 注册表
 *   （`HKLM\SOFTWARE\Microsoft\Speech_OneCore\Voices`），
 *   而本机那里只有 3 个中文语音（Huihui / Kangkang / Yaoyao），
 *   **没有任何英文语音**。系统的 en-US 语音（Zira）只注册在 SAPI5 下。
 *
 * 于是旧实现 `pickVoice('en-US')` 返回 undefined，speechSynthesis 拿中文引擎
 * 去念英文——中文 TTS 只能用拼音/音素硬拼英文，听起来就是"口齿不清"，
 * 长句尤其明显。这是引擎问题，调 rate/pitch 都不可能修好。
 *
 * 所以：检测到「没有英文语音」时，改为请求主进程用 SAPI 合成 wav，
 * 渲染进程拿 `<audio>` 播。有英文语音的环境（macOS、装了英文语音包的 Windows）
 * 仍走原生 speechSynthesis，零 IPC 开销。
 *
 * ── 为什么不内置模型 ────────────────────────────────────────────────────
 * Web Speech API **不支持加载自定义语音模型**（标准就没有这个口子）。
 * 浏览器内跑神经网络 TTS 要 WebAssembly + 几十 MB 模型，
 * 且 Piper 生态依赖 espeak-ng（GPL-3.0）会传染本项目的 MIT 许可。
 * 用系统自带语音是唯一零依赖、无许可证风险、离线可用的路径。
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

/** 桌面端 preload 暴露的 TTS 桥（浏览器里是 undefined） */
interface DesktopTts {
  synthesize: (text: string) => Promise<{ ok: boolean; url?: string }>;
  available: () => Promise<{ ok: boolean; voice: string | null }>;
}

function desktopTts(): DesktopTts | null {
  if (typeof window === 'undefined') return null;
  /** 桌面版 preload 暴露 `window.englishmate`（2026-11-24 全面改名后唯一名字；
   *  曾短暂兼容旧安装版的 window.typeflow，旧安装已卸载，回落已删）。 */
  const w = window as unknown as {
    englishmate?: { tts?: DesktopTts };
  };
  return w.englishmate?.tts ?? null;
}

/** 主进程 SAPI 是否可用（桌面端且装了英文语音）。null = 还没探测过 */
let desktopAvailable: boolean | null = null;
/** 探测中的 Promise，避免并发重复探测 */
let desktopProbe: Promise<boolean> | null = null;

/**
 * 探测桌面端 SAPI 是否可用。
 *
 * 结果缓存：探测要起一次 PowerShell（几百毫秒），不该每次朗读都问一遍。
 */
function probeDesktopSapi(): Promise<boolean> {
  const bridge = desktopTts();
  if (!bridge) return Promise.resolve(false);
  if (desktopAvailable !== null) return Promise.resolve(desktopAvailable);
  if (desktopProbe) return desktopProbe;

  desktopProbe = bridge
    .available()
    .then((r) => {
      desktopAvailable = !!r?.ok;
      return desktopAvailable;
    })
    .catch(() => {
      desktopAvailable = false;
      return false;
    })
    .finally(() => {
      desktopProbe = null;
    });
  return desktopProbe;
}

/** 当前环境是否有英文语音（原生或 SAPI）——界面用它决定要不要提示用户 */
export async function hasEnglishVoice(): Promise<boolean> {
  if (pickVoice('en-US')) return true;
  return probeDesktopSapi();
}

/**
 * 选一个语音。
 *
 * 关键修正：**找不到英文语音时返回 null，不再退到"任意 en 开头"或默认语音**。
 * 旧实现退到 `voices.find(startsWith('en'))`，而本机连一个 en 开头的都没有，
 * 返回 undefined 后 speechSynthesis 用默认（中文）引擎念英文——
 * 那正是用户听到"口齿不清"的来源。宁可不播/走 SAPI，也不要让中文引擎念英文。
 */
function pickVoice(accent: Accent): SpeechSynthesisVoice | undefined {
  const s = synth();
  if (!s) return undefined;
  const voices = cachedVoices.length ? cachedVoices : s.getVoices();
  if (!voices.length) return undefined;
  const wantLang = accent.toLowerCase();
  // 1) 语言完全匹配
  const exact = voices.find((v) => v.lang.toLowerCase().replace('_', '-') === wantLang);
  if (exact) return exact;
  // 2) 同语族（en-US / en-GB 互相兜底）——仍然要求是英文语音
  return voices.find((v) => v.lang.toLowerCase().startsWith('en-'));
}

export interface SpeakOptions {
  accent?: Accent;
  rate?: number;
  /** 朗读一段话时用 false 可以少做一次取消操作 */
  interrupt?: boolean;
}

/* ── 桌面端 SAPI 播放 ─────────────────────────────────────────────────── */

/** 当前正在播的 audio（要能被打断） */
let currentAudio: HTMLAudioElement | null = null;
/** 缓存已合成的句子：同一句反复听（精听就是这个模式）不该重复走 IPC */
const sapiCache = new Map<string, string>();
const SAPI_CACHE_MAX = 200;

function stopAudio(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.src = '';
    } catch {
      /* noop */
    }
    currentAudio = null;
  }
}

/**
 * 走主进程 SAPI 朗读。
 *
 * url 是 app:// 同源地址（不是 file://）——`app://englishmate` 页面里
 * file:// 属于跨源，webSecurity 会拦掉且**不报错**，表现为"点了没声音"。
 */
async function speakViaDesktop(
  text: string,
  opts: SpeakOptions,
  bridge: DesktopTts,
): Promise<boolean> {
  const key = `${opts.accent ?? 'en-US'}|${opts.rate ?? 0.9}|${text}`;
  let url = sapiCache.get(key);

  if (!url) {
    const r = await bridge.synthesize(text).catch(() => null);
    if (!r?.ok || !r.url) return false;
    url = r.url;
    // 简单容量控制：超了删最早的一条（Map 保持插入顺序）
    if (sapiCache.size >= SAPI_CACHE_MAX) {
      const first = sapiCache.keys().next().value;
      if (first !== undefined) sapiCache.delete(first);
    }
    sapiCache.set(key, url);
  }

  try {
    const audio = new Audio(url);
    currentAudio = audio;
    /**
     * 语速：SAPI 合成的是固定语速音频，只能用 playbackRate 调整。
     * 限在 0.5–1.5，与原生 speechSynthesis 的 rate 口径一致，
     * 超出范围音质会明显劣化。
     */
    audio.playbackRate = Math.min(1.5, Math.max(0.5, opts.rate ?? 0.9));
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/** 朗读一个单词或句子。浏览器不支持时静默失败，不抛错。 */
export function speak(text: string, opts: SpeakOptions = {}): void {
  if (typeof text !== 'string' || !text.trim()) return;
  const accent = opts.accent ?? 'en-US';
  const s = synth();

  // 有原生英文语音就走原生：零延迟、零 IPC
  if (s && pickVoice(accent)) {
    try {
      stopAudio();
      if (opts.interrupt !== false) s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = accent;
      u.rate = Math.min(1.5, Math.max(0.5, opts.rate ?? 0.9));
      u.pitch = 1;
      const voice = pickVoice(accent);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      s.speak(u);
      return;
    } catch {
      /* 落到下面走 SAPI */
    }
  }

  /**
   * 没有原生英文语音：
   *  - 桌面端 → 主进程 SAPI
   *  - 浏览器 → 什么都不做（不要让中文引擎念英文，那正是"口齿不清"的根源）
   */
  const bridge = desktopTts();
  if (!bridge) return;
  // 打断上一句（与 speechSynthesis.cancel 的语义保持一致）
  if (opts.interrupt !== false) {
    stopAudio();
    try {
      s?.cancel();
    } catch {
      /* noop */
    }
  }
  void probeDesktopSapi().then((ok) => {
    if (!ok) return;
    void speakViaDesktop(text, { ...opts, accent }, bridge);
  });
}

export function stopSpeaking(): void {
  try {
    synth()?.cancel();
  } catch {
    /* noop */
  }
  stopAudio();
}

/** 当前环境是否具备语音合成能力（原生或桌面 SAPI） */
export function canSpeak(): boolean {
  return !!synth() || !!desktopTts();
}

/**
 * 是否处于「会朗读但声音质量不可靠」的状态。
 *
 * 用于设置页给出明确提示：浏览器里缺英文语音时，
 * 用户听到的会是中文引擎硬读英文——这需要告知，不能让他以为软件坏了。
 */
export async function isVoiceQualityDegraded(): Promise<boolean> {
  if (pickVoice('en-US')) return false;
  return !(await probeDesktopSapi());
}

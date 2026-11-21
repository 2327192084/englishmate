/**
 * 语音选择的单元测试。
 *
 * 这里钉住的是**本次修复的核心**：找不到英文语音时，
 * 绝不能让中文引擎去念英文——那正是用户反馈「口齿不清」的根源。
 *
 * speech.ts 依赖 window / speechSynthesis，所以在 node 环境下
 * 用最小桩替换全局对象，只测选择逻辑，不测真实发声。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 造一个假语音对象 */
function voice(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService: true,
    default: false,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

/** 装一个假的 speechSynthesis，返回它以便断言 */
function installSynth(voices: SpeechSynthesisVoice[]) {
  const spoken: SpeechSynthesisUtterance[] = [];
  const fake = {
    getVoices: () => voices,
    speak: (u: SpeechSynthesisUtterance) => spoken.push(u),
    cancel: () => {},
    addEventListener: () => {},
    pause: () => {},
    resume: () => {},
  };
  /**
   * speech.ts 读的是 `window.speechSynthesis`，不是裸的全局 `speechSynthesis`。
   * 所以桩必须挂在 window 上，否则 speak() 里 synth() 返回 null、整条链走不到。
   */
  vi.stubGlobal('speechSynthesis', fake);
  vi.stubGlobal('window', {
    speechSynthesis: fake,
    addEventListener: () => {},
    location: { href: 'http://localhost/' },
  });
  // SpeechSynthesisUtterance 在 node 里没有，给个最小实现
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      lang = '';
      rate = 1;
      pitch = 1;
      voice: SpeechSynthesisVoice | null = null;
      constructor(t: string) {
        this.text = t;
      }
    },
  );
  vi.stubGlobal(
    'Audio',
    class {
      src = '';
      playbackRate = 1;
      play() {
        return Promise.resolve();
      }
      pause() {}
    },
  );
  return { fake, spoken };
}

beforeEach(() => {
  // speech.ts 里缓存了 voices，每个用例之间必须重置模块
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * 本机真实情况：只有 3 个中文语音，一个英文都没有。
 * 这是 Chromium 只读 OneCore 注册表的结果（系统里其实有 Zira，但在 SAPI5 下）。
 */
const ONLY_CHINESE = [
  voice('Microsoft Huihui', 'zh-CN'),
  voice('Microsoft Kangkang', 'zh-CN'),
  voice('Microsoft Yaoyao', 'zh-CN'),
];

describe('找不到英文语音时不能硬用中文引擎', () => {
  it('只有中文语音时，speak 不发出任何 utterance', async () => {
    installSynth(ONLY_CHINESE);
    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();

    const { spoken } = installSynth(ONLY_CHINESE);
    speak('The experiment confirmed his theory.');

    /**
     * 关键断言：宁可不出声，也不能让中文引擎念英文。
     * 旧实现会退到「第一个 en 开头的语音」→ 找不到就返回 undefined →
     * speechSynthesis 用默认（中文）引擎硬读英文 = 口齿不清。
     */
    expect(spoken).toHaveLength(0);
  });

  it('isVoiceQualityDegraded 在只有中文语音时返回 true', async () => {
    installSynth(ONLY_CHINESE);
    const { primeVoices, isVoiceQualityDegraded } = await import('@/lib/speech');
    primeVoices();
    await expect(isVoiceQualityDegraded()).resolves.toBe(true);
  });
});

describe('有英文语音时走原生', () => {
  it('en-US 精确匹配优先', async () => {
    const voices = [voice('Chinese', 'zh-CN'), voice('Zira', 'en-US'), voice('Daniel', 'en-GB')];
    const { spoken } = installSynth(voices);
    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();

    speak('hello');
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.voice?.name).toBe('Zira');
  });

  it('没有 en-US 时退到同语族的英文语音（en-GB）', async () => {
    const voices = [voice('Chinese', 'zh-CN'), voice('Daniel', 'en-GB')];
    const { spoken } = installSynth(voices);
    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();

    speak('hello', { accent: 'en-US' });
    expect(spoken[0]!.voice?.name).toBe('Daniel');
  });

  it('有英文语音时 isVoiceQualityDegraded 为 false', async () => {
    const {} = installSynth([voice('Zira', 'en-US')]);
    const { primeVoices, isVoiceQualityDegraded } = await import('@/lib/speech');
    primeVoices();
    await expect(isVoiceQualityDegraded()).resolves.toBe(false);
  });

  it('语速被夹在 0.5..1.5（超出范围音质会劣化）', async () => {
    const { spoken } = installSynth([voice('Zira', 'en-US')]);
    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();

    speak('a', { rate: 5 });
    speak('b', { rate: 0.01 });
    expect(spoken[0]!.rate).toBe(1.5);
    expect(spoken[1]!.rate).toBe(0.5);
  });
});

describe('空输入与降级', () => {
  it('空文本不发 utterance', async () => {
    const { spoken } = installSynth([voice('Zira', 'en-US')]);
    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();

    speak('');
    speak('   ');
    expect(spoken).toHaveLength(0);
  });

  it('浏览器环境没有桌面桥时，canSpeak 仍为 true（有 speechSynthesis）', async () => {
    installSynth(ONLY_CHINESE);
    const { canSpeak } = await import('@/lib/speech');
    expect(canSpeak()).toBe(true);
  });
});

describe('桌面端 SAPI 回落', () => {
  it('有 typeflow 桥时会调用它（安装版暴露的是这个名字）', async () => {
    installSynth(ONLY_CHINESE);
    const calls: string[] = [];
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => ONLY_CHINESE,
        speak: () => {},
        cancel: () => {},
        addEventListener: () => {},
      },
      typeflow: {
        tts: {
          available: async () => ({ ok: true, voice: 'Zira' }),
          synthesize: async (t: string) => {
            calls.push(t);
            return { ok: true, url: 'app://typeflow/__tts__/t1.wav' };
          },
        },
      },
    });

    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();
    speak('hello from desktop');
    // 合成是异步的，等一拍
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toContain('hello from desktop');
  });

  it('有 englishmate 桥时也认（仓库版暴露的是这个名字）', async () => {
    installSynth(ONLY_CHINESE);
    let called = false;
    vi.stubGlobal('window', {
      speechSynthesis: {
        getVoices: () => ONLY_CHINESE,
        speak: () => {},
        cancel: () => {},
        addEventListener: () => {},
      },
      englishmate: {
        tts: {
          available: async () => ({ ok: true, voice: 'Zira' }),
          synthesize: async () => {
            called = true;
            return { ok: true, url: 'x' };
          },
        },
      },
    });

    const { speak, primeVoices } = await import('@/lib/speech');
    primeVoices();
    speak('test');
    await new Promise((r) => setTimeout(r, 120));
    expect(called).toBe(true);
  });
});

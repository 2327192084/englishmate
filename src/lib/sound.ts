/**
 * 键盘音效。
 *
 * 用 Web Audio 实时合成，不打包音频文件：
 * 一个短促的噪声爆发 + 低通滤波，听起来接近机械键盘的轴体声，
 * 体积 0KB、没有网络请求、延迟比 <audio> 低得多（<5ms）。
 */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 用户首次交互时调用，绕过自动播放限制 */
export function primeAudio(): void {
  getCtx();
}

/**
 * 播放一次按键音。
 * @param volume 0..1
 * @param variant 'down' 按下 | 'up' 回弹 | 'error' 错误（更闷更低）
 */
export function playKeySound(volume = 0.3, variant: 'down' | 'up' | 'error' = 'down'): void {
  const ac = getCtx();
  if (!ac || volume <= 0) return;

  const now = ac.currentTime;
  const duration = variant === 'up' ? 0.02 : 0.045;

  // 噪声源：白噪声缓冲
  const bufferSize = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // 指数衰减包络让声音更"实"
    const env = Math.exp((-i / bufferSize) * 5);
    data[i] = (Math.random() * 2 - 1) * env;
  }

  const src = ac.createBufferSource();
  src.buffer = buffer;

  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  if (variant === 'error') {
    filter.frequency.value = 320;
    filter.Q.value = 3.5;
  } else if (variant === 'up') {
    filter.frequency.value = 2400;
    filter.Q.value = 1.2;
  } else {
    filter.frequency.value = 1700;
    filter.Q.value = 1.8;
  }

  const gain = ac.createGain();
  const peak = Math.min(1, Math.max(0, volume)) * (variant === 'error' ? 0.55 : 0.4);
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  src.start(now);
  src.stop(now + duration + 0.01);

  src.onended = () => {
    try {
      src.disconnect();
      filter.disconnect();
      gain.disconnect();
    } catch {
      /* noop */
    }
  };
}

/** 完成一轮的提示音：两声上扬 */
export function playFinishSound(volume = 0.3): void {
  const ac = getCtx();
  if (!ac || volume <= 0) return;
  const now = ac.currentTime;
  [660, 990].forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.09;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume * 0.18, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  });
}

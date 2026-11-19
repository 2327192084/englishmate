import { describe, expect, it } from 'vitest';
import {
  createTimer,
  startTimer,
  markActivity,
  pauseTimer,
  tickTimer,
  elapsed,
  isIdlePaused,
  splitByDay,
  IDLE_MS,
  MAX_TICK_MS,
} from './timer';

const T0 = 1_700_000_000_000;

describe('计时器基础', () => {
  it('初始是暂停状态，不累计时间', () => {
    const s = createTimer(T0);
    expect(s.paused).toBe(true);
    expect(elapsed(s)).toBe(0);
  });

  it('启动后按真实间隔累加', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + 1000);
    s = tickTimer(s, T0 + 2000);
    s = tickTimer(s, T0 + 3000);
    expect(elapsed(s)).toBe(3000);
  });

  it('暂停期间不累加', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + 1000);
    s = pauseTimer(s, 'manual', T0 + 1000);
    s = tickTimer(s, T0 + 60_000);
    expect(elapsed(s)).toBe(1000);
  });
});

describe('系统休眠防护（核心）', () => {
  it('一次巨大的时间跳变完全不计入（休眠时间不算练习）', () => {
    let s = startTimer(createTimer(T0), T0);
    // 休眠 2 小时后唤醒，定时器一次性触发
    s = tickTimer(s, T0 + 2 * 3600 * 1000);
    // 这段停摆时间用户有没有在练无从得知，诚实记 0
    expect(elapsed(s)).toBe(0);
    expect(MAX_TICK_MS).toBeGreaterThan(1000);
  });

  it('轻微节流（略超 1 秒）仍如实计入', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + 2400); // 浏览器节流，仍在阈值内
    expect(elapsed(s)).toBe(2400);
  });

  it('休眠后 WPM 不被稀释（对比 naive 算法）', () => {
    const typedChars = 100; // 假设打了 100 个字符
    let s = startTimer(createTimer(T0), T0);
    // 正常工作 10 秒
    for (let i = 1; i <= 10; i++) s = tickTimer(s, T0 + i * 1000);
    // 休眠 1 小时
    s = tickTimer(s, T0 + 10_000 + 3600 * 1000);

    const activeMin = elapsed(s) / 60000;
    const wpmOurs = Math.floor(typedChars / 5 / activeMin);
    // naive：把休眠时间也算进去
    const naiveMin = (10_000 + 3600 * 1000) / 60000;
    const wpmNaive = Math.floor(typedChars / 5 / naiveMin);

    console.log(`  活跃时长 ${elapsed(s)}ms → WPM ${wpmOurs}；naive WPM ${wpmNaive}`);
    expect(wpmOurs).toBe(120); // 10 秒活跃 → 100 字符 = 120 WPM，不被休眠污染
    expect(wpmNaive).toBe(0); // 被稀释到 0，这正是修 bug 前的问题
  });

  it('时钟回拨（负间隔）不计时也不崩', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 - 5000); // 时间倒退
    expect(elapsed(s)).toBe(0);
    expect(Number.isFinite(elapsed(s))).toBe(true);
  });

  it('正常间隔（1–2 秒）如实计入', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + 1200);
    s = tickTimer(s, T0 + 2400);
    expect(elapsed(s)).toBe(2400);
  });
});

describe('空闲自动暂停', () => {
  it('空闲超过阈值自动暂停', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + 1000);
    // 用户离开，超过 IDLE_MS
    s = tickTimer(s, T0 + 1000 + IDLE_MS + 100);
    expect(s.paused).toBe(true);
    expect(isIdlePaused(s)).toBe(true);
    expect(s.pauseReason).toBe('idle');
  });

  it('暂停后时间不再增长', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + 1000);
    const before = elapsed(s);
    s = tickTimer(s, T0 + IDLE_MS + 5000);
    s = tickTimer(s, T0 + IDLE_MS + 10_000);
    expect(elapsed(s)).toBe(before);
  });

  it('新按键会从空闲暂停中唤醒', () => {
    let s = startTimer(createTimer(T0), T0);
    s = tickTimer(s, T0 + IDLE_MS + 100); // 暂停
    expect(isIdlePaused(s)).toBe(true);

    s = markActivity(s, T0 + IDLE_MS + 200);
    expect(s.paused).toBe(false);
    expect(s.pauseReason).toBeNull();

    s = tickTimer(s, T0 + IDLE_MS + 1200);
    expect(elapsed(s)).toBeGreaterThan(0);
  });

  it('手动暂停不会被按键唤醒', () => {
    let s = startTimer(createTimer(T0), T0);
    s = pauseTimer(s, 'manual', T0 + 1000);
    s = markActivity(s, T0 + 2000);
    expect(s.paused).toBe(true);
    expect(s.pauseReason).toBe('manual');
  });
});

describe('跨天拆分', () => {
  it('同一天内返回单段', () => {
    const start = new Date(2026, 0, 5, 10, 0, 0).getTime();
    const end = new Date(2026, 0, 5, 10, 30, 0).getTime();
    const parts = splitByDay(start, end);
    expect(parts).toHaveLength(1);
    expect(parts[0][0]).toBe(start);
    expect(parts[0][1]).toBe(end);
  });

  it('跨午夜返回两段', () => {
    const start = new Date(2026, 0, 5, 23, 58, 0).getTime();
    const end = new Date(2026, 0, 6, 0, 5, 0).getTime();
    const parts = splitByDay(start, end);
    expect(parts).toHaveLength(2);
    // 总时长守恒
    const total = parts.reduce((s, [a, b]) => s + (b - a), 0);
    expect(total).toBe(end - start);
  });

  it('非法区间返回空数组', () => {
    expect(splitByDay(100, 100)).toEqual([]);
    expect(splitByDay(200, 100)).toEqual([]);
    expect(splitByDay(NaN, 100)).toEqual([]);
  });

  it('拆分后时长守恒（多天）', () => {
    const start = new Date(2026, 0, 5, 22, 0, 0).getTime();
    const end = new Date(2026, 0, 8, 2, 0, 0).getTime();
    const parts = splitByDay(start, end);
    const total = parts.reduce((s, [a, b]) => s + (b - a), 0);
    expect(total).toBe(end - start);
    expect(parts.length).toBe(4); // 5→6, 6→7, 7→8, 8 当天
  });
});

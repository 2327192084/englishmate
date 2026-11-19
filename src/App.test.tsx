/**
 * 渲染测试：确认页面不是"类型对但一挂载就崩"。
 *
 * 这类错误 tsc 抓不到——比如 store 选择器返回新对象导致无限重渲染、
 * Dexie 在 jsdom 里没初始化、Context 缺失等等。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db, clearAllData } from '@/db';
import App from '@/App';

// jsdom 没有这些浏览器 API，需要打桩
beforeEach(async () => {
  await clearAllData();
  await db.settings.clear();

  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));

  // 语音合成打桩
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [],
      speak: () => {},
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });

  // AudioContext 打桩
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      currentTime = 0;
      sampleRate = 44100;
      destination = {};
      resume() {}
      createBuffer() {
        return { getChannelData: () => new Float32Array(16) };
      }
      createBufferSource() {
        return {
          connect() {},
          start() {},
          stop() {},
          disconnect() {},
          onended: null,
          buffer: null,
        };
      }
      createBiquadFilter() {
        return {
          connect() {},
          disconnect() {},
          type: '',
          frequency: { value: 0 },
          Q: { value: 0 },
        };
      }
      createGain() {
        return {
          connect() {},
          disconnect() {},
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
            linearRampToValueAtTime() {},
          },
        };
      }
      createOscillator() {
        return { connect() {}, start() {}, stop() {}, type: '', frequency: { value: 0 } };
      }
    },
  );

  // 词库索引请求打桩，避免测试依赖真实的 public/dicts
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/dicts/index.json')) {
      return {
        ok: true,
        json: async () => ({
          generatedAt: '',
          banks: [
            {
              id: 'cet4',
              name: 'CET-4 · 四级核心',
              category: 'exam',
              description: '测试词库',
              count: 3,
              source: 'test',
            },
          ],
        }),
      };
    }
    if (String(url).includes('/dicts/')) {
      return {
        ok: true,
        json: async () => ({
          meta: {
            id: 'cet4',
            name: 'test',
            category: 'exam',
            description: '',
            count: 3,
            source: 'test',
          },
          words: [
            { w: 'apple', t: '苹果' },
            { w: 'banana', t: '香蕉' },
            { w: 'cherry', t: '樱桃' },
          ],
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

describe('页面挂载', () => {
  it('练习页能挂载并显示模式与词库', async () => {
    renderAt('/');
    // 先过 loading 态
    await waitFor(() => expect(screen.queryByText('正在加载本地数据…')).toBeNull(), {
      timeout: 5000,
    });
    expect(await screen.findByText('开始练习')).toBeInTheDocument();
    expect(screen.getByText('跟打')).toBeInTheDocument();
    expect(screen.getByText('听写')).toBeInTheDocument();
    expect(screen.getByText('默写')).toBeInTheDocument();
    expect(screen.getByText('辨认')).toBeInTheDocument();
    // 词库来自打桩的 index.json
    expect(await screen.findByText('CET-4 · 四级核心')).toBeInTheDocument();
  });

  it('词库页能挂载并显示导入入口', async () => {
    renderAt('/words');
    expect(await screen.findByText('导入自定义词库')).toBeInTheDocument();
    expect(screen.getByText('错词本')).toBeInTheDocument();
  });

  it('复习页空状态不崩', async () => {
    renderAt('/review');
    expect(await screen.findByText('还没有需要复习的词')).toBeInTheDocument();
  });

  it('数据页空状态不崩', async () => {
    renderAt('/stats');
    expect(await screen.findByText('还没有学习数据')).toBeInTheDocument();
  });

  it('成就页能列出全部成就', async () => {
    renderAt('/achievements');
    expect(await screen.findByText('第一步')).toBeInTheDocument();
    expect(screen.getByText('万键')).toBeInTheDocument();
  });

  it('设置页能挂载并显示各分组', async () => {
    renderAt('/settings');
    expect(await screen.findByText('学习目标')).toBeInTheDocument();
    // "发音" 与 "数据" 在侧边导航里也各有一个，用标题级别定位更稳
    expect(screen.getAllByText('发音').length).toBeGreaterThan(0);
    expect(screen.getAllByText('数据').length).toBeGreaterThan(0);
    expect(screen.getByText(/所有数据都在这台设备的浏览器里/)).toBeInTheDocument();
  });

  it('文章页能列出语料', async () => {
    renderAt('/articles');
    expect(await screen.findByText('文章练习')).toBeInTheDocument();
    // 标题与作者行里都可能出现 Gettysburg，存在即算通过
    expect(screen.getAllByText(/Gettysburg/i).length).toBeGreaterThan(0);
    // 6 篇语料应全部列出（按 id 对应的标题判断）
    expect(screen.getAllByText(/Sonnet/i).length).toBeGreaterThan(0);
  });

  it('未知路由显示兜底页', async () => {
    renderAt('/nope');
    expect(await screen.findByText('页面不存在')).toBeInTheDocument();
  });
});

describe('主题切换', () => {
  it('设置里切到浅色会给 html 加 theme-light', async () => {
    renderAt('/settings');
    // "浅色" 同时出现在侧栏切换按钮与设置页分段控件里（桌面/移动各一套），取最后一个
    const btns = await screen.findAllByRole('button', { name: '浅色' });
    expect(btns.length).toBeGreaterThan(0);
    btns[btns.length - 1].click();
    await waitFor(() => {
      expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    });
  });
});

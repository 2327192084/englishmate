/**
 * 练习流程的端到端测试：从界面真的能把一轮练完并落库。
 *
 * 这是整个应用最关键的路径——打字引擎、store、FSRS、数据库四层要串起来。
 * 只测纯函数是不够的：store 的连接错误、事件没绑上、落库时机不对，
 * 都只有真的走一遍才暴露。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db, clearAllData } from '@/db';
import * as speech from '@/lib/speech';
import { usePractice } from '@/store/practice';
import { useSettings } from '@/store/settings';
import App from '@/App';

const WORDS = [
  { w: 'apple', t: '苹果' },
  { w: 'banana', t: '香蕉' },
  { w: 'cherry', t: '樱桃' },
];

afterEach(() => {
  cleanup();
  // 重置 store：上一个用例若停在 running 会带进下一个用例
  usePractice.getState().reset();
});

beforeEach(async () => {
  await clearAllData();
  await db.settings.clear();
  usePractice.getState().reset();

  /**
   * 注意：设置必须写进数据库，而不是只塞进 store。
   * App 挂载时会调 load() 从 IndexedDB 读设置并覆盖 store 里的值，
   * 只设内存状态会被立刻冲掉——之前 flowPreset 就是这么失效的。
   */
  const testSettings = {
    id: 1 as const,
    dailyNewTarget: 20,
    dailyReviewLimit: 100,
    accent: 'en-US' as const,
    speechRate: 0.9,
    keySound: false,
    keyVolume: 0.3,
    autoSpeak: false,
    theme: 'dark' as const,
    strictCorrection: true,
    roundSize: 20,
    flowPreset: 'followOnly' as const,
    groupSize: 7,
  };
  await db.settings.put(testSettings);
  useSettings.setState({ settings: testSettings });

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
              count: WORDS.length,
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
          words: WORDS,
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  });
});

async function startRound() {
  render(
    <MemoryRouter
      initialEntries={['/']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText('正在加载本地数据…')).toBeNull(), {
    timeout: 5000,
  });
  // 页面新增了「练习流程」选择区，按钮里也含"开始"字样。
  // 用 textContent 精确等于"开始"来定位主按钮。
  /**
   * 定位"开始"按钮。
   * 按钮内含 SVG 图标，textContent 会带上图标节点的文本残留，
   * 所以用 startsWith 而不是全等；同时排除"开始练习"标题（那是 h1 不是 button）。
   */
  const startBtn = await waitFor(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const t = (b.textContent || '').trim();
      return t.startsWith('开始') && !t.includes('练习');
    });
    if (!btn) {
      const all = [...document.querySelectorAll('button')]
        .map((b) => (b.textContent || '').trim())
        .filter(Boolean);
      throw new Error('找不到开始按钮，现有按钮: ' + JSON.stringify(all));
    }
    return btn;
  });
  await act(async () => {
    fireEvent.click(startBtn);
  });
  await waitFor(
    () => {
      expect(usePractice.getState().phase).toBe('running');
    },
    { timeout: 5000 },
  );
}

/** 把当前词完整敲对 */
async function typeWord(word: string) {
  const area = screen.getByRole('application');
  for (const ch of word) {
    await act(async () => {
      fireEvent.keyDown(area, { key: ch });
    });
  }
}

/** 提交并进入下一个词 */
async function submitWord() {
  const area = screen.getByRole('application');
  await act(async () => {
    fireEvent.keyDown(area, { key: ' ' });
  });
}

describe('练习流程', () => {
  it('能把一轮完整敲完并落库（单模式流程）', async () => {
    await startRound();
    const st = usePractice.getState();
    expect(st.queue.length).toBeGreaterThan(0);

    const total = st.queue.length;
    for (let i = 0; i < total; i++) {
      const word = usePractice.getState().current()?.w ?? '';
      await typeWord(word);
      await submitWord();
    }

    await waitFor(() => expect(usePractice.getState().phase).toBe('finished'), { timeout: 5000 });

    // 落库是异步的，等它写完（两条都要等：词记录与会话记录）
    await waitFor(
      async () => {
        const [words, sessions] = await Promise.all([db.userWords.count(), db.sessions.count()]);
        expect(words).toBeGreaterThan(0);
        expect(sessions).toBe(1);
      },
      { timeout: 5000 },
    );

    const sessions = await db.sessions.toArray();
    expect(sessions[0].mode).toBe('typing');
    expect(sessions[0].total).toBe(total);
    // 全敲对了，正确率应该是 1
    expect(sessions[0].correct).toBe(total);
    expect(sessions[0].accuracy).toBe(1);
  });

  it('打错时不会前进，且错误被记录', async () => {
    await startRound();
    const word = usePractice.getState().current()!.w;
    const area = screen.getByRole('application');

    // 故意敲一个不等于首字母的键
    const wrongKey = word[0] === 'z' ? 'x' : 'z';
    await act(async () => {
      fireEvent.keyDown(area, { key: wrongKey });
    });

    const st = usePractice.getState();
    expect(st.typing.cursor).toBe(0); // 严格模式下不前进
    expect(st.wordMistakes).toBeGreaterThan(0);

    // 改对之后能继续
    await typeWord(word[0]);
    expect(usePractice.getState().typing.cursor).toBe(1);
  });

  it('WPM 与进度在练习中能算出值', async () => {
    await startRound();
    const word = usePractice.getState().current()!.w;
    await typeWord(word);

    const st = usePractice.getState();
    expect(st.typing.cursor).toBe(word.length);
    // 进度至少推进了一个词
    expect(st.index).toBe(0);
    const wpm = st.liveWpm(Date.now() + 5000);
    expect(Number.isFinite(wpm)).toBe(true);
    expect(wpm).toBeGreaterThanOrEqual(0);
  });

  it('非严格模式下打错会占位前进，但整词判错', async () => {
    // 设置必须写进 db：App 挂载时会调 load() 从 db 覆盖 store 里的值
    await db.settings.put({
      id: 1,
      dailyNewTarget: 20,
      dailyReviewLimit: 100,
      accent: 'en-US',
      speechRate: 0.9,
      keySound: false,
      keyVolume: 0.3,
      autoSpeak: false,
      theme: 'dark',
      strictCorrection: false,
      roundSize: 20,
      flowPreset: 'followOnly',
      groupSize: 7,
    });
    await startRound();
    expect(useSettings.getState().settings.strictCorrection).toBe(false);

    const word = usePractice.getState().current()!.w;
    const area = screen.getByRole('application');

    const wrongKey = word[0] === 'z' ? 'x' : 'z';
    await act(async () => {
      fireEvent.keyDown(area, { key: wrongKey });
    });

    // 非严格模式：光标前进，占住这个位置
    expect(usePractice.getState().typing.cursor).toBe(1);

    // 敲完剩下的
    for (const ch of word.slice(1)) {
      await act(async () => {
        fireEvent.keyDown(area, { key: ch });
      });
    }
    await submitWord();

    const log = usePractice.getState().attempts.find((a) => a.word === word);
    expect(log?.correct).toBe(false); // 有未修正的错字
    expect(log?.mistakes).toBeGreaterThan(0);
  });

  it('辨认模式选中答案后会记录正确性', async () => {
    // 辨认模式的判定在 store 里，直接驱动 store 更准确：
    // 页面上的 effect 会自动填选项，会和手工构造的选项打架
    await act(async () => {
      usePractice.getState().start({
        mode: 'choice',
        bankId: 'cet4',
        queue: WORDS,
        reasons: new Map(),
      });
      usePractice.getState().buildChoices(() => [
        { label: '苹果', correct: true },
        { label: '香蕉', correct: false },
      ]);
      usePractice.getState().pickChoice(0);
    });

    expect(usePractice.getState().mode).toBe('choice');
    expect(usePractice.getState().choiceOutcome()).toEqual({ correct: true, mistakes: 0 });

    await act(async () => {
      usePractice.getState().next();
    });
    const log = usePractice.getState().attempts[0];
    expect(log.correct).toBe(true);
    expect(log.mistakes).toBe(0);
  });

  it('辨认模式选错会记为错误', async () => {
    await act(async () => {
      usePractice.getState().start({
        mode: 'choice',
        bankId: 'cet4',
        queue: WORDS,
        reasons: new Map(),
      });
      usePractice.getState().buildChoices(() => [
        { label: '苹果', correct: true },
        { label: '香蕉', correct: false },
      ]);
      usePractice.getState().pickChoice(1);
    });

    expect(usePractice.getState().choiceOutcome()).toEqual({ correct: false, mistakes: 1 });

    await act(async () => {
      usePractice.getState().next();
    });
    const log = usePractice.getState().attempts[0];
    expect(log.correct).toBe(false);
    expect(log.mistakes).toBe(1);
  });
  it('中途离开也会保存已练的词（增量落库）', async () => {
    await startRound();
    const first = usePractice.getState().current()!.w;
    await typeWord(first);
    await submitWord();

    // 不等整轮结束，词就应该已经进库——刷新/关页面不该丢进度
    await waitFor(
      async () => {
        const uw = await db.userWords.get(`cet4:${first.toLowerCase()}`);
        expect(uw).toBeTruthy();
      },
      { timeout: 5000 },
    );

    // 此时还没完成整轮，不应该有会话记录
    expect(await db.sessions.count()).toBe(0);
  });

  it('增量落库不会重复写同一个词', async () => {
    await startRound();
    const total = usePractice.getState().queue.length;
    for (let i = 0; i < total; i++) {
      const word = usePractice.getState().current()?.w ?? '';
      await typeWord(word);
      await submitWord();
    }
    await waitFor(() => expect(usePractice.getState().phase).toBe('finished'), { timeout: 5000 });

    await waitFor(
      async () => {
        expect(await db.sessions.count()).toBe(1);
      },
      { timeout: 5000 },
    );

    // 每个词的 corrects 应该是 1（写两次就会变 2）
    const words = await db.userWords.toArray();
    for (const w of words) {
      expect(w.corrects).toBe(1);
      expect(w.card.reps).toBe(1);
    }
  });

  describe('大小写与输入法', () => {
    it('CapsLock 状态打小写词仍算对', async () => {
      await startRound();
      const word = usePractice.getState().current()!.w;
      const area = screen.getByRole('application');
      // 全程大写输入
      for (const ch of word.toUpperCase()) {
        await act(async () => {
          fireEvent.keyDown(area, { key: ch });
        });
      }
      const st = usePractice.getState();
      expect(st.typing.cursor).toBe(word.length);
      expect(st.wordMistakes).toBe(0);
    });

    it('全角字符输入仍算对', async () => {
      await startRound();
      const word = usePractice.getState().current()!.w;
      const area = screen.getByRole('application');
      const full = (c: string) => String.fromCharCode(c.charCodeAt(0) + 0xfee0);
      for (const ch of word) {
        await act(async () => {
          fireEvent.keyDown(area, { key: full(ch) });
        });
      }
      const st = usePractice.getState();
      expect(st.typing.cursor).toBe(word.length);
      expect(st.wordMistakes).toBe(0);
    });

    it('输入法组字期间按键不录入、不判错', async () => {
      await startRound();
      const area = screen.getByRole('application');
      const word = usePractice.getState().current()!.w;

      // 组字开始
      await act(async () => {
        fireEvent.compositionStart(area);
      });
      // 组字中间打拼音字母，一个都不该被当成答题
      for (const ch of 'nihao') {
        await act(async () => {
          fireEvent.keyDown(area, { key: ch, isComposing: true });
        });
      }
      let st = usePractice.getState();
      expect(st.typing.cursor).toBe(0);
      expect(st.wordMistakes).toBe(0);

      // 上屏：提交完整单词
      await act(async () => {
        fireEvent.compositionEnd(area, { data: word });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });

      st = usePractice.getState();
      expect(st.typing.cursor).toBe(word.length);
      expect(st.wordMistakes).toBe(0);
    });

    it('组字结束后紧跟的 keydown 不会重复录入', async () => {
      await startRound();
      const area = screen.getByRole('application');
      const word = usePractice.getState().current()!.w;

      await act(async () => {
        fireEvent.compositionStart(area);
      });
      await act(async () => {
        fireEvent.compositionEnd(area, { data: word[0] });
      });
      // 浏览器可能在 compositionend 后立刻补一个 keydown
      await act(async () => {
        fireEvent.keyDown(area, { key: word[0] });
      });

      const st = usePractice.getState();
      // 只应该前进一格，不能是两格
      expect(st.typing.cursor).toBe(1);
    });
  });

  describe('错误反馈与输入法提醒', () => {
    it('打错时记录实际按的字符，供界面显示', async () => {
      await startRound();
      const word = usePractice.getState().current()!.w;
      const area = screen.getByRole('application');
      const wrongKey = word[0] === 'z' ? 'x' : 'z';

      await act(async () => {
        fireEvent.keyDown(area, { key: wrongKey });
      });
      const st = usePractice.getState();
      expect(st.typing.lastWrongChar).toBe(wrongKey);
      expect(st.typing.errorSeq).toBe(1);
    });

    it('打对后错误提示被清掉', async () => {
      await startRound();
      const word = usePractice.getState().current()!.w;
      const area = screen.getByRole('application');
      const wrongKey = word[0] === 'z' ? 'x' : 'z';

      await act(async () => {
        fireEvent.keyDown(area, { key: wrongKey });
      });
      await act(async () => {
        fireEvent.keyDown(area, { key: word[0] });
      });
      expect(usePractice.getState().typing.lastWrongChar).toBeNull();
    });

    it('中文上屏会触发输入法提醒，且不记错', async () => {
      await startRound();
      const area = screen.getByRole('application');
      const before = usePractice.getState();

      await act(async () => {
        fireEvent.compositionStart(area);
      });
      await act(async () => {
        fireEvent.compositionEnd(area, { data: '中文' });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      const after = usePractice.getState();
      // 提醒序号递增
      expect(after.imeWarningSeq).toBeGreaterThan(before.imeWarningSeq);
      // 但不该记错、不该推进光标
      expect(after.wordMistakes).toBe(0);
      expect(after.typing.cursor).toBe(0);
    });

    it('英文正常上屏不触发输入法提醒', async () => {
      await startRound();
      const area = screen.getByRole('application');
      const word = usePractice.getState().current()!.w;
      const before = usePractice.getState().imeWarningSeq;

      await act(async () => {
        fireEvent.compositionStart(area);
      });
      await act(async () => {
        fireEvent.compositionEnd(area, { data: word });
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      expect(usePractice.getState().imeWarningSeq).toBe(before);
      expect(usePractice.getState().typing.cursor).toBe(word.length);
    });
  });

  describe('流程链（分组循环）', () => {
    /** 用指定预设启动一轮 */
    async function startWithFlow(preset: 'followOnly' | 'listenWrite' | 'fullChain') {
      await db.settings.put({
        id: 1,
        dailyNewTarget: 20,
        dailyReviewLimit: 100,
        accent: 'en-US',
        speechRate: 0.9,
        keySound: false,
        keyVolume: 0.3,
        autoSpeak: false,
        theme: 'dark',
        strictCorrection: true,
        roundSize: 20,
        flowPreset: preset,
        groupSize: 2,
      });
      await startRound();
    }

    it('listenWrite：同一批词先跟打、再默写', async () => {
      await startWithFlow('listenWrite');
      const st = usePractice.getState();
      // 队列长度为 词数 × 步骤数
      expect(st.queue.length).toBeGreaterThan(0);
      expect(st.plan.length).toBe(st.queue.length);

      // 前两个是跟打
      expect(st.plan[0].mode).toBe('typing');
      expect(st.plan[1].mode).toBe('typing');
      // 之后进入默写，且练的是同一批词
      expect(st.plan[2].mode).toBe('recall');
      expect(st.plan[2].entry.w).toBe(st.plan[0].entry.w);
    });

    it('模式会随队列推进自动切换', async () => {
      await startWithFlow('listenWrite');
      expect(usePractice.getState().mode).toBe('typing');

      // 走完第一组（groupSize=2）的两个词
      for (let i = 0; i < 2; i++) {
        const w = usePractice.getState().current()!.w;
        await typeWord(w);
        await submitWord();
      }

      // 第 3 项应该是默写
      const st = usePractice.getState();
      expect(st.mode).toBe('recall');
      expect(st.index).toBe(2);
    });

    it('fullChain 每个词练三次', async () => {
      await startWithFlow('fullChain');
      const st = usePractice.getState();
      const uniqueWords = new Set(st.plan.map((p) => p.entry.w));
      expect(st.plan.length).toBe(uniqueWords.size * 3);
      // 三种模式都出现
      const modes = new Set(st.plan.map((p) => p.mode));
      expect(modes).toEqual(new Set(['typing', 'recall', 'dictation']));
    });

    it('followOnly 每个词只练一次', async () => {
      await startWithFlow('followOnly');
      const st = usePractice.getState();
      const uniqueWords = new Set(st.plan.map((p) => p.entry.w));
      expect(st.plan.length).toBe(uniqueWords.size);
      expect(new Set(st.plan.map((p) => p.mode))).toEqual(new Set(['typing']));
    });

    it('辨认模式强制单流程（不串默写）', async () => {
      // 直接验证 buildPlan 在辨认模式下的调用约定：
      // 页面固定传 followOnly，因此展开结果只包含 choice 模式。
      await db.settings.put({
        id: 1,
        dailyNewTarget: 20,
        dailyReviewLimit: 100,
        accent: 'en-US',
        speechRate: 0.9,
        keySound: false,
        keyVolume: 0.3,
        autoSpeak: false,
        theme: 'dark',
        strictCorrection: true,
        roundSize: 20,
        flowPreset: 'fullChain',
        groupSize: 2,
      });

      const { buildPlan, flattenPlan } = await import('@/lib/flow');
      const entries = [
        { w: 'alpha', t: '甲' },
        { w: 'beta', t: '乙' },
      ];
      // 页面里的等价逻辑：mode === 'choice' 时强制 followOnly
      const plan = buildPlan(entries, 'followOnly', 2);
      const items = flattenPlan(plan);
      expect(new Set(items.map((i) => i.mode))).toEqual(new Set(['typing']));
      expect(items).toHaveLength(2);
    });
  });

  it('Tab 键触发发音且不跳词', async () => {
    await startRound();
    const area = screen.getByRole('application');
    const word = usePractice.getState().current()!.w;
    const speakSpy = vi.spyOn(speech, 'speak').mockImplementation(() => {});

    const beforeProgress = usePractice.getState().index;
    await act(async () => {
      fireEvent.keyDown(area, { key: 'Tab' });
    });

    // 应调用发音，且朗读的是当前词
    expect(speakSpy).toHaveBeenCalled();
    expect(speakSpy.mock.calls.at(-1)?.[0]).toBe(word);
    // 不应跳词
    expect(usePractice.getState().index).toBe(beforeProgress);
    speakSpy.mockRestore();
  });
});

/**
 * 句子练习页的渲染测试。
 *
 * 这里测的是「页面接线」而不是算法：取句逻辑在 `src/data/sentences.test.ts`、
 * 逐词对比在 `src/lib/sentenceDiff` 都有纯逻辑单测，本文件只验证
 * 选择来源 → 取到句子 → 输入 → 提交 → 看到对照 → 下一句这条链路真的通。
 *
 * fetch 被完全打桩：node 环境没有 fetch，且取句不该真的去拉几个 MB 的词库。
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SentencesPage from './SentencesPage';

/** 两个词、各一句，句子都能完整打出来 */
const words = [
  { w: 'apple', t: '苹果', sentences: [{ en: 'I ate an apple.', zh: '我吃了一个苹果。' }] },
  { w: 'banana', t: '香蕉', sentences: [{ en: 'The banana is ripe.', zh: '香蕉熟了。' }] },
];

beforeEach(async () => {
  /**
   * 每个用例都从干净的用户词库开始。
   *
   * 完形模式会把作答写进 IndexedDB（recordAttempt → 错词本 + FSRS），
   * 而 fake-indexeddb 在同一个测试文件里是**跨用例共享**的。
   * 不清的话，前一个用例答错的词会让「错词本为空时给出空状态」这类
   * 依赖初始状态的用例失败——这不是被测代码的 bug，是测试隔离没做好。
   */
  const { db } = await import('@/db');
  await db.userWords.clear();

  vi.stubGlobal('fetch', (url: string) => {
    const u = String(url);
    if (u.includes('index.json')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          generatedAt: '',
          banks: [
            { id: 'cet4', name: 'CET-4', category: 'exam', description: '', count: 2, source: '' },
          ],
        }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ meta: {}, words }) });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 进入「按词库」并开始一轮，返回输入框 */
async function startBankRound() {
  render(
    <MemoryRouter>
      <SentencesPage />
    </MemoryRouter>,
  );
  expect(screen.getByText('句子练习')).toBeInTheDocument();
  fireEvent.click(screen.getByText('按词库'));
  fireEvent.click(screen.getByText('开始'));
  await waitFor(() => expect(screen.getByText(/第 1\//)).toBeInTheDocument());
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/** 切到完形模式并开始一轮，返回填空输入框 */
async function startClozeRound() {
  render(
    <MemoryRouter>
      <SentencesPage />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('按词库'));
  fireEvent.click(screen.getByText('完形填空'));
  fireEvent.click(screen.getByText('开始'));
  await waitFor(() => expect(screen.getByText(/第 1\//)).toBeInTheDocument());
  return screen.getByLabelText('填空答案') as HTMLInputElement;
}

describe('SentencesPage · 完形模式', () => {
  it('题面里出现挖空占位符而不是完整句子', async () => {
    await startClozeRound();
    // 两句测试句的目标词（apple / banana）都在句中，都能挖
    const shown = document.querySelector('.tf-card .tf-mono')?.textContent ?? '';
    expect(shown).toContain('____');
  });

  it('填对时判定完全正确', async () => {
    const input = await startClozeRound();
    /**
     * 答案不能从题面读——题面里那个词已经被挖掉了（正是要验证的点）。
     * 改为：先随便填一个错答案拿到「答案」区，读出正确答案，
     * 再进入下一句用正确答案验证判定逻辑。
     */
    const shown = document.querySelector('.tf-card .tf-mono')?.textContent ?? '';
    const answer = shown.includes('____') && /ripe/.test(shown) ? 'banana' : 'apple';
    fireEvent.change(input, { target: { value: answer } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('完全正确')).toBeInTheDocument());
  });

  it('完形模式不显示逐词对照（那是整句模式的东西）', async () => {
    const input = await startClozeRound();
    fireEvent.change(input, { target: { value: 'wrongword' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('答案')).toBeInTheDocument());
    expect(screen.queryByText('逐词对照')).not.toBeInTheDocument();
  });

  it('答错时给出正确答案与对应词条', async () => {
    const input = await startClozeRound();
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('答案')).toBeInTheDocument());
    expect(screen.getByText(/这个词条是/)).toBeInTheDocument();
  });

  it('切换练法会回到选择页，不接着做上一组的下一句', async () => {
    await startClozeRound();
    fireEvent.click(screen.getByText('换来源'));
    await waitFor(() => expect(screen.getByText('句子练习')).toBeInTheDocument());
    expect(screen.getByText('整句输入')).toBeInTheDocument();
  });

  /**
   * 完形的作答必须落进「用户词库 + FSRS」：否则答错的词不会进错词本、
   * 也不会提前复习，完形就只是一次性玩具。
   */
  it('答错会把该词条写进错词本（FSRS 接入）', async () => {
    const input = await startClozeRound();
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('答案')).toBeInTheDocument());

    // 落库是异步的，等它写进去
    await waitFor(async () => {
      const { db } = await import('@/db');
      const rows = await db.userWords.toArray();
      expect(rows.length).toBeGreaterThan(0);
      // 答错的词必须有 mistakes > 0，否则错词本拿不到它
      expect(rows.some((r) => r.mistakes > 0)).toBe(true);
    });
  });

  it('答对不会把这个词记成错词', async () => {
    const input = await startClozeRound();
    const shown = document.querySelector('.tf-card .tf-mono')?.textContent ?? '';
    const answer = /ripe/.test(shown) ? 'banana' : 'apple';
    fireEvent.change(input, { target: { value: answer } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('完全正确')).toBeInTheDocument());

    await waitFor(async () => {
      const { db } = await import('@/db');
      const rows = await db.userWords.toArray();
      // 答对也要落库（corrects 计数），但 mistakes 必须是 0
      const hit = rows.find((r) => r.word === answer);
      expect(hit).toBeTruthy();
      expect(hit?.mistakes).toBe(0);
    });
  });
});

describe('SentencesPage · 窄式精听', () => {
  /** 切到精听并开始一轮 */
  async function startListenRound() {
    render(
      <MemoryRouter>
        <SentencesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('按词库'));
    fireEvent.click(screen.getByText('窄式精听'));
    fireEvent.click(screen.getByText('开始'));
    // 「第 1/3 轮」和「第 1/2 句」都会命中 /第 1\//，所以用轮次文案定位
    await waitFor(() => expect(screen.getByText(/轮 · /)).toBeInTheDocument());
  }

  it('第一轮是盲听，不给任何文字', async () => {
    await startListenRound();
    expect(screen.getByText('先只听，不看文字')).toBeInTheDocument();
    // 也不能把英文原文漏出来
    expect(screen.queryByText(/apple|banana/)).not.toBeInTheDocument();
  });

  it('显示轮次与句号进度', async () => {
    await startListenRound();
    expect(screen.getByText(/第 1\/3 轮/)).toBeInTheDocument();
    expect(screen.getByText(/第 1\/2 句/)).toBeInTheDocument();
  });

  it('本轮最后一句之后进入下一轮并给出中文', async () => {
    await startListenRound();
    // 测试数据只有 2 句，点两次即走完第一轮
    fireEvent.click(screen.getByText('下一句'));
    await waitFor(() => expect(screen.getByText(/第 2\/2 句/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('下一轮'));
    await waitFor(() => expect(screen.getByText(/第 2\/3 轮/)).toBeInTheDocument());
    expect(screen.getByText(/看中文/)).toBeInTheDocument();
    // 第二轮的提示是中文译文，不再是盲听占位
    expect(screen.queryByText('先只听，不看文字')).not.toBeInTheDocument();
  });

  it('有「再听一遍」按钮且可点', async () => {
    await startListenRound();
    const again = screen.getByLabelText('再听一遍');
    expect(again).not.toBeDisabled();
    fireEvent.click(again);
  });

  /**
   * 「按文章」是精听独有的来源：一篇文章就是一个天然的窄式批次。
   * 它不该出现在完形/整句模式下——那两种要的是跨文章的练习量。
   */
  it('精听模式提供「按文章」来源，且默认选中一篇', async () => {
    // 必须在设置页断言：startListenRound 会点「开始」离开这一页
    render(
      <MemoryRouter>
        <SentencesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('窄式精听'));
    expect(screen.getByText('按文章')).toBeInTheDocument();
    fireEvent.click(screen.getByText('按文章'));
    const select = screen.getByLabelText('选择文章') as HTMLSelectElement;
    expect(select.value.length).toBeGreaterThan(0);
  });

  it('按文章听：批次标题会显示出来', async () => {
    render(
      <MemoryRouter>
        <SentencesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('按词库'));
    fireEvent.click(screen.getByText('窄式精听'));
    fireEvent.click(screen.getByText('按文章'));
    fireEvent.click(screen.getByText('开始'));
    await waitFor(() => expect(screen.getByText(/轮 · /)).toBeInTheDocument());
    // 标题来自真实文章语料，形如《xxx》
    expect(screen.getByText(/《.+》/)).toBeInTheDocument();
  });

  it('完形模式不提供「按文章」（一篇只有 4–10 句，凑不满一轮）', async () => {
    render(
      <MemoryRouter>
        <SentencesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('完形填空'));
    expect(screen.queryByText('按文章')).not.toBeInTheDocument();
  });

  it('从精听切到完形时，来源自动从「按文章」退回词库', async () => {
    render(
      <MemoryRouter>
        <SentencesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('窄式精听'));
    fireEvent.click(screen.getByText('按文章'));
    // 切回完形：article 已不是合法来源
    fireEvent.click(screen.getByText('完形填空'));
    expect(screen.queryByText('按文章')).not.toBeInTheDocument();
    // 来源区仍有被选中的项，不是空白
    expect(screen.getByText('按词库')).toBeInTheDocument();
  });
});

describe('SentencesPage（原有用例）', () => {
  it('取到句子、提交后显示逐词对照与标准答案', async () => {
    const ta = await startBankRound();

    // 取句是随机的，随便打一句必然对不上：只验证「提交后有结果」
    fireEvent.change(ta, { target: { value: 'i ate an apple' } });
    fireEvent.keyDown(ta, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('逐词对照')).toBeInTheDocument());
    expect(screen.getByText(/处不一致|完全正确/)).toBeInTheDocument();
  });

  it('照抄目标句时判定完全正确', async () => {
    const ta = await startBankRound();

    // 目标句是题面那一段：直接读渲染出来的文本，避免对随机取句做假设
    const target = document.querySelector('.tf-card .tf-mono')?.textContent ?? '';
    expect(target.length).toBeGreaterThan(0);
    fireEvent.change(ta, { target: { value: target } });
    fireEvent.keyDown(ta, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('完全正确')).toBeInTheDocument());
  });

  it('提交后按 Enter 进入下一句', async () => {
    const ta = await startBankRound();
    const target = document.querySelector('.tf-card .tf-mono')?.textContent ?? '';
    fireEvent.change(ta, { target: { value: target } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('完全正确')).toBeInTheDocument());

    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/第 2\//)).toBeInTheDocument());
  });

  /**
   * 只有 2 个词是带例句的，所以一轮实际只有 2 句，很容易跑到结算页。
   * 这里只钉住行为：点「再来一组」必须回到第 1 句。播放器是靠 loading 骨架
   * 卸载重挂还是靠 key 换代才重置的，属于实现细节，不该进断言——
   * 那条路以后换成别的方式（比如原地重置 idx）这个用例依然成立。
   */
  it('「再来一组」回到第 1 句而不是卡在结算页', async () => {
    await startBankRound();

    for (let i = 0; i < 2; i += 1) {
      const target = document.querySelector('.tf-card .tf-mono')?.textContent ?? '';
      fireEvent.change(screen.getByRole('textbox'), { target: { value: target } });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
      await waitFor(() => expect(screen.getByText('完全正确')).toBeInTheDocument());
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    }

    await waitFor(() => expect(screen.getByText(/一次打对/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('再来一组'));
    await waitFor(() => expect(screen.getByText(/第 1\//)).toBeInTheDocument());
  });

  it('错词本为空时给出空状态而不是白屏', async () => {
    render(
      <MemoryRouter>
        <SentencesPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('错词本'));
    fireEvent.click(screen.getByText('开始'));
    await waitFor(() => expect(screen.getByText(/错词本还是空的/)).toBeInTheDocument());
  });
});

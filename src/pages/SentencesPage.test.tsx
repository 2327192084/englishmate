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

beforeEach(() => {
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

describe('SentencesPage', () => {
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

/**
 * 词族 / 形近词提示条 —— 练习界面的"卡住时救命"组件。
 *
 * ── 为什么放这里而不是只放详情面板 ────────────────────────────────────────
 * 数据显示卡在拼写时，看一眼同族词（reach → reaching / reached）
 * 往往立刻能想起怎么拼。这比藏在抽屉里的详情面板有用得多——
 * 用户不会为了查一个词专门点开弹窗。
 *
 * 默认折叠成一行"同族词"入口，点开才展开。
 * 不默认展开的原因：词形变化里可能包含答案本身（比如练 reached 时
 * 族里有 reach），一进来就摊开会等于提示答案。
 */
import { useEffect, useState } from 'react';
import { getFamily, getLookalike, isGraphLoaded, loadWordGraph } from '@/data/wordGraph';
import { IconLightning } from './Icons';

export function WordFamilyHint({ word, mode }: { word: string; mode: string }) {
  const [ready, setReady] = useState(isGraphLoaded());
  const [open, setOpen] = useState(false);

  // 首次挂载时加载词关系（全局只下载一次）
  useEffect(() => {
    if (ready) return;
    let alive = true;
    void loadWordGraph().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);

  // 换词时收起，避免停留在上一个词上
  useEffect(() => {
    setOpen(false);
  }, [word]);

  if (!ready) return null;

  const family = getFamily(word);
  const lookalike = getLookalike(word);
  if (family.length === 0 && lookalike.length === 0) return null;

  /**
   * 默写/听写模式下默认不展开。
   * 这两种模式的目标就是"从记忆里提取"，直接摊开词形等于送答案。
   * 跟打模式可以默认展开（那时用户已经在看词了，提示不构成作弊）。
   */
  const canAutoShow = mode === 'typing';
  const visible = open || canAutoShow;

  return (
    <div className="mt-2 flex flex-col items-center gap-1.5">
      {!visible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-surface2/60 px-2 py-1 text-[11px] text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <IconLightning width={11} height={11} />
          想不起拼写？看同族词
        </button>
      )}

      {visible && (
        <div className="flex max-w-xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px]">
          {family.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="text-muted">同族</span>
              {family.map((f) => (
                <span key={f} className="tf-mono rounded bg-surface2 px-1.5 py-0.5 text-accent/90">
                  {f}
                </span>
              ))}
            </span>
          )}
          {lookalike.length > 0 && (
            <span className="inline-flex flex-wrap items-center gap-1">
              <span className="text-muted">形近</span>
              {lookalike.map((l) => (
                <span
                  key={l}
                  className="tf-mono rounded bg-amber-400/10 px-1.5 py-0.5 text-amber-400/90"
                  title="拼写相近，注意区分"
                >
                  {l}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

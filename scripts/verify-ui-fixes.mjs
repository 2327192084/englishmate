/**
 * 验证三个 UI 问题的修复。
 *
 * 1. 练习模式与练习流程合并为一个「练习方式」选择器
 * 2. "多练 10 个"假按钮已移除
 * 3. 侧边栏固定，不随页面滚动
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const PORT = process.env.PORT || 9520;
const OUT = '.tmp/fix-shots';
await mkdir(OUT, { recursive: true });

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const p = b.contexts()[0].pages()[0];
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));

await p.waitForSelector('text=开始练习', { timeout: 25000 });
const results = [];

// ── 1. 只有一个练法选择器 ─────────────────────────────────
const ui = await p.evaluate(() => {
  const txt = document.body.innerText;
  return {
    hasModeSection: txt.includes('练习模式'),
    hasFlowSection: txt.includes('练习流程'),
    hasUnified: txt.includes('练习方式'),
    hasFakeBtn: txt.includes('多练 10 个'),
    // 练法名称
    methods: [...document.querySelectorAll('button')]
      .map((x) => x.textContent?.trim() ?? '')
      .filter((t) => /^(跟打 \+|只跟打|只听写|只默写|只辨认)/.test(t))
      .map((t) => t.split('\n')[0].slice(0, 20)),
  };
});
console.log('[1] 练习方式合并');
console.log('    "练习模式"区块:', ui.hasModeSection ? '仍在（应消失）' : '已移除 ✓');
console.log('    "练习流程"区块:', ui.hasFlowSection ? '仍在（应消失）' : '已移除 ✓');
console.log('    "练习方式"区块:', ui.hasUnified ? '存在 ✓' : '缺失');
console.log('    可选练法:', JSON.stringify(ui.methods));
results.push({
  n: '模式与流程合并',
  pass: !ui.hasModeSection && !ui.hasFlowSection && ui.hasUnified,
  d: `${ui.methods.length} 种练法`,
});

// ── 2. 假按钮已移除 ───────────────────────────────────────
console.log('\n[2] 假按钮');
console.log('    "多练 10 个":', ui.hasFakeBtn ? '仍在（应移除）' : '已移除 ✓');
results.push({
  n: '移除假按钮',
  pass: !ui.hasFakeBtn,
  d: ui.hasFakeBtn ? 'still there' : 'removed',
});

// ── 3. 侧边栏固定 ─────────────────────────────────────────
console.log('\n[3] 侧边栏固定');
const nav = await p.evaluate(() => {
  const aside = document.querySelector('aside');
  if (!aside) return null;
  const cs = getComputedStyle(aside);
  const r = aside.getBoundingClientRect();
  return {
    position: cs.position,
    height: Math.round(r.height),
    viewportH: window.innerHeight,
    cls: aside.className,
  };
});
console.log('    position:', nav?.position, '| 高度:', nav?.height, '| 视口:', nav?.viewportH);

// 滚动画布，看侧栏是否跟着动
const before = await p.evaluate(() => {
  const a = document.querySelector('aside');
  return a ? Math.round(a.getBoundingClientRect().top) : null;
});
await p.evaluate(() => {
  const main = document.querySelector('main');
  if (main) main.scrollTop = 600;
  else window.scrollTo(0, 600);
});
await p.waitForTimeout(500);
const after = await p.evaluate(() => {
  const a = document.querySelector('aside');
  return a ? Math.round(a.getBoundingClientRect().top) : null;
});
console.log(`    滚动前后侧栏 top: ${before} → ${after}（应保持不变）`);
results.push({
  n: '侧边栏固定',
  pass: before !== null && before === after,
  d: `top ${before}→${after}`,
});

await p.evaluate(() => {
  const main = document.querySelector('main');
  if (main) main.scrollTop = 0;
  else window.scrollTo(0, 0);
});
await p.waitForTimeout(300);
await p.screenshot({ path: `${OUT}/practice-setup.png`, fullPage: false });

// 顺便验证能开始
const started = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(
    (x) => x.textContent?.trim() === '开始',
  );
  if (!btn) return false;
  btn.click();
  return true;
});
await p.waitForTimeout(2500);
const running = await p.evaluate(() => !!document.querySelector('[role="application"]'));
console.log('\n[4] 开始练习:', started && running ? '正常进入 ✓' : '失败');
results.push({ n: '能开始练习', pass: running, d: running ? 'running' : 'not started' });

console.log('\npageerror:', errs.length);
await b.close();

console.log('\n=== 结果 ===');
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}  (${r.d})`);
  if (!r.pass) ok = false;
}
process.exitCode = ok ? 0 : 1;

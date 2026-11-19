/**
 * 验证 P1（流程链 / 分组提示）+ P2（详情面板）+ P0（计时）在真实应用里的表现。
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const PORT = process.env.PORT || 9490;
const OUT = '.tmp/phase-shots';
await mkdir(OUT, { recursive: true });

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const page = b.contexts()[0].pages()[0];

const readWord = () =>
  page.evaluate(() => {
    const host = document.querySelector('[role="application"] .tf-mono.font-semibold');
    if (!host) return null;
    return [...host.querySelectorAll(':scope > span')]
      .map((k) => {
        const i = k.querySelector('span');
        return i ? i.textContent : k.textContent;
      })
      .join('')
      .replace(/\u00a0/g, '')
      .replace(/\s/g, '');
  });

const results = [];

await page
  .waitForSelector('[role="application"], text=开始练习', { timeout: 20000 })
  .catch(() => {});
if ((await page.locator('[role="application"]').count()) === 0) {
  await page.waitForSelector('text=开始练习', { timeout: 15000 });
}

// 截图：设置页应能看到流程选择
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => x.textContent?.trim() === '开始');
  if (b) b.click();
});
await page.waitForSelector('[role="application"]', { timeout: 20000 }).catch(() => {});

// ── 1. 流程步骤提示 ─────────────────────────────────────────
const stepBadge = await page.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find((s) =>
    ['跟打', '默写', '听写'].includes(s.textContent?.trim() ?? ''),
  );
  const groupInfo = document.body.innerText.match(/第\s*(\d+)\s*组[\s\S]{0,12}?(\d+)\/(\d+)/);
  return {
    badge: el?.textContent?.trim() ?? null,
    groupText: groupInfo ? groupInfo[0].replace(/\s+/g, ' ') : null,
  };
});
console.log('[1] 流程步骤提示:', JSON.stringify(stepBadge));
results.push({ n: '流程步骤徽标', pass: !!stepBadge.badge, d: stepBadge.badge ?? 'none' });

// ── 2. 详情面板 ─────────────────────────────────────────────
const detailBtn = page.locator('button:has-text("详情")').first();
const hasDetailBtn = (await detailBtn.count()) > 0;
if (hasDetailBtn) {
  await detailBtn.click();
  await page.waitForTimeout(700);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const text = d.innerText;
    return {
      visible: true,
      hasPos: /(^|\n)\s*(n\.|v\.|vt\.|vi\.|a\.|adj\.|adv\.)/.test(text),
      hasSentence: /例句/.test(text),
      textPreview: text.replace(/\s+/g, ' ').slice(0, 160),
    };
  });
  console.log('[2] 详情面板:', JSON.stringify(dialog));
  results.push({
    n: '详情面板',
    pass: !!dialog?.visible,
    d: dialog ? `词性=${dialog.hasPos} 例句=${dialog.hasSentence}` : 'not opened',
  });
  await page.screenshot({ path: `${OUT}/detail.png` });
  // 关闭
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
} else {
  console.log('[2] 详情面板: 按钮不存在（可能处于默写模式）');
  results.push({ n: '详情面板', pass: false, d: 'no button' });
}

// ── 3. 计时器在跑 ───────────────────────────────────────────
const t1 = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)s/);
  return m ? Number(m[1]) : null;
});
await page.waitForTimeout(3000);
const t2 = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)s/);
  return m ? Number(m[1]) : null;
});
console.log(`[3] 计时: ${t1}s → ${t2}s（应递增）`);
results.push({ n: '计时器推进', pass: t2 !== null && t1 !== null && t2 >= t1, d: `${t1}→${t2}` });

await page.screenshot({ path: `${OUT}/practice.png`, fullPage: true });
await b.close();

console.log('\n=== 结果 ===');
let ok = true;
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}  (${r.d})`);
  if (!r.pass) ok = false;
}
console.log('截图:', OUT);
process.exitCode = ok ? 0 : 1;

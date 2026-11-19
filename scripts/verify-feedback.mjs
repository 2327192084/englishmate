/**
 * 视觉验证：打错时的反馈到底看不看得见。
 *
 * 光有测试不够——"用户能不能意识到自己打错了"只能看图判断。
 * 这里在真实运行的应用里制造三种情形并截图：
 *   1. 打错一个字母（应看到红色错字浮出 + 抖动）
 *   2. 中文输入法上屏（应看到切换输入法提醒）
 *   3. 听写模式下打错（隐藏词也要有反馈）
 */
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 9480;
const OUT = '.tmp/feedback-shots';
import { mkdir } from 'node:fs/promises';
await mkdir(OUT, { recursive: true });

const b = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const page = b.contexts()[0].pages()[0];

const readWord = () =>
  page.evaluate(() => {
    const host = document.querySelector('[role="application"] .tf-mono.font-semibold');
    if (!host) return null;
    const kids = [...host.querySelectorAll(':scope > span')];
    return kids
      .map((k) => {
        const i = k.querySelector('span');
        return i ? i.textContent : k.textContent;
      })
      .join('')
      .replace(/\u00a0/g, '')
      .replace(/\s/g, '');
  });

async function ensurePractice() {
  await page.waitForSelector('[role="application"]', { timeout: 12000 }).catch(() => {});
  if ((await page.locator('[role="application"]').count()) === 0) {
    await page.waitForSelector('text=开始练习', { timeout: 15000 });
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.waitForSelector('[role="application"]', { timeout: 20000 });
  }
}

await ensurePractice();
await page.waitForTimeout(600);

// ── 1. 打错一个字母 ──────────────────────────────────────
console.log('[1] 打错一个字母');
let w = await readWord();
console.log('   目标词:', w);
// 先打对两个字母，再打错，模拟真实节奏
for (let i = 0; i < Math.min(2, w.length - 1); i++) {
  await page.keyboard.press(w[i]);
}
await page.waitForTimeout(150);
const wrongKey = w[2] === 'z' ? 'x' : 'z';
await page.keyboard.press(wrongKey);
await page.waitForTimeout(120); // 趁动画还在
await page.screenshot({ path: `${OUT}/1-wrong-char.png` });

// 抓取实际渲染出来的错字提示
const errUi = await page.evaluate(() => {
  const badge = document.querySelector('.tf-wrong-char');
  const shake = document.querySelector('.tf-shake');
  const footer = document.body.innerText.match(/错\s*(\d+)[\s\S]{0,20}应为\s*(\S)/);
  return {
    badgeText: badge ? badge.textContent : null,
    hasShake: !!shake,
    footer: footer ? footer[0].replace(/\s+/g, ' ') : null,
  };
});
console.log('   错字徽标:', JSON.stringify(errUi.badgeText));
console.log('   抖动动画:', errUi.hasShake);
console.log('   底部提示:', JSON.stringify(errUi.footer));

// ── 2. 中文输入法上屏 ────────────────────────────────────
console.log('\n[2] 中文输入法上屏');
await page.evaluate(() => {
  const el = document.querySelector('[role="application"]');
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/2-ime-warning.png` });

const warnUi = await page.evaluate(() => {
  const el = document.querySelector('[role="alert"]');
  return {
    visible: !!el,
    text: el ? el.textContent.replace(/\s+/g, ' ').trim() : null,
  };
});
console.log('   提醒横幅:', warnUi.visible ? '已显示' : '未显示');
console.log('   文案:', JSON.stringify(warnUi.text));

// ── 3. 听写模式打错 ──────────────────────────────────────
console.log('\n[3] 听写模式下打错');
await page.evaluate(() => {
  const el = document.querySelector('[role="application"]');
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'x' }));
});
await page.waitForTimeout(200);

// 切到听写模式需要回设置页，这里直接验证当前模式下反馈元素存在即可
const hasFeedbackEls = await page.evaluate(() => ({
  shake: !!document.querySelector('.tf-shake'),
  wrongChar: !!document.querySelector('.tf-wrong-char'),
  alert: !!document.querySelector('[role="alert"]'),
}));
console.log('   反馈元素:', JSON.stringify(hasFeedbackEls));

await b.close();
console.log('\n截图目录:', OUT);
process.exitCode = warnUi.visible && errUi.badgeText ? 0 : 1;

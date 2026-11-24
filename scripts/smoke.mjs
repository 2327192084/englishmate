/**
 * 真浏览器冒烟测试（一次性工具，不进 CI）。
 * 用系统已装的 Edge，驱动 dist 的 preview 服务，验证：
 *   1. 首屏能渲染（不是白屏）
 *   2. 无 console error / pageerror
 *   3. 真的能开始一轮并敲字
 *   4. 各页面能导航
 * 并截图到 .tmp/shots/ 供人工核对。
 */
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4181';
const OUT = '.tmp/shots';

const errors = [];
const consoleErrors = [];

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  const step = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (e) {
      console.log(`  FAIL ${name}: ${e.message.split('\n')[0]}`);
      throw e;
    }
  };

  await step('打开首页', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=开始练习', { timeout: 15000 });
  });

  await step('词库已从 public/dicts 加载', async () => {
    await page.waitForSelector('text=CET-4', { timeout: 15000 });
    const cet4 = await page.locator('text=CET-4 · 四级核心').first().isVisible();
    if (!cet4) throw new Error('CET-4 词库未显示');
  });

  await page.screenshot({ path: `${OUT}/01-practice-setup.png`, fullPage: true });

  await step('开始一轮练习', async () => {
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.waitForSelector('[role="application"]', { timeout: 15000 });
  });

  // 读出当前目标词，然后逐字敲对
  await step('敲出第一个词', async () => {
    const word = await page
      .locator('.tf-mono.font-semibold')
      .first()
      .evaluate((host) => (host.textContent ?? '').replace(/\u00a0/g, ' ').trim());
    const area = page.locator('[role="application"]');
    for (const ch of word) {
      await area.press(ch === ' ' ? 'Space' : ch);
      await page.waitForTimeout(15);
    }
    // WPM 区域应已出现数字
    await page.waitForSelector('text=WPM', { timeout: 5000 });
  });

  await page.screenshot({ path: `${OUT}/02-practice-typing.png`, fullPage: true });

  await step('提交并进入下一个词', async () => {
    const area = page.locator('[role="application"]');
    await area.press('Enter');
    await page.waitForTimeout(300);
    const progress = await page.locator('text=/\\d+\\/\\d+/').first().innerText();
    if (!progress) throw new Error('进度未显示');
  });

  await step('导航到词库页', async () => {
    await page.goto(`${BASE}/words`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=导入自定义词库', { timeout: 10000 });
  });
  await page.screenshot({ path: `${OUT}/03-words.png`, fullPage: true });

  await step('导航到复习页', async () => {
    await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=复习队列', { timeout: 10000 });
  });

  await step('导航到文章页', async () => {
    await page.goto(`${BASE}/articles`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=文章练习', { timeout: 10000 });
  });
  await page.screenshot({ path: `${OUT}/04-articles.png`, fullPage: true });

  await step('导航到数据页', async () => {
    await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=学习数据', { timeout: 10000 });
  });

  await step('导航到成就页', async () => {
    await page.goto(`${BASE}/achievements`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=第一步', { timeout: 10000 });
  });

  await step('导航到设置页', async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=学习目标', { timeout: 10000 });
  });
  await page.screenshot({ path: `${OUT}/05-settings.png`, fullPage: true });

  await step('浅色主题切换', async () => {
    await page.getByRole('button', { name: '浅色' }).last().click();
    await page.waitForTimeout(400);
    const cls = await page.locator('html').getAttribute('class');
    if (!cls?.includes('theme-light')) throw new Error(`主题未切换: ${cls}`);
    await page.screenshot({ path: `${OUT}/06-light.png`, fullPage: true });
    // 切回深色
    await page.getByRole('button', { name: '深色' }).first().click();
    await page.waitForTimeout(300);
  });

  await step('移动端布局', async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await m.waitForSelector('text=开始练习', { timeout: 10000 });
    await m.screenshot({ path: `${OUT}/07-mobile.png`, fullPage: true });
    await m.close();
  });

  await browser.close();

  console.log('\n=== 汇总 ===');
  console.log('pageerror:', errors.length);
  errors.forEach((e) => console.log('  !', e));
  // favicon 之类的 404 会进 console error，单独看
  const realConsole = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('manifest'),
  );
  console.log('console.error:', realConsole.length);
  realConsole.forEach((e) => console.log('  !', e));

  if (errors.length || realConsole.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('冒烟测试失败:', e.message);
  process.exitCode = 1;
});

/**
 * 持久化实测：练一轮 → 刷新页面 → 记录还在吗？
 *
 * 本地优先是这个项目的核心承诺，而刷新后丢数据是 IndexedDB 最容易踩的坑
 * （比如写入时机在 effect 里但页面先卸载了）。必须真跑一遍。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4185';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

async function readDb() {
  return page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('englishmate');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['userWords', 'sessions'], 'readonly');
        const w = tx.objectStore('userWords').count();
        const s = tx.objectStore('sessions').count();
        tx.oncomplete = () => resolve({ words: w.result, sessions: s.result });
      };
      req.onerror = () => resolve({ error: 'open failed' });
    });
  });
}

console.log('1) 打开首页');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('text=开始练习');
console.log('   db before:', JSON.stringify(await readDb()));

console.log('2) 开始一轮，敲 3 个词');
await page.getByRole('button', { name: '开始', exact: true }).click();
await page.waitForSelector('[role="application"]');

const area = page.locator('[role="application"]');
for (let n = 0; n < 3; n++) {
  // 目标词显示在 .tf-mono.font-semibold 里
  const word = (await page.locator('.tf-mono.font-semibold').first().innerText()).replace(
    /\s/g,
    '',
  );
  for (const ch of word) {
    await area.press(ch);
    await page.waitForTimeout(10);
  }
  await area.press('Space');
  await page.waitForTimeout(120);
}
console.log(`   敲完 3 个词`);

// 等落库
await page.waitForTimeout(1200);
const afterTyping = await readDb();
console.log('   db after typing:', JSON.stringify(afterTyping));

console.log('3) 刷新页面');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=开始练习', { timeout: 15000 });
const afterReload = await readDb();
console.log('   db after reload:', JSON.stringify(afterReload));

console.log('4) 检查练习页是否反映已学进度');
const progressText = await page.locator('text=/今日已学/').first().innerText();
console.log('   ', progressText.replace(/\s+/g, ' ').trim());

console.log('5) 检查复习页是否能看到到期的词');
await page.goto(`${BASE}/review`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=复习队列');
const reviewInfo = await page.evaluate(() => {
  const nums = [...document.querySelectorAll('.tf-mono')]
    .slice(0, 6)
    .map((e) => e.textContent?.trim());
  return { visible: document.body.innerText.includes('学习中'), nums };
});
console.log('   review page:', JSON.stringify(reviewInfo));

console.log('6) 数据页是否能显示统计');
await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=学习数据');
const hasData = await page.evaluate(() => !document.body.innerText.includes('还没有学习数据'));
console.log('   stats has data:', hasData);
await page.screenshot({ path: '.tmp/shots/10-stats-with-data.png', fullPage: true });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=开始练习');
await page.screenshot({ path: '.tmp/shots/11-setup-after-reload.png', fullPage: true });

await browser.close();

const ok =
  afterTyping.words >= 3 &&
  afterTyping.sessions >= 1 &&
  afterReload.words === afterTyping.words &&
  afterReload.sessions === afterTyping.sessions &&
  hasData &&
  errors.length === 0;

console.log('\n=== 结论 ===');
console.log(
  '持久化:',
  afterReload.words === afterTyping.words && afterTyping.words >= 3 ? 'PASS' : 'FAIL',
);
console.log('统计有数据:', hasData ? 'PASS' : 'FAIL');
console.log('pageerror:', errors.length);
if (!ok) process.exitCode = 1;

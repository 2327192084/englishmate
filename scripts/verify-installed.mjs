/**
 * 用 CDP 驱动**已安装的打包版**，验证真实持久化。
 *
 * 这一步是最终验收：不是测源码，而是测用户桌面上那个 exe。
 *   1. 在真实应用里练完一轮
 *   2. 确认词进了 IndexedDB
 *   3. 杀掉进程重启
 *   4. 再连上去确认数据仍在、今日已学计数正确
 */
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 9444;
const BASE = `http://127.0.0.1:${PORT}`;

async function connect() {
  const list = await fetch(`${BASE}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到页面 target');
  return chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
}

const readDb = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const q = indexedDB.open('typeflow');
        q.onsuccess = () => {
          const db = q.result;
          const names = [...db.objectStoreNames];
          if (!names.includes('userWords')) return resolve({ words: 0, sessions: 0, noStore: true });
          const tx = db.transaction(['userWords', 'sessions'], 'readonly');
          const w = tx.objectStore('userWords').count();
          const s = tx.objectStore('sessions').count();
          tx.oncomplete = () => {
            db.close();
            resolve({ words: w.result, sessions: s.result });
          };
        };
        q.onerror = () => resolve({ error: String(q.error) });
      }),
  );

async function main() {
  const browser = await connect();
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.waitForSelector('text=开始练习', { timeout: 20000 });
  const before = await readDb(page);
  console.log('1) 启动后数据库:', JSON.stringify(before));

  // 先确保点一次窗口以获得焦点（练习区靠 keydown）
  await page.locator('[role="application"]').count().catch(() => 0);

  console.log('2) 开始一轮');
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await page.waitForSelector('[role="application"]', { timeout: 20000 });

  // 敲 3 个词（用 CDP 的 key 事件，走真实 keydown 路径）
  for (let n = 0; n < 3; n++) {
    const word = await page.evaluate(() => {
      const host = document.querySelector('[role="application"] .tf-mono.font-semibold');
      if (!host) return null;
      const kids = host.querySelectorAll(':scope > span');
      const raw = kids.length
        ? [...kids].map((k) => (k.querySelector('span') ? k.querySelector('span').textContent : k.textContent)).join('')
        : host.textContent;
      return raw.replace(/\u00a0/g, ' ').replace(/\s/g, '');
    });
    if (!word) break;
    for (const ch of word) {
      await page.keyboard.press(ch);
    }
    await page.keyboard.press('Space');
    await page.waitForTimeout(220);
  }

  await page.waitForTimeout(2000);
  const after = await readDb(page);
  console.log('3) 练习后数据库:', JSON.stringify(after));

  const progress = await page
    .evaluate(() => {
      const m = document.body.innerText.match(/今日已学\s*(\d+)/);
      return m ? m[1] : '?';
    })
    .catch(() => '?');

  await browser.close();

  console.log('4) 记录今日计数快照:', progress);
  console.log('\n=== 练习阶段结论 ===');
  console.log('写入成功:', after.words >= 3 ? 'PASS' : 'FAIL (' + JSON.stringify(after) + ')');

  // 把结果写文件，供下一步重启后对比
  const fs = await import('node:fs');
  fs.writeFileSync('.tmp/persist-phase1.json', JSON.stringify({ after, progress }, null, 2));
  process.exitCode = after.words >= 3 ? 0 : 1;
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exitCode = 1;
});
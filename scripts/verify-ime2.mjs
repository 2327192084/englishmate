/**
 * 在已安装的真实应用里验证「大小写 / 输入法 / 全角」三处修复。
 *
 * 判定以练习区状态为准：
 *  - 打对字符数 = 内层 span 带 text-correct 的字符数（光标位不算）
 *  - 错误次数   = 底部指标条的「错 N」
 * 另外检查数据库里有没有正常词被误捕进错词本。
 */
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 9470;
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
      .replace(/\u00a0/g, ' ')
      .trim();
  });

const read = () =>
  page.evaluate(() => {
    const host = document.querySelector('[role="application"] .tf-mono.font-semibold');
    if (!host) return { noArea: true, correct: -1, mistakes: null };
    const kids = [...host.querySelectorAll(':scope > span')];
    let correct = 0;
    for (const k of kids) {
      const inner = k.querySelector('span');
      if (inner && inner.className.split(/\s+/).includes('text-correct')) correct++;
    }
    const m = document.body.innerText.match(/错\s*(\d+)/);
    return { correct, total: kids.length, mistakes: m ? Number(m[1]) : null };
  });

async function ensurePractice() {
  await page.waitForSelector('[role="application"]', { timeout: 15000 }).catch(() => {});
  if ((await page.locator('[role="application"]').count()) === 0) {
    await page.waitForSelector('text=开始练习', { timeout: 15000 });
  }
  if ((await page.locator('[role="application"]').count()) === 0) {
    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.waitForSelector('[role="application"]', { timeout: 25000 });
  }
}

const results = [];

await ensurePractice();
await page.waitForTimeout(500);

// ── 1. 全程大写 ────────────────────────────────────────────
console.log('\n[1] CapsLock 全程大写');
let w = await readWord();
for (const ch of w.toUpperCase()) await page.keyboard.press(ch === ' ' ? 'Space' : ch);
await page.waitForTimeout(450);
let r = await read();
console.log(`   目标=${w}  打对=${r.correct}/${w.length}  错=${r.mistakes}`);
results.push({
  n: 'CapsLock 大写',
  pass: r.correct === w.length && r.mistakes === 0,
  d: `${r.correct}/${w.length} 错=${r.mistakes}`,
});
await page.keyboard.press('Enter');
await page.waitForTimeout(600);

// ── 2. 输入法组字 ──────────────────────────────────────────
console.log('\n[2] 输入法组字');
w = await readWord();
await page.evaluate(() => {
  const el = document.querySelector('[role="application"]');
  el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  for (const ch of 'nihao') {
    const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true });
    Object.defineProperty(ev, 'isComposing', { get: () => true });
    el.dispatchEvent(ev);
  }
});
await page.waitForTimeout(350);
const mid = await read();
console.log(`   组字中：打对=${mid.correct} 错=${mid.mistakes}（拼音不该算答题）`);
results.push({
  n: '组字期间不录入',
  pass: mid.correct === 0 && mid.mistakes === 0,
  d: `打对=${mid.correct} 错=${mid.mistakes}`,
});

await page.evaluate((word) => {
  const el = document.querySelector('[role="application"]');
  el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: word }));
}, w);
await page.waitForTimeout(600);
const after = await read();
console.log(`   上屏后：打对=${after.correct}/${w.length} 错=${after.mistakes}`);
results.push({
  n: '输入法上屏判定',
  pass: after.correct === w.length && after.mistakes === 0,
  d: `${after.correct}/${w.length} 错=${after.mistakes}`,
});
await page.keyboard.press('Enter');
await page.waitForTimeout(600);

// ── 3. 全角字符 ────────────────────────────────────────────
console.log('\n[3] 全角字符（中文输入法常见）');
w = await readWord();
await page.evaluate((word) => {
  const el = document.querySelector('[role="application"]');
  for (const ch of word) {
    const c = ch.charCodeAt(0);
    const f = c >= 0x21 && c <= 0x7e ? String.fromCharCode(c + 0xfee0) : ch;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: f, bubbles: true }));
  }
}, w);
await page.waitForTimeout(450);
const fw = await read();
console.log(`   目标=${w}  打对=${fw.correct}/${w.length}  错=${fw.mistakes}`);
results.push({
  n: '全角字符',
  pass: fw.correct === w.length && fw.mistakes === 0,
  d: `${fw.correct}/${w.length} 错=${fw.mistakes}`,
});

// ── 4. 落库检查 ────────────────────────────────────────────
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
const db = await page.evaluate(
  () =>
    new Promise((res) => {
      const q = indexedDB.open('englishmate');
      q.onsuccess = () => {
        const d = q.result;
        const tx = d.transaction('userWords', 'readonly');
        const all = tx.objectStore('userWords').getAll();
        tx.oncomplete = () => {
          d.close();
          const rows = all.result || [];
          res({ total: rows.length, wrong: rows.filter((x) => x.mistakes > 0).map((x) => x.word) });
        };
      };
      q.onerror = () => res({ total: 0, wrong: ['<db error>'] });
    }),
);
console.log('\n数据库:', JSON.stringify(db));
results.push({
  n: '正常输入不进错词本',
  pass: db.wrong.length === 0,
  d: JSON.stringify(db.wrong),
});

await b.close();
console.log('\n=== 结果 ===');
let ok = true;
for (const x of results) {
  console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.n}  (${x.d})`);
  if (!x.pass) ok = false;
}
process.exitCode = ok ? 0 : 1;

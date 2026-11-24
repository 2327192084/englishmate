/**
 * 验证「已安装的 EnglishMate」这份桌面包能真正跑起来。
 *
 * 与 smoke.cjs 的区别：smoke.cjs 测仓库里的 electron/main.cjs 直接拉起；
 * 这里测的是**安装/分发目录**（ISCC 编译的安装包装出来的那种布局），
 * 断言同源（app://englishmate）与数据可见性。
 *
 * 用 playwright 拉起 EnglishMate.exe，检查：
 *  1. 页面渲染出来了（不是白屏）
 *  2. origin 是 app://englishmate（IndexedDB 数据与 origin 绑定，origin 一变
 *     库名就从 app_englishmate_0 变掉，进度当场不可见）
 *  3. IndexedDB 里能读到之前的库（englishmate 库存在）
 *  4. 例句/文章资源能被 fetch 到
 */
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

// 用法：node electron/verify-desktop.cjs [exe 所在目录]
// 不传参数时验证「已安装」的那份；传 release/EnglishMate 可以验证待分发的包
const APP_DIR = process.argv[2] || path.join(process.env.LOCALAPPDATA, 'Programs', 'EnglishMate');
const EXE = path.join(APP_DIR, 'EnglishMate.exe');
const SHOTS = path.join(__dirname, '..', '.tmp', 'desktop-shots');

const log = (...a) => console.log(...a);

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!fs.existsSync(EXE)) throw new Error('找不到 EnglishMate.exe: ' + EXE);

  const app = await _electron.launch({
    executablePath: EXE,
    args: ['--no-sandbox'],
    timeout: 60000,
  });

  const win = await app.firstWindow({ timeout: 60000 });

  // 控制台错误从第一个窗口就挂上监听：放到最后才挂会漏掉首屏加载期的资源 404，
  // 而首屏恰恰是最容易因为 dist 拷漏文件而报错的地方。
  const consoleErrors = [];
  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  win.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e)));

  await win.waitForLoadState('domcontentloaded');
  await new Promise((r) => setTimeout(r, 3500));

  const check = async (name, fn) => {
    const v = await fn();
    log('  ok  ' + name + (v !== undefined ? ': ' + JSON.stringify(v) : ''));
  };

  try {
    await check('页面已渲染（非白屏）', async () => {
      const text = await win.evaluate(() => document.body.innerText.slice(0, 200));
      if (!text.includes('开始练习')) throw new Error('停留于: ' + text.slice(0, 80));
      return 'ok';
    });

    await check('origin 是 app://englishmate（IndexedDB 数据可见）', async () => {
      const o = await win.evaluate(() => window.location.origin);
      // 这条钉的是 origin 与库名的绑定。origin 一变，IndexedDB 就是另一个库
      // （app_englishmate_0 → app_xxx_0），用户的学习进度当场不可见。
      if (o !== 'app://englishmate') throw new Error('origin=' + o);
      return o;
    });

    await check('preload 生效 / Node 已隔离', async () => {
      const r = await win.evaluate(() =>
        JSON.stringify({
          desktop: !!(window.englishmate && window.englishmate.isDesktop),
          node: typeof process !== 'undefined' || typeof require !== 'undefined',
        }),
      );
      const o = JSON.parse(r);
      if (!o.desktop) throw new Error('window.englishmate.isDesktop 缺失');
      if (o.node) throw new Error('Node 未被隔离');
      return o;
    });

    await check('旧学习数据可见（englishmate 库能打开并读出条数）', async () => {
      const r = await win.evaluate(
        () =>
          new Promise((res) => {
            const t = setTimeout(() => res('timeout'), 8000);
            const finish = (v) => {
              clearTimeout(t);
              res(v);
            };
            try {
              const q = indexedDB.open('englishmate');
              q.onerror = () => finish('err:' + (q.error && q.error.name));
              q.onsuccess = async () => {
                const db = q.result;
                const names = Array.from(db.objectStoreNames);
                const count = (store) =>
                  new Promise((ok) => {
                    try {
                      const rq = db.transaction(store, 'readonly').objectStore(store).count();
                      rq.onsuccess = () => ok(rq.result);
                      rq.onerror = () => ok(-1);
                    } catch {
                      ok(-1);
                    }
                  });
                // 只读条数，不碰内容：验证脚本不该写用户的库
                const out = { version: db.version, stores: names.length };
                for (const s of ['userWords', 'sessions', 'achievements', 'settings']) {
                  out[s] = names.includes(s) ? await count(s) : -1;
                }
                db.close();
                finish(JSON.stringify(out));
              };
            } catch (e) {
              finish('throw:' + e.message);
            }
          }),
      );
      if (typeof r !== 'string' || !r.startsWith('{')) throw new Error(String(r));
      const o = JSON.parse(r);
      // 表存在但空：说明这是个全新配置（或者数据真没了）。两种都值得看见，
      // 但只有「schema 都读不出来」才算失败——那是包坏了，不是用户还没开始学。
      if (!o.stores) throw new Error('读不到任何表，schema 丢失：' + r);
      return o;
    });

    await check('新产物 article-glossary.json 可被页面加载', async () => {
      const r = await win.evaluate(async () => {
        const res = await fetch('./dicts/article-glossary.json');
        if (!res.ok) return 'status:' + res.status;
        const j = await res.json();
        return JSON.stringify({
          entries: Object.keys(j.entries || {}).length,
          variants: Object.keys(j.variants || {}).length,
        });
      });
      const o = JSON.parse(r);
      if (!o.entries || o.entries < 1000) throw new Error('词条数异常: ' + r);
      return o;
    });

    await check('句子练习页存在（本轮新页面）', async () => {
      const has = await win.evaluate(() => {
        const as = Array.from(document.querySelectorAll('a'));
        return as.some((a) => (a.getAttribute('href') || '').includes('/sentences'));
      });
      if (!has) throw new Error('导航里找不到 /sentences');
      return 'ok';
    });

    await check('首屏 + 刷新全程无控制台错误', async () => {
      if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(' | '));
      await win.reload();
      await new Promise((r) => setTimeout(r, 2500));
      if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(' | '));
      return 'clean';
    });

    await win.screenshot({ path: path.join(SHOTS, 'englishmate-updated.png'), fullPage: false });
    log('\n截图: ' + path.join(SHOTS, 'englishmate-updated.png'));
    log('\n✓ 桌面包验证全部通过');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\n✗ 验证失败: ' + e.message);
  process.exit(1);
});

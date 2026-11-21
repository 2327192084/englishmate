/**
 * 验证「已安装的 TypeFlow」这份桌面包能真正跑起来。
 *
 * 为什么单独写一个脚本而不是用 electron/smoke.cjs：
 * smoke.cjs 测的是仓库里的 electron/main.cjs（origin 是 app://englishmate），
 * 而实际安装的那份 main.cjs 仍是旧名 app://typeflow。两者的 IndexedDB origin
 * 不同，用 smoke 去测装的那份会得到「origin 不符」的假失败。
 *
 * 这里直接用 playwright 拉起 TypeFlow.exe，检查：
 *  1. 页面渲染出来了（不是白屏）
 *  2. origin 是 app://typeflow（说明旧数据仍然可见）
 *  3. IndexedDB 里能读到之前的库（englishmate 库存在）
 *  4. 新增的点词释义资源能被 fetch 到（这是这次更新的核心产物）
 */
const path = require('node:path');
const fs = require('node:fs');
const { _electron } = require('playwright-core');

// 用法：node electron/verify-desktop.cjs [exe 所在目录]
// 不传参数时验证「已安装」的那份；传 release/TypeFlow 可以验证待分发的包
const APP_DIR = process.argv[2] || path.join(process.env.LOCALAPPDATA, 'Programs', 'TypeFlow');
const EXE = path.join(APP_DIR, 'TypeFlow.exe');
const SHOTS = path.join(__dirname, '..', '.tmp', 'desktop-shots');

const log = (...a) => console.log(...a);

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (!fs.existsSync(EXE)) throw new Error('找不到 TypeFlow.exe: ' + EXE);

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

    await check('origin 是 app://typeflow（旧 IndexedDB 数据仍可见）', async () => {
      const o = await win.evaluate(() => window.location.origin);
      if (o !== 'app://typeflow') throw new Error('origin=' + o);
      return o;
    });

    await check('preload 生效 / Node 已隔离', async () => {
      const r = await win.evaluate(() =>
        JSON.stringify({
          desktop: !!(window.typeflow && window.typeflow.isDesktop),
          node: typeof process !== 'undefined' || typeof require !== 'undefined',
        }),
      );
      const o = JSON.parse(r);
      if (!o.desktop) throw new Error('window.typeflow.isDesktop 缺失');
      if (o.node) throw new Error('Node 未被隔离');
      return o;
    });

    await check('旧学习数据可见（englishmate 库能打开并读表）', async () => {
      const r = await win.evaluate(
        () =>
          new Promise((res) => {
            const t = setTimeout(() => res('timeout'), 5000);
            try {
              const q = indexedDB.open('englishmate');
              q.onerror = () => {
                clearTimeout(t);
                res('err:' + (q.error && q.error.name));
              };
              q.onsuccess = () => {
                const db = q.result;
                const names = Array.from(db.objectStoreNames);
                const tx = db.transaction('settings', 'readonly');
                const g = tx.objectStore('settings').get(1);
                g.onsuccess = () => {
                  clearTimeout(t);
                  db.close();
                  res(JSON.stringify({ stores: names.length, hasSettings: !!g.result }));
                };
                g.onerror = () => {
                  clearTimeout(t);
                  db.close();
                  res('settings-read-err');
                };
              };
            } catch (e) {
              clearTimeout(t);
              res('throw:' + e.message);
            }
          }),
      );
      if (typeof r !== 'string' || !r.startsWith('{')) throw new Error(String(r));
      const o = JSON.parse(r);
      if (!o.hasSettings) throw new Error('settings 表里没有记录，可能数据没了：' + r);
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

    await win.screenshot({ path: path.join(SHOTS, 'typeflow-updated.png'), fullPage: false });
    log('\n截图: ' + path.join(SHOTS, 'typeflow-updated.png'));
    log('\n✓ 桌面包验证全部通过');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error('\n✗ 验证失败: ' + e.message);
  process.exit(1);
});

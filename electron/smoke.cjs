/**
 * Electron 桌面版冒烟测试（真窗口，真协议，真 IndexedDB）。
 */
const { app, BrowserWindow, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SCHEME = 'app';
const APP_HOST = 'englishmate';
const APP_ORIGIN = `${SCHEME}://${APP_HOST}`;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const SHOTS = path.join(__dirname, '..', '.tmp', 'desktop-shots');
const errors = [];
const consoleErrors = [];
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

// 与 main.cjs 保持一致的 userData 回退（否则默认路径 EPERM 会拖垮 IndexedDB）
function resolveUserDataDir() {
  const os = require('node:os');
  const cands = [];
  if (process.env.LOCALAPPDATA) cands.push(path.join(process.env.LOCALAPPDATA, 'EnglishMate'));
  try { cands.push(path.join(app.getPath('appData'), 'EnglishMate')); } catch {}
  cands.push(path.join(os.tmpdir(), 'EnglishMate'));
  for (const d of cands) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const f = path.join(d, '.wp');
      fs.writeFileSync(f, 'x');
      fs.unlinkSync(f);
      return d;
    } catch {}
  }
  return null;
}
const udd = resolveUserDataDir();
if (udd) {
  app.setPath('userData', udd);
  try { app.setPath('sessionData', udd); } catch {}
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

function serve(request) {
  const { pathname } = new URL(request.url);
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  let target = path.normalize(path.join(DIST_DIR, rel));
  if (!target.startsWith(DIST_DIR)) return new Response('nf', { status: 404 });
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    if (!path.extname(target)) target = path.join(DIST_DIR, 'index.html');
    else return new Response('nf', { status: 404 });
  }
  return new Response(fs.readFileSync(target), {
    status: 200,
    headers: { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' },
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  protocol.handle(SCHEME, serve);

  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('pageerror', (e) => errors.push(String(e)));
  win.webContents.on('console-message', (e) => {
    const lvl = e.level ?? arguments[1];
    if (lvl === 'error' || lvl === 3) consoleErrors.push(e.message ?? '');
  });

  log('userData:', udd || '(默认)');
  log('打开:', `${APP_ORIGIN}/`);
  await win.loadURL(`${APP_ORIGIN}/`);
  await wait(3000);

  const check = async (name, fn) => {
    const v = await fn();
    log('  ok  ' + name + (v !== undefined ? ': ' + JSON.stringify(v) : ''));
  };

  await check('页面已渲染（非白屏）', async () => {
    const text = await win.webContents.executeJavaScript('document.body.innerText.slice(0,200)');
    if (!text.includes('开始练习')) throw new Error('停留于: ' + text.slice(0, 60));
    return 'ok';
  });

  await check('origin 是 app://englishmate（标准安全源）', async () => {
    const o = await win.webContents.executeJavaScript('window.location.origin');
    if (o !== APP_ORIGIN) throw new Error('origin=' + o);
    return o;
  });

  await check('IndexedDB 可用', async () => {
    const r = await win.webContents.executeJavaScript(`
      new Promise((res) => {
        const t = setTimeout(() => res('timeout'), 3000);
        try {
          const q = indexedDB.open('probe-db');
          q.onsuccess = () => { clearTimeout(t); q.result.close(); res('ok'); };
          q.onerror = () => { clearTimeout(t); res('err:' + (q.error && q.error.name)); };
        } catch (e) { clearTimeout(t); res('throw:' + e.message); }
      })
    `);
    if (r !== 'ok') throw new Error('IndexedDB: ' + r);
    return r;
  });

  await check('preload 生效 / Node 已隔离', async () => {
    const r = await win.webContents.executeJavaScript(
      'JSON.stringify({ desktop: !!(window.englishmate && window.englishmate.isDesktop), node: typeof require !== "undefined" || typeof process !== "undefined" })'
    );
    const o = JSON.parse(r);
    if (!o.desktop) throw new Error('preload 未注入');
    if (o.node) throw new Error('渲染进程可访问 Node');
    return o;
  });

  await check('词库可从 app:// 读取', async () => {
    const r = await win.webContents.executeJavaScript(`
      fetch('dicts/index.json').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP '+r.status)))
        .then(d => ({ banks: d.banks.length, first: d.banks[0].id })).catch(e => ({ error: String(e) }))
    `);
    if (r.error) throw new Error(r.error);
    if (r.banks !== 16) throw new Error('banks=' + r.banks);
    return r;
  });

  await win.webContents.capturePage().then(img => fs.writeFileSync(path.join(SHOTS, 'd1-setup.png'), img.toPNG()));

  await check('开始一轮练习', async () => {
    await win.webContents.executeJavaScript(`
      (() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '开始'); if (!b) throw new Error('无开始按钮'); b.click(); })()
    `);
    await wait(2500);
    const has = await win.webContents.executeJavaScript('!!document.querySelector(\'[role="application"]\')');
    if (!has) throw new Error('打字区未出现');
    return 'ok';
  });

  /** 从页面 DOM 里精确读出当前目标词（逐字符 span 拼起来，去掉空白） */
  const readTargetWord = () =>
    win.webContents.executeJavaScript(`
      (() => {
        const host = document.querySelector('[role="application"] .tf-mono.font-semibold');
        if (!host) return null;
        // 用 textContent 而非 innerText：flex 布局会让 innerText 插入换行
        // 用 host 直属子 span 的文本，避免 span span 重复匹配内外两层
        const kids = host.querySelectorAll(':scope > span');
        const raw = kids.length
          ? [...kids].map(k => k.querySelector('span') ? k.querySelector('span').textContent : k.textContent).join('')
          : host.textContent;
        return raw.replace(/\u00a0/g, ' ').trim();
      })()
    `);

  await check('敲字推进光标', async () => {
    const word = await readTargetWord();
    if (!word) throw new Error('读不到目标词');
    for (let i = 0; i < Math.min(3, word.length); i++) {
      const keyCode = word[i] === ' ' ? 'Space' : word[i];
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, key: word[i] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, key: word[i] });
      await wait(80);
    }
    await wait(400);
    const n = await win.webContents.executeJavaScript('document.querySelectorAll(".text-correct").length');
    if (n <= 0) throw new Error('无正确字符');
    return { correct: n, word };
  });

  await win.webContents.capturePage().then(img => fs.writeFileSync(path.join(SHOTS, 'd2-typing.png'), img.toPNG()));

  await check('敲完整词 + 提交，数据写入 IndexedDB', async () => {
    const word = await readTargetWord();
    if (!word) throw new Error('读不到目标词');
    const done = await win.webContents.executeJavaScript('document.querySelectorAll(".text-correct").length');
    for (let i = done; i < word.length; i++) {
      const keyCode = word[i] === ' ' ? 'Space' : word[i];
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, key: word[i] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, key: word[i] });
      await wait(45);
    }
    await wait(200);
    // Enter 提交并进入下一个词，Space 留给多词拼写。
    // 注意：必须用 keyDown + 明确的 key 字段。type:'char' 在 Electron 里
    // 不会给出 e.key，React 的 onKeyDown 收不到，提交动作不会触发。
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', key: 'Enter' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', key: 'Enter' });
    await wait(1800);

    const n0 = await win.webContents.executeJavaScript(`
      new Promise((res) => {
        const q = indexedDB.open('englishmate');
        q.onsuccess = () => {
          const db = q.result;
          if (!db.objectStoreNames.contains('userWords')) return res(0);
          const tx = db.transaction('userWords','readonly');
          const c = tx.objectStore('userWords').count();
          tx.oncomplete = () => { db.close(); res(c.result); };
        };
        q.onerror = () => res(-1);
      })
    `);
    if (n0 <= 0) throw new Error('提交后仍无记录: ' + n0);
    return { words: n0 };
  });

  await check('（补充）直接查库再确认一次', async () => {
    const n = await win.webContents.executeJavaScript(`
      new Promise((res) => {
        const q = indexedDB.open('englishmate');
        q.onsuccess = () => {
          const db = q.result;
          if (!db.objectStoreNames.contains('userWords')) return res(0);
          const tx = db.transaction('userWords','readonly');
          const c = tx.objectStore('userWords').count();
          tx.oncomplete = () => { db.close(); res(c.result); };
        };
        q.onerror = () => res(-1);
      })
    `);
    if (n <= 0) throw new Error('数据库里没有词记录: ' + n);
    return { words: n };
  });

  log('');
  log('=== 汇总 ===');
  log('pageerror: ' + errors.length);
  errors.forEach(e => log('  ! ' + e));
  const real = consoleErrors.filter(e => !/favicon|manifest|DevTools|Autofill/i.test(e));
  log('console.error: ' + real.length);
  real.forEach(e => log('  ! ' + e));
  log('截图目录: ' + SHOTS);
  app.exit(errors.length === 0 && real.length === 0 ? 0 : 1);
}

app.whenReady().then(main).catch(e => { log('异常: ' + e.message); app.exit(1); });

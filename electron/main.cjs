/**
 * EnglishMate · Electron 主进程
 *
 * ── 为什么用自定义协议 app:// 而不是直接 loadFile ──────────────────────────
 * 实测：file:// 下 Chromium 的 IndexedDB 会直接返回 `UnknownError`（origin 是 "file://"，
 * 是不透明源，存储被禁用）。而本项目所有学习数据都存在 IndexedDB 里，
 * 用 file:// 打开会卡在"正在加载本地数据…"永不进入。
 *
 * 解决办法是注册一个标准、安全的自定义协议 app://englishmate/，把 dist 目录映射上去。
 * 这样页面有了正常的 origin（app://englishmate），IndexedDB / localStorage /
 * fetch 相对路径全部恢复正常语义，也不需要给 file 协议开特权。
 *
 * 安全边界：
 *  - 只暴露 dist 目录，路径经过规范化校验，不允许 ../ 逃逸
 *  - 渲染进程 nodeIntegration:false + contextIsolation + sandbox
 *  - 外域链接走系统浏览器，窗口内禁止导航
 *  - 权限申请一律拒绝
 */
const { app, BrowserWindow, protocol, shell, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';

const SCHEME = 'app';
const APP_HOST = 'englishmate';
const APP_ORIGIN = `${SCHEME}://${APP_HOST}`;
/**
 * dist 目录的位置随运行方式而变：
 *   开发 / 打包进 asar：__dirname 是 electron/ 或 app.asar，dist 在上一级
 *   手工组装的运行目录：__dirname 是 resources/app，dist 就在同级
 * 按实际存在性挑，避免写死导致白屏。
 */
function resolveDistDir() {
  const candidates = [path.join(__dirname, 'dist'), path.join(__dirname, '..', 'dist')];
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, 'index.html'))) return d;
  }
  return candidates[1];
}

const DIST_DIR = resolveDistDir();

/** 必须在 app ready 之前声明为「标准 + 安全」，否则 IDB 和 fetch 不会按正常源处理 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      // 关键：非 http(s) 的标准协议默认拿不到存储配额，
      // 不加这个 IndexedDB 会抛 UnknownError，Dexie 只能反复重试
      allowServiceWorkers: false,
      bypassCSP: false,
    },
  },
]);

/**
 * ── 为什么必须显式指定数据目录 ────────────────────────────────────────────
 * Chromium 把所有站点数据（IndexedDB/localStorage/缓存）放在 userData 下。
 * 实测本机：默认路径 %APPDATA%\Electron 对 Electron 进程返回 EPERM
 * （而 PowerShell / 纯 Node 可写，属该目录被第三方创建并锁住的环境问题），
 * 导致 IndexedDB 抛 UnknownError，页面永远卡在"正在加载本地数据…"。
 *
 * 做法：给应用一个自己的、能确保可写的目录，并按优先级回退。
 * 这样既不依赖那个被锁的目录，也符合"每个应用一份数据"的惯例。
 */
function resolveUserDataDir() {
  const candidates = [];
  // 1) %LOCALAPPDATA%\EnglishMate —— 本机已验证可写（openLearner 就装在这里）
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'EnglishMate'));
  }
  // 2) 标准位置 %APPDATA%\EnglishMate（部分机器上该目录会被第三方锁住）
  try {
    candidates.push(path.join(app.getPath('appData'), 'EnglishMate'));
  } catch {
    /* ignore */
  }
  // 3) 便携模式：exe 同级 data 目录（U 盘 / 受限环境）
  //    注意安装目录可能无写权限，所以排在 LOCALAPPDATA 之后
  candidates.push(path.join(path.dirname(app.getPath('exe')), 'data'));
  // 4) 兜底：临时目录（至少能跑，虽然重启会丢缓存以外的数据）
  candidates.push(path.join(require('node:os').tmpdir(), 'EnglishMate'));

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-probe');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

const userDataDir = resolveUserDataDir();
if (userDataDir) {
  app.setPath('userData', userDataDir);
  // 新版 Electron 把缓存单独放在 sessionData，一并指过去
  try {
    app.setPath('sessionData', userDataDir);
  } catch {
    /* 旧版本没有这个路径，忽略 */
  }
}

let mainWindow = null;

function isInternalUrl(url) {
  if (url.startsWith(`${APP_ORIGIN}/`)) return true;
  if (url === APP_ORIGIN) return true;
  if (isDev && url.startsWith(DEV_URL)) return true;
  return false;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

/**
 * 把 app:// 请求映射到 dist 下的真实文件。
 * 越界（../）与不存在统一返回 404，不泄露磁盘结构。
 */
function resolveAssetPath(requestUrl) {
  const { pathname } = new URL(requestUrl);
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // 规范化后必须仍在 dist 内，防止 ../ 穿越
  const target = path.normalize(path.join(DIST_DIR, rel));
  const rootWithSep = DIST_DIR.endsWith(path.sep) ? DIST_DIR : DIST_DIR + path.sep;
  if (target !== DIST_DIR && !target.startsWith(rootWithSep)) return null;
  return target;
}

async function serveAppProtocol(request) {
  const filePath = resolveAssetPath(request.url);
  if (!filePath) {
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }

  // SPA 回退：没有扩展名的路径当作前端路由，返回 index.html
  if (!stat || !stat.isFile()) {
    const ext = path.extname(filePath);
    if (!ext) {
      return respondWithFile(path.join(DIST_DIR, 'index.html'));
    }
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return respondWithFile(filePath);
}

function respondWithFile(filePath) {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return new Response(data, {
    status: 200,
    headers: {
      'content-type': MIME[ext] || 'application/octet-stream',
      // 本地资源不需要缓存协商，但保留一个短缓存避免重复 IO
      'cache-control': 'no-cache',
    },
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0d1117',
    title: 'EnglishMate',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadURL(`${APP_ORIGIN}/`);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _p, callback) => callback(false));

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isDev) return;
    const key = input.key.toLowerCase();
    if ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key)) {
      event.preventDefault();
    }
    if (key === 'f12') event.preventDefault();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, serveAppProtocol);
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

ipcMain.handle('englishmate:version', () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return { app: pkg.version, electron: process.versions.electron, origin: APP_ORIGIN };
  } catch {
    return { app: '0.1.0', electron: process.versions.electron, origin: APP_ORIGIN };
  }
});
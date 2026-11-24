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
const { spawn } = require('node:child_process');
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
 *
 * 特例：`/__tts__/<文件名>` 映射到本次会话的 TTS 临时目录。
 *
 * ── 为什么音频要走 app:// 而不是 file:// ────────────────────────────────
 * 页面 origin 是 `app://englishmate`，window 开了 `webSecurity: true`。
 * 这种情况下 `<audio src="file://...">` 属于跨源加载本地文件，会被拦掉，
 * 表现为「点了没声音且没有任何报错」——极难排查。
 * 所以让同一个协议顺便服务 TTS 音频：同源、无需放宽 webSecurity。
 */
function resolveAssetPath(requestUrl) {
  const { pathname } = new URL(requestUrl);
  let rel = decodeURIComponent(pathname);

  // TTS 音频：只允许访问本次会话的临时目录，且只允许 .wav
  if (rel.startsWith('/__tts__/')) {
    if (!ttsTmpDir) return null;
    const name = rel.slice('/__tts__/'.length);
    if (!name || name.includes('/') || name.includes('..')) return null;
    if (!name.endsWith('.wav')) return null;
    const target = path.join(ttsTmpDir, name);
    if (!target.startsWith(ttsTmpDir)) return null;
    return target;
  }

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

/* ══════════════════════════════════════════════════════════════════════════
 * 语音合成（Windows SAPI）
 *
 * ── 为什么必须绕这一层 ────────────────────────────────────────────────────
 * Chromium 的 Web Speech API 只读注册表 `HKLM\...\Speech_OneCore\Voices`，
 * 而实测本机那里**一个英文语音都没有**（只有 3 个中文：Huihui/Kangkang/Yaoyao）。
 * 系统的 en-US 语音（Zira）只注册在 SAPI5 下，Chromium 看不到。
 *
 * 后果是渲染进程 `pickVoice('en-US')` 返回 undefined，
 * speechSynthesis 拿中文引擎去念英文——听起来就是"口齿不清"，
 * 长难句尤其明显。这不是参数能调好的，是引擎根本不匹配。
 *
 * 主进程能直接调 System.Speech（SAPI5），那里有 Zira。
 * 所以：渲染进程发现没有英文语音时，改走 IPC 让主进程合成，取回音频自己播。
 *
 * ── 为什么常驻一个 PowerShell ────────────────────────────────────────────
 * 实测每调用一次 powershell.exe 有 ~310ms 固定开销（与文本长度几乎无关），
 * 而真正的合成、哪怕 10 秒音频也只多 30ms。开销全在进程启动。
 * 于是常驻一个 PowerShell，用 stdin 喂命令、stdout 回收结果。
 *
 * ── 为什么用临时文件而不是回传二进制 ────────────────────────────────────
 * 走主进程 → 渲染进程传几 MB 的 Buffer 要经过 IPC 序列化，
 * 还要在渲染侧再转 Blob，链路长且容易出编码问题。
 * 写临时 wav、把路径交给渲染进程用 `file://`/fetch 读，简单且可缓存。
 */

/**
 * 常驻合成器的 PowerShell 脚本。
 *
 * ⚠️ **必须写进 .ps1 文件用 `-File` 执行，不能用 `-Command -` 喂 stdin。**
 * 踩过这个坑：`-Command -` 是**逐行解析执行**的，多行 while 循环会被拆成
 * 互不相干的语句，`{` 之后直接卡死（表现为握手永远等不到 READY）。
 * `-File` 是整份脚本一起解析，循环才正常工作。
 *
 * 协议：stdin 每行一条任务，格式 `<wav路径>\t<文本>`；
 * stdout 回 `READY`（就绪）/ `OK <路径>` / `ERR <消息>`。
 * 用制表符分隔而不是 '|'：文本里可能出现 '|'，制表符几乎不会。
 *
 * ⚠️ 这条脚本整体在 JS 模板字符串里，**注释和正文都不许出现反引号**。
 * 踩过两次：
 *  1. 写 `-split "\`t"` 表示制表符 → 反引号先被 JS 当成字符串定界符，
 *     脚本被截断，Electron 报 `Unexpected identifier 't'` 直接起不来。
 *  2. 把这条教训写成注释放回脚本内部 → 注释里又有反引号，同样截断。
 * 所以：制表符一律用 `[char]9`（纯 ASCII，不经过任何转义层），
 * 说明文字一律写在这个模板字符串**外面**。
 */
const TTS_PS_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $synth.SelectVoice($env:EM_TTS_VOICE) } catch { }

[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq '__QUIT__') { break }
  $parts = $line.Split([char]9, 2)
  if ($parts.Length -lt 2) { continue }
  $outPath = $parts[0]
  $text = $parts[1]
  $doneFile = $outPath + '.done'
  try {
    $synth.SetOutputToWaveFile($outPath)
    $synth.Speak($text)
    $synth.SetOutputToNull()
    Set-Content -Path $doneFile -Value 'OK' -NoNewline
  } catch {
    Set-Content -Path $doneFile -Value ('ERR ' + $_.Exception.Message) -NoNewline
  }
}
$synth.Dispose()

`;

/** 诊断日志：Electron 主进程的 stderr 在打包运行时常常看不到，写文件最稳 */
function ttsLog(...args) {
  if (!process.env.EM_TTS_DEBUG) return;
  try {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    fs.appendFileSync(path.join(app.getPath('temp'), 'englishmate-tts.log'), line);
  } catch {
    /* 日志失败不能影响功能 */
  }
}

/** 合成器状态：单例，懒启动，退出时清理 */
let ttsProc = null;
let ttsReady = null;
/** 等待中的任务：按行顺序回收结果 */
let ttsQueue = [];
/** 当前这一行的输出缓冲 */
let ttsBuf = '';
/** 临时目录（每次启动一个，退出时整体删） */
let ttsTmpDir = null;
/** 序号，用来生成不重复的文件名 */
let ttsSeq = 0;

/** 找一个可用的英文 SAPI5 语音名；找不到返回 null */
function pickSapiEnglishVoice() {
  try {
    const { execFileSync } = require('node:child_process');
    const ps =
      "Add-Type -AssemblyName System.Speech; " +
      '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ' +
      'ForEach-Object { $_.VoiceInfo.Culture.Name + "|" + $_.VoiceInfo.Name }';
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 15000,
      encoding: 'utf8',
    });
    const lines = out.split(/\r?\n/).filter(Boolean);
    const english = lines
      .map((l) => l.split('|'))
      .filter((p) => p.length === 2 && /^en(-|_)/i.test(p[0].trim()));
    if (english.length === 0) return null;
    /**
     * 优先选 Zira（本机实测质量最好），其次任意 en-US，最后任意英文。
     * 顺序写死会让换了机器的用户选不到好声音，所以按优先级逐级回退。
     */
    const zira = english.find((p) => /zira/i.test(p[1]));
    const us = english.find((p) => /^en[-_]us$/i.test(p[0].trim()));
    return (zira || us || english[0])[1].trim();
  } catch {
    return null;
  }
}

/** 启动常驻合成器；返回就绪 Promise（失败则返回 null 表示不可用） */
function ensureTts() {
  if (ttsReady) return ttsReady;
  const voice = pickSapiEnglishVoice();
  if (!voice) {
    ttsReady = Promise.resolve(null);
    return ttsReady;
  }

  ttsTmpDir = path.join(app.getPath('temp'), `englishmate-tts-${process.pid}`);
  let scriptPath;
  try {
    fs.mkdirSync(ttsTmpDir, { recursive: true });
    scriptPath = path.join(ttsTmpDir, 'synth.ps1');
    fs.writeFileSync(scriptPath, TTS_PS_SCRIPT, 'utf8');
  } catch {
    ttsReady = Promise.resolve(null);
    return ttsReady;
  }

  ttsReady = new Promise((resolve) => {
    let settled = false;
    try {
      ttsProc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
        {
          env: { ...process.env, EM_TTS_VOICE: voice },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      if (process.env.EM_TTS_DEBUG) {
        ttsLog('[tts] spawned pid', ttsProc.pid, 'voice', voice, 'script', scriptPath);
      }
    } catch (e) {
      if (process.env.EM_TTS_DEBUG) ttsLog('[tts] spawn 失败', e.message);
      resolve(null);
      return;
    }

    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    ttsProc.stdout.setEncoding('utf8');
    ttsProc.stdout.on('data', (chunk) => {
      if (process.env.EM_TTS_DEBUG) {
        ttsLog('[tts] stdout chunk', JSON.stringify(String(chunk).slice(0, 200)));
      }
      ttsBuf += chunk;
      let nl;
      while ((nl = ttsBuf.indexOf('\n')) >= 0) {
        const line = ttsBuf.slice(0, nl).replace(/\r$/, '');
        ttsBuf = ttsBuf.slice(nl + 1);
        if (line === 'READY') {
          finish({ voice });
          continue;
        }
        const pending = ttsQueue.shift();
        if (!pending) continue;
        /**
         * 诊断日志：合成失败时唯一能看到的现场。
         * 写到 stderr，用 `npm run electron:run` 或 DevTools 能看到；
         * 不开窗口也有输出，因为 Electron 主进程的 stderr 直接进终端。
         */
        if (line.startsWith('OK ')) {
          pending.resolve(line.slice(3));
        } else {
          if (process.env.EM_TTS_DEBUG) {
        ttsLog('[tts] 非 OK 回复:', JSON.stringify(line));
          }
          pending.resolve(null);
        }
      }
    });

    ttsProc.stderr.on('data', () => {
      /* PowerShell 的警告不该影响合成，忽略 */
    });

    ttsProc.on('exit', () => {
      ttsProc = null;
      ttsReady = null;
      // 未完成的任务全部按失败处理，避免调用方永远等下去
      for (const p of ttsQueue) p.resolve(null);
      ttsQueue = [];
      finish(null);
    });

    ttsProc.stdin.write(TTS_PS_SCRIPT);
    ttsProc.stdin.write('\n');

    // 兜底：8 秒还没 READY 就当不可用（PowerShell 起不来时别把界面卡死）
    setTimeout(() => finish(null), 8000);
  });

  return ttsReady;
}

/** 合成一段文本，返回 wav 文件路径；失败返回 null */
async function ttsSynthesize(text, voiceHint) {
  const ready = await ensureTts();
  if (!ready || !ttsProc) return null;
  if (typeof text !== "string" || !text.trim()) return null;

  ttsSeq += 1;
  const file = path.join(ttsTmpDir, `t${ttsSeq}.wav`);
  const doneFile = file + ".done";
  const safe = text.replace(/[\t\r\n]+/g, ' ').trim();
  const line = `${file.replace(/\\/g, '/')}\t${safe}`;

  try {
    ttsProc.stdin.write(line + '\r\n');
  } catch {
    return null;
  }

  /**
   * 轮询 .done 标记文件，而不是靠 stdout 回收。
   *
   * 踩过的坑：最初靠 stdout 行匹配回收结果，在 Electron 里会读到大量
   * "ERR bad-line" 把队列错位（PowerShell 把某些输入当成坏行），
   * 结果合成其实成功了、wav 也写了，但主进程判定失败。
   * 标记文件没有顺序问题：一个任务一个文件，存在即完成。
   */
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (fs.existsSync(doneFile)) {
      let verdict = "OK";
      try {
        verdict = fs.readFileSync(doneFile, "utf8");
      } catch {
        /* 读失败按成功处理，真正的判据是 wav 存在 */
      }
      try {
        fs.unlinkSync(doneFile);
      } catch {
        /* 清不掉不影响本次 */
      }
      if (verdict.startsWith("OK") && fs.existsSync(file)) return file;
      return null;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  return null;
}

ipcMain.handle('englishmate:tts-synthesize', async (_e, text) => {
  // 把失败原因带回渲染进程：打包运行时主进程 stderr 看不到，
  // 只回 { ok:false } 无法区分「没起进程」「进程挂了」「写文件失败」。
  const ready = await ensureTts();
  if (!ready) return { ok: false, reason: 'no-voice-or-spawn-failed' };
  if (!ttsProc) return { ok: false, reason: 'proc-not-running' };
  const file = await ttsSynthesize(text);
  if (!file) return { ok: false, reason: 'synth-returned-null' };
  if (!file) return { ok: false };
  /**
   * 返回 **app:// URL 而不是文件路径**。
   *
   * 渲染进程在 `app://englishmate` 页面里，`file://` 属于跨源，
   * webSecurity 会拦掉且不报错（"点了没声音"）。同源 URL 才能播。
   * 附带的好处：渲染进程拿不到任意磁盘路径，安全边界不扩大。
   */
  return { ok: true, url: `${APP_ORIGIN}/__tts__/${path.basename(file)}` };
});

/** 查一下本机有没有可用的英文语音（渲染进程用来决定走哪条路） */

ipcMain.handle('englishmate:tts-voices', async () => {
  const ready = await ensureTts();
  return ready ? { ok: true, voice: ready.voice } : { ok: false, voice: null };
});

app.on('will-quit', () => {
  try {
    if (ttsProc) {
      ttsProc.stdin.write('__QUIT__\n');
      ttsProc.kill();
    }
  } catch {
    /* 退出阶段不折腾 */
  }
  try {
    if (ttsTmpDir && fs.existsSync(ttsTmpDir)) fs.rmSync(ttsTmpDir, { recursive: true, force: true });
  } catch {
    /* 临时目录清不掉不影响下次启动 */
  }
});
/**
 * Service Worker —— 让 TypeFlow 真正离线可用。
 *
 * 策略：
 *   - 应用外壳（HTML/JS/CSS）：stale-while-revalidate，秒开且后台更新
 *   - 词库 JSON：cache-first，词库是内容固定的静态资源，不需要更新
 *   - 其它同源 GET：network-first，失败回退缓存
 *
 * 注意：这是手写 SW，没有引 workbox。逻辑简单到不值得多 30KB 依赖。
 */
const VERSION = 'v1';
const SHELL_CACHE = `typeflow-shell-${VERSION}`;
const DICT_CACHE = `typeflow-dicts-${VERSION}`;
const RUNTIME_CACHE = `typeflow-runtime-${VERSION}`;

/** 构建产物名带 hash，无法预列，因此安装时只预缓存入口 */
const PRECACHE = ['/', '/index.html', '/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('typeflow-') && !k.endsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 词库：cache-first（内容不变，重复下载纯浪费）
  if (url.pathname.startsWith('/dicts/')) {
    event.respondWith(
      caches.open(DICT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        }
      }),
    );
    return;
  }

  // 导航请求：network-first，离线时回退到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/index.html', res.clone());
          return res;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('/index.html')) ?? (await cache.match('/')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit ?? network;
    }),
  );
});

/** 让页面能主动触发更新 */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

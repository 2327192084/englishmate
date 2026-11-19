/**
 * 注册 Service Worker。
 *
 * 只在生产环境注册：开发时 SW 会把 Vite 的 HMR 请求也缓存住，导致改了代码不生效，
 * 这是新手最容易被坑的地方。
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  // 桌面客户端（file://）里没有 SW 的作用域，注册会静默失败，直接跳过
  if ((window as unknown as { typeflow?: { isDesktop?: boolean } }).typeflow?.isDesktop) return;
  if (!window.location.protocol.startsWith('http')) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不影响主功能，静默 */
    });
  });
}

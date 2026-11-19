import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Electron 打包后页面是用 file:// 打开的，绝对路径 /assets/x.js 会被解析成
 * 盘符根目录而 404。所以桌面构建需要相对 base。
 * 用环境变量区分：npm run build:desktop 走 './'，Web 构建继续用 '/'。
 */
const isDesktopBuild = process.env.TYPEFLOW_DESKTOP === '1';

export default defineConfig({
  base: isDesktopBuild ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // 桌面版不需要 sourcemap，减小体积
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 渲染测试需要 DOM，用文件级注释切换，默认 node 保持纯逻辑测试最快
    setupFiles: ['./src/test-setup.ts'],
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    /**
     * 渲染测试串行跑。
     * App.test.tsx 与 PracticeFlow.test.tsx 都要挂载整个 App，
     * 并行时会共用同一个 fake-indexeddb 与全局 store，
     * 互相清库导致偶发失败（表现为点开始没反应）。
     */
    fileParallelism: false,
    /**
     * 单测超时上调到 15s。
     * 渲染类测试要挂载整个 App、等 IndexedDB 初始化、模拟完整一轮练习，
     * 全量跑时（前面已跑过 9 个文件）会超过默认 5s。
     * 这是负载导致的超时，不是逻辑挂死——单独跑同样用例只要 0.7s。
     */
    testTimeout: 15000,
  },
});

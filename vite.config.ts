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
  },
});

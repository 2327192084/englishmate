import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 渲染测试需要 DOM，用文件级注释切换，默认 node 保持纯逻辑测试最快
    setupFiles: ['./src/test-setup.ts'],
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
  },
});

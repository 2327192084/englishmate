/** 桌面构建：设置 ENGLISHMATE_DESKTOP=1 让 vite 用相对 base，然后打包 */
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, ENGLISHMATE_DESKTOP: '1' },
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);

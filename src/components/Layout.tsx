/** 应用外壳：左侧导航（宽屏）/ 底部标签栏（窄屏） */
import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  IconBook,
  IconChart,
  IconFlame,
  IconKeyboard,
  IconSettings,
  IconTrophy,
  IconMoon,
  IconSun,
} from './Icons';
import { useSettings } from '@/store/settings';

const NAV = [
  { to: '/', label: '练习', icon: IconKeyboard, exact: true },
  { to: '/words', label: '词库', icon: IconBook },
  { to: '/review', label: '复习', icon: IconFlame },
  { to: '/articles', label: '文章', icon: IconBook },
  { to: '/stats', label: '数据', icon: IconChart },
  { to: '/achievements', label: '成就', icon: IconTrophy },
];

export function Layout({ children }: { children: ReactNode }) {
  const { settings, update } = useSettings();
  const loc = useLocation();
  const isPractice = loc.pathname.startsWith('/practice');

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* 侧边栏 */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="px-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
              <IconKeyboard width={17} height={17} />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight text-ink">TypeFlow</div>
              <div className="text-[10px] leading-tight text-muted">打字即学习</div>
            </div>
          </div>
        </div>

        <nav className="mt-6 flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-surface2 font-medium text-ink'
                      : 'text-muted hover:bg-surface2/60 hover:text-ink'
                  }`
                }
              >
                <Icon width={16} height={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => void update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted transition-colors hover:bg-surface2/60 hover:text-ink"
          >
            {settings.theme === 'dark' ? (
              <IconSun width={16} height={16} />
            ) : (
              <IconMoon width={16} height={16} />
            )}
            {settings.theme === 'dark' ? '浅色' : '深色'}
          </button>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-surface2 font-medium text-ink'
                  : 'text-muted hover:bg-surface2/60 hover:text-ink'
              }`
            }
          >
            <IconSettings width={16} height={16} />
            设置
          </NavLink>
        </div>
      </aside>

      {/* 移动端顶栏 */}
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white">
            <IconKeyboard width={15} height={15} />
          </div>
          <span className="text-sm font-semibold text-ink">TypeFlow</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void update({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
            className="rounded-md p-2 text-muted"
            aria-label="切换主题"
          >
            {settings.theme === 'dark' ? (
              <IconSun width={16} height={16} />
            ) : (
              <IconMoon width={16} height={16} />
            )}
          </button>
          <NavLink to="/settings" className="rounded-md p-2 text-muted" aria-label="设置">
            <IconSettings width={16} height={16} />
          </NavLink>
        </div>
      </header>

      <main className={`min-w-0 flex-1 ${isPractice ? '' : 'pb-20 md:pb-0'}`}>{children}</main>

      {/* 移动端底部导航 */}
      {!isPractice && (
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface md:hidden">
          {NAV.slice(0, 5).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                    isActive ? 'text-accent' : 'text-muted'
                  }`
                }
              >
                <Icon width={18} height={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}

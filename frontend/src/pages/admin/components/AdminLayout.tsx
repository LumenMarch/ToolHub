import React, { useContext, useEffect, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChartBar,
  ClockCountdown,
  ListChecks,
  ShieldCheck,
  Users,
} from '@phosphor-icons/react';
import { AuthContext } from '../../../context/AuthContext';
import { ThemeToggle } from '../../../components/ThemeToggle';
import { cn } from '../../../lib/cn';

interface NavItem {
  to: string;
  label: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { to: '/admin', label: '概览', title: '概览', icon: ChartBar, permission: 'stats:read' },
  { to: '/admin/users', label: '用户', title: '用户', icon: Users, permission: 'user:read' },
  { to: '/admin/audit', label: '审计日志', title: '审计日志', icon: ClockCountdown, permission: 'audit:read' },
  { to: '/admin/tools', label: '工具', title: '工具', icon: ListChecks, permission: 'tool_meta:read' },
  { to: '/admin/roles', label: '角色管理', title: '角色管理', icon: ShieldCheck, permission: 'role:read' },
];

const AdminLayout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);

  // 按当前用户权限过滤可见导航项
  const NAV_ITEMS = useMemo(
    () =>
      ALL_NAV_ITEMS.filter((item) => user?.permissions.includes(item.permission)),
    [user],
  );

  const isActive = (to: string) =>
    to === '/admin'
      ? location.pathname === '/admin'
      : location.pathname.startsWith(to);

  const currentItem =
    NAV_ITEMS.find((item) => isActive(item.to)) ?? NAV_ITEMS[0];

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  // 动态浏览器标题 — "{页面名} · 控制台"
  useEffect(() => {
    if (currentItem) {
      document.title = `${currentItem.title} · 控制台`;
    }
    return () => {
      document.title = '工具枢纽';
    };
  }, [currentItem]);

  return (
    <div className="h-dvh bg-background flex overflow-hidden">
      <div className="grain-overlay" />

      {/* 侧边栏 */}
      <aside className="hidden md:flex w-60 flex-col border-r border-border relative z-10 shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-border">
          <Link
            to="/admin"
            className="inline-block whitespace-nowrap text-xl font-bold uppercase tracking-tighter md:text-2xl"
          >
            控制<span className="text-primary">台</span>.
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-[color,background-color] duration-200',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* 右侧主区 */}
      <div className="flex-1 flex flex-col relative z-10 min-w-0 overflow-hidden">
        <header className="sticky top-0 z-20 bg-background border-b border-border">
          <div className="flex items-center justify-between gap-4 px-4 md:px-8 h-16">
            <div className="flex items-center gap-4 md:gap-5 min-w-0">
              <Link
                to="/admin"
                className="md:hidden text-base font-bold uppercase tracking-tighter whitespace-nowrap"
              >
                控制<span className="text-primary">台</span>.
              </Link>
              <h1 className="min-w-0 text-base font-bold leading-tight tracking-tight md:text-xl truncate">
                {currentItem?.title ?? '控制台'}
              </h1>
            </div>

            <div className="flex items-center gap-3 md:gap-6 shrink-0">
              <ThemeToggle variant="ghost" />
              <span className="hidden text-[0.8125rem] font-mono tracking-widest uppercase opacity-50 lg:block">
                [ 管理员: {user?.username} ]
              </span>
              <Link
                to="/"
                className="group relative inline-flex h-9 items-center overflow-hidden whitespace-nowrap px-1 text-[0.8125rem] font-mono uppercase tracking-widest transition-colors hover:text-primary active:translate-y-px"
              >
                <span className="relative z-10">返回主站</span>
                <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out" />
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="group relative inline-flex h-9 items-center overflow-hidden whitespace-nowrap px-1 text-[0.8125rem] font-mono uppercase tracking-widest transition-colors hover:text-primary active:translate-y-px"
              >
                <span className="relative z-10">断开连接</span>
                <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out" />
              </button>
            </div>
          </div>

          {/* 移动端导航条 */}
          <nav className="md:hidden flex overflow-x-auto border-t border-border">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;

import React, { useContext, useEffect, useRef } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { toolsConfig } from '../config/tools';
import { ThemeToggle } from './ThemeToggle';
import { gsap } from 'gsap';
import { cn } from '../lib/cn';
import { useVisibleTools } from '../hooks/useToolsMeta';
import { LoadingSignal } from './LoadingSignal';

const Layout: React.FC = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  const { visibleTools } = useVisibleTools();

  const activeTool = visibleTools.find(
    (tool) =>
      location.pathname === tool.path ||
      location.pathname.startsWith(`${tool.path}/`),
  );
  const isToolRoute = toolsConfig.some(
    (tool) =>
      location.pathname === tool.path ||
      location.pathname.startsWith(`${tool.path}/`),
  );

  // 动态浏览器标题 — 首页 "工具枢纽"，工具页 "{工具名} · 工具枢纽"
  useEffect(() => {
    if (activeTool) {
      document.title = `${activeTool.name} · 工具枢纽`;
    } else {
      document.title = '工具枢纽';
    }
    return () => {
      document.title = '工具枢纽';
    };
  }, [activeTool]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  // 导航只在用户允许动态效果时执行入场动画。
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    gsap.fromTo(navRef.current,
      { y: -20, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, ease: 'expo.out', delay: 0.2 }
    );
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col bg-background">
      <div className="grain-overlay" />

      {/* 工具页使用上下文页头，主控台保留浮动页头。 */}
      <header
        ref={navRef}
        className={cn(
          'left-0 top-0 z-50 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 pointer-events-none',
          isToolRoute
            ? 'sticky items-start border-b border-border bg-background px-6 py-4 md:items-center md:px-10 md:py-5'
            : 'fixed items-center p-6 md:p-10',
        )}
      >
        <div
          className={cn(
            'min-w-0 pointer-events-auto',
            isToolRoute && 'flex flex-col gap-1 md:flex-row md:items-center md:gap-5',
          )}
        >
          <Link
            to="/"
            className="inline-block whitespace-nowrap text-xl font-bold uppercase tracking-tighter md:text-2xl"
          >
            工具<span className="text-primary">枢纽</span>.
          </Link>
          {isToolRoute && (
            <>
              <span
                aria-hidden="true"
                className="hidden h-6 w-px shrink-0 bg-border md:block"
              />
              {activeTool ? (
                <h1 className="min-w-0 text-base font-bold leading-tight tracking-tight md:text-2xl">
                  {activeTool.name}
                </h1>
              ) : (
                <LoadingSignal
                  ariaLabel="正在加载工具名称"
                  label="[ 工具同步中 ]"
                  compact
                  className="w-32"
                />
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 pointer-events-auto md:gap-8">
          <ThemeToggle />
          <span className="hidden text-[0.8125rem] font-mono tracking-widest uppercase opacity-50 lg:block">
            [ 标识: {user?.username} ]
          </span>
          {user && user.permissions.some((p) => p !== 'tool:use') && (
            <Link
              to="/admin"
              className="group relative inline-flex min-h-11 items-center overflow-hidden whitespace-nowrap px-1 text-[0.8125rem] font-mono uppercase tracking-widest transition-colors hover:text-primary active:translate-y-px"
            >
              <span className="relative z-10">控制台</span>
              <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
            </Link>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="group relative inline-flex min-h-11 items-center overflow-hidden whitespace-nowrap px-1 text-[0.8125rem] font-mono uppercase tracking-widest transition-colors hover:text-primary active:translate-y-px"
          >
            <span className="relative z-10">断开连接</span>
            <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
          </button>
        </div>
      </header>

      {/* 工具页紧随粘性页头，主控台沿用原有顶部留白。 */}
      <main
        className={cn(
          'relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 pb-20 md:px-24 lg:px-48',
          isToolRoute ? 'pt-8 md:pt-12' : 'pt-32 md:pt-48',
        )}
      >
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/auth-context';
import { toolsConfig } from '../config/tools';
import { ThemeToggle } from './ThemeToggle';
import { gsap } from 'gsap';
import { ArrowRight } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import api from '../api/axios';

interface ToolMetaOverride {
  tool_id: string;
  enabled: boolean;
  sort_order: number;
  custom_name: string | null;
  custom_description: string | null;
}

const Layout: React.FC = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  const [overrides, setOverrides] = useState<Map<string, ToolMetaOverride>>(new Map());

  // 拉取工具元数据覆盖层，用于索引过滤。
  useEffect(() => {
    let active = true;
    api
      .get<ToolMetaOverride[]>('/tools-meta')
      .then((response) => {
        if (!active) return;
        const map = new Map<string, ToolMetaOverride>();
        for (const item of response.data) {
          map.set(item.tool_id, item);
        }
        setOverrides(map);
      })
      .catch(() => {
        // 拉取失败时使用默认配置。
      });
    return () => {
      active = false;
    };
  }, []);

  // 合并配置与覆盖项，只保留已启用的工具。
  const visibleTools = useMemo(() => {
    return toolsConfig
      .map((tool, index) => {
        const override = overrides.get(tool.id);
        return {
          ...tool,
          name: override?.custom_name?.trim() || tool.name,
          sort_order: override?.sort_order ?? index,
          enabled: override?.enabled ?? true,
        };
      })
      .filter((t) => t.enabled)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [overrides]);

  const activeTool = visibleTools.find(
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
          activeTool
            ? 'sticky items-start border-b border-border bg-background px-6 py-4 md:items-center md:px-10 md:py-5'
            : 'fixed items-center p-6 md:p-10',
        )}
      >
        <div
          className={cn(
            'min-w-0 pointer-events-auto',
            activeTool && 'flex flex-col gap-1 md:flex-row md:items-center md:gap-5',
          )}
        >
          <Link
            to="/"
            className="inline-block whitespace-nowrap text-xl font-bold uppercase tracking-tighter md:text-2xl"
          >
            工具<span className="text-primary">枢纽</span>.
          </Link>
          {activeTool && (
            <>
              <span
                aria-hidden="true"
                className="hidden h-6 w-px shrink-0 bg-border md:block"
              />
              <h1 className="min-w-0 text-base font-bold leading-tight tracking-tight md:text-2xl">
                {activeTool.name}
              </h1>
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
          activeTool ? 'pt-8 md:pt-12' : 'pt-32 md:pt-48',
        )}
      >
        <Outlet />
      </main>

      {/* 左下角浮动工具索引 — 只显示已启用的工具 */}
      <div className="hidden lg:flex fixed bottom-12 left-12 flex-col gap-2 z-40  w-48">
        <p className="mb-2 text-[0.625rem] font-mono uppercase tracking-[0.2em] opacity-40">索引</p>
        {visibleTools.map((tool) => {
          const isActive = activeTool?.id === tool.id;

          return (
            <Link
              key={tool.id}
              to={tool.path}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 text-xs font-medium uppercase tracking-wider transition-[color,transform] duration-500 ease-out',
                isActive
                  ? 'translate-x-2 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {isActive && <ArrowRight className="size-3" />}
              {tool.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default Layout;

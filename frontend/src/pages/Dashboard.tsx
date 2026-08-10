import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ArrowUpRight } from '@phosphor-icons/react';
import { useVisibleTools } from '../hooks/useToolsMeta';
import { LoadingSignal } from '../components/LoadingSignal';
import type { ToolDefinition } from '../config/tools';

/** 固定显示组：始终可见、不参与折叠（资产核对 / 出勤资料整理 / AtlasLog Merge）。 */
const PINNED_TOOL_IDS = new Set(['asset-comparison', 'attendance-organizer', 'atlas-merge']);
const OTHERS_STORAGE_KEY = 'toolhub-console-other-collapsed';

const ToolCard: React.FC<{ tool: ToolDefinition }> = ({ tool }) => {
  return (
    <Link
      to={tool.path}
      className="tool-cell group relative flex min-h-[200px] flex-col justify-between overflow-hidden border-r border-b border-border p-6 md:min-h-[224px]"
    >
      {/* 悬停时显示满版强调色。 */}
      <div className="absolute inset-0 z-0 bg-primary translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-[cubic-bezier(0.85,0,0.15,1)]"></div>

      {/* 右上：箭头 */}
      <div className="relative z-10 flex items-start justify-end">
        <ArrowUpRight
          weight="bold"
          className="w-5 h-5 group-hover:text-primary-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition duration-300"
        />
      </div>

      {/* 左下：serif 名称 + mono 描述 */}
      <div className="relative z-10 min-w-0">
        <h3 className="font-heading font-bold text-xl md:text-2xl tracking-tight truncate group-hover:text-primary-foreground transition-colors duration-300">
          {tool.name}
        </h3>
        <p className="mt-2.5 text-xs font-mono text-muted-foreground truncate group-hover:text-primary-foreground transition-colors duration-300">
          {tool.description}
        </p>
      </div>
    </Link>
  );
};

const Dashboard: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimatedRef = useRef(false);
  const { visibleTools, isPending, hasAccess } = useVisibleTools();

  // 「其它工具」默认折叠，偏好持久化到 localStorage。
  const [otherCollapsed, setOtherCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(OTHERS_STORAGE_KEY) !== 'false';
  });

  useEffect(() => {
    if (
      isPending ||
      hasAnimatedRef.current ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    hasAnimatedRef.current = true;
    const ctx = gsap.context(() => {
      gsap.from('.tool-cell', {
        x: -40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'expo.out',
        delay: 0.2
      });
    }, containerRef);
    return () => ctx.revert();
  }, [isPending]);

  const pinnedTools = visibleTools.filter((tool) => PINNED_TOOL_IDS.has(tool.id));
  const otherTools = visibleTools.filter((tool) => !PINNED_TOOL_IDS.has(tool.id));

  const toggleOthers = () => {
    const next = !otherCollapsed;
    setOtherCollapsed(next);
    localStorage.setItem(OTHERS_STORAGE_KEY, String(next));
  };

  return (
    <div
      ref={containerRef}
      className="flex w-full min-w-0 min-h-[60vh] flex-col justify-center pb-20 min-[80rem]:-mx-44 min-[80rem]:w-auto"
    >
      {isPending ? (
        <div className="flex min-h-72 items-center border-b border-border px-4 md:px-8">
          <LoadingSignal
            ariaLabel="正在加载工具列表"
            meta="Tools / Access Metadata"
            label="[ 工具入口 · 同步中 ]"
            detail="等待权限索引"
          />
        </div>
      ) : visibleTools.length === 0 ? (
        <div className="flex min-h-72 flex-col items-start justify-center gap-3 border-b border-border px-4 md:px-8">
          <p className="text-[11px] font-mono uppercase tracking-widest text-primary">
            [ 工具不可用 ]
          </p>
          <h3 className="text-2xl font-bold tracking-tight md:text-3xl">
            当前账号没有可用的工具
          </h3>
          <p className="max-w-lg text-sm text-muted-foreground">
            {hasAccess
              ? '管理员尚未启用任何工具，请稍后再试或联系管理员。'
              : '请联系管理员为你的账号分配「工具使用者」等角色后重新登录。'}
          </p>
        </div>
      ) : (
        <>
          {/* 固定显示组：资产核对 / 出勤资料整理 / AtlasLog Merge，不参与折叠 */}
          {pinnedTools.length > 0 && (
            <section className="mt-8" aria-label="常用工具">
              <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
                [ 常用 / PINNED ]
              </p>
              <div className="mt-8 grid grid-cols-1 border-t border-l border-border sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {pinnedTools.map((tool) => (
                  <ToolCard key={tool.id} tool={tool} />
                ))}
              </div>
            </section>
          )}

          {/* 其它工具：默认折叠，展开/收起偏好持久化 */}
          {otherTools.length > 0 && (
            <section className="mt-24" aria-label="其它工具">
              <div className="flex items-end justify-between gap-6">
                <div className="flex min-w-0 items-baseline gap-4">
                  <h2 className="font-heading font-bold text-2xl md:text-3xl tracking-tight">
                    其它工具
                  </h2>
                  <span className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                    [ {otherTools.length} 个工具 / {otherTools.length} TOOLS ]
                  </span>
                </div>
                <button
                  type="button"
                  onClick={toggleOthers}
                  aria-expanded={!otherCollapsed}
                  aria-controls="other-tools-grid"
                  className="group relative inline-flex min-h-11 items-center overflow-hidden whitespace-nowrap px-1 text-[0.8125rem] font-mono uppercase tracking-widest transition-colors hover:text-primary active:translate-y-px"
                >
                  <span className="relative z-10">{otherCollapsed ? '展开' : '收起'}</span>
                  <div className="absolute bottom-0 left-0 w-full h-[1px] bg-primary -translate-x-[101%] group-hover:translate-x-0 transition-transform duration-500 ease-out"></div>
                </button>
              </div>

              {!otherCollapsed && (
                <div className="mt-8">
                  <div
                    id="other-tools-grid"
                    className="grid grid-cols-1 border-t border-l border-border sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
                  >
                    {otherTools.map((tool) => (
                      <ToolCard key={tool.id} tool={tool} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;

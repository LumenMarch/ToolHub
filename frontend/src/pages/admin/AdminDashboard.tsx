import React, { useEffect, useState } from 'react';
import { gsap } from 'gsap';
import StatCard from '../../components/admin/StatCard';
import BarChart from '../../components/admin/BarChart';
import TrendChart from '../../components/admin/TrendChart';
import AdminLoadingState from '../../components/admin/AdminLoadingState';
import PermissionGuard from '../../components/PermissionGuard';
import { usePermission } from '../../hooks/usePermission';
import { useAdminApi } from '../../hooks/useAdminApi';
import type {
  DailyActiveStat,
  OverviewStats,
  ToolCallStat,
} from '../../hooks/useAdminApi';

const AdminDashboard: React.FC = () => {
  const api = useAdminApi();
  const { has } = usePermission();
  const canViewStats = has('stats:read');

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallStat[]>([]);
  const [dailyActive, setDailyActive] = useState<DailyActiveStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 无 stats:read 权限时不请求任何统计接口
    if (!canViewStats) return;

    let active = true;
    setLoading(true);
    setError('');
    Promise.all([api.getOverview(), api.getToolCalls(), api.getDailyActiveUsers(7)])
      .then(([o, t, d]) => {
        if (!active) return;
        setOverview(o);
        setToolCalls(t);
        setDailyActive(d);
      })
      .catch(() => {
        if (!active) return;
        setError('统计数据加载失败');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewStats]);

  useEffect(() => {
    if (
      loading ||
      error ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const ctx = gsap.context(() => {
      gsap.from('.admin-stat-card', {
        y: 20,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: 'expo.out',
      });
      gsap.from('.admin-chart-block', {
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out',
        delay: 0.3,
      });
    }, containerRef);
    return () => ctx.revert();
  }, [error, loading]);

  const toolCallChartData = toolCalls.reduce<Array<{ label: string; value: number }>>(
    (items, toolCall) => {
      if (toolCall.action.startsWith('tool.')) {
        items.push({
          label: toolCall.action.replace('tool.', '').replace(/\./g, ' '),
          value: toolCall.count,
        });
      }
      return items;
    },
    [],
  );

  if (!canViewStats) {
    return (
      <div className="space-y-10">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          系统运行状态总览
        </p>
        <div className="text-sm font-mono text-muted-foreground p-8 border border-border text-center">
          [ 无统计数据查看权限 — 请使用侧边栏导航 ]
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-10">
      <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        系统运行状态总览
      </p>

      {error && (
        <div className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
          [ 异常: {error} ]
        </div>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台统计数据"
          label="[ 统计数据 · 同步中 ]"
          detail="等待安全聚合"
        />
      ) : !error && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 admin-stat-card">
            <PermissionGuard permission="user:read">
              <StatCard
                label="总用户数"
                value={overview?.total_users ?? '—'}
                hint="全部已注册账号"
              />
            </PermissionGuard>
            <PermissionGuard permission="user:read">
              <StatCard
                label="活跃用户"
                value={overview?.active_users_7d ?? '—'}
                hint="最近 7 天登录"
              />
            </PermissionGuard>
            <PermissionGuard permission="tool_meta:read">
              <StatCard
                label="工具配置"
                value={overview?.total_tools ?? '—'}
                hint="已自定义工具数"
              />
            </PermissionGuard>
            <PermissionGuard permission="audit:read">
              <StatCard
                label="今日操作"
                value={overview?.audit_logs_today ?? '—'}
                hint="审计日志条数"
              />
            </PermissionGuard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PermissionGuard permission="stats:read">
              <div className="admin-chart-block border border-border p-6">
                <h2 className="text-sm font-bold tracking-tight mb-1">工具调用次数</h2>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground opacity-60 mb-6">
                  TOOL CALLS
                </p>
                <BarChart data={toolCallChartData} emptyHint="暂无工具调用记录" />
              </div>
            </PermissionGuard>

            <PermissionGuard permission="stats:read">
              <div className="admin-chart-block border border-border p-6">
                <h2 className="text-sm font-bold tracking-tight mb-1">每日活跃用户</h2>
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground opacity-60 mb-6">
                  DAILY ACTIVE USERS · 最近 7 天
                </p>
                <TrendChart data={dailyActive} emptyHint="暂无活跃数据" />
              </div>
            </PermissionGuard>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;

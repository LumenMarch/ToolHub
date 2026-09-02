import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import StatCard from './components/StatCard';
import BarChart from './components/BarChart';
import TrendChart from './components/TrendChart';
import AdminLoadingState from './components/AdminLoadingState';
import PermissionGuard from '../../components/guards/PermissionGuard';
import { usePermission } from '../../hooks/use-permission';
import { useAdminApi } from './hooks/use-admin-api';
import type {
  DailyActiveStat,
  OverviewStats,
  ToolCallStat,
} from './hooks/use-admin-api';

/** 日期范围选项：number 为最近 N 天，null 表示全部时间（仅工具调用支持）。 */
interface RangeOption<T extends number | null> {
  value: T;
  label: string;
}

/** 图表右上角的日期范围按钮组：选中 default，未选中 outline。 */
function ChartRangeSelector<T extends number | null>({
  options,
  value,
  onChange,
}: {
  options: Array<RangeOption<T>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Button
            key={String(opt.value)}
            type="button"
            size="sm"
            variant={selected ? 'default' : 'outline'}
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

/** 工具 action slug → 中文名。
 *  slug 从后端 action 派生：去掉 "tool." 前缀后，去掉最后一个 ".操作段"
 *  （如 tool.attendance.process → attendance）。
 *  名称来源：frontend/src/config/tools.ts 的 id/name；slug 与 tools.ts id
 *  存在连字符/下划线差异时在此显式映射（attendance → attendance-organizer）。
 *  tool.meta.* 为管理员在后台配置工具的审计动作（backend/app/api/endpoints/admin_tools.py），
 *  非用户工具调用，单独归类为"工具配置管理"避免混入工具调用。
 *  不在映射表中的 slug 回退显示 slug 本身，不报错。 */
const TOOL_SLUG_NAMES: Record<string, string> = {
  attendance: '出勤资料整理',
  atlas_merge: 'AtlasLog Merge',
  meta: '工具配置管理',
};

/** 图表数据条目：label 为归并后的工具中文名，actions 保留原始 action 列表用于 tooltip。 */
interface ToolCallChartItem {
  label: string;
  value: number;
  actions: string[];
}

const AdminDashboard: React.FC = () => {
  const api = useAdminApi();
  const { has } = usePermission();
  const canViewStats = has('stats:read');

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallStat[]>([]);
  const [dailyActive, setDailyActive] = useState<DailyActiveStat[]>([]);
  // 两个图表各自独立的日期范围（天），互不影响；null = 全部时间。
  const [activeDays, setActiveDays] = useState(7);
  const [toolDays, setToolDays] = useState<number | null>(7);
  const [loading, setLoading] = useState(true);
  const [toolLoading, setToolLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(true);
  const [error, setError] = useState('');

  // 概览卡片只加载一次，不随日期范围变化。
  useEffect(() => {
    // 无 stats:read 权限时不请求任何统计接口
    if (!canViewStats) return;

    let active = true;
    setLoading(true);
    setError('');
    api
      .getOverview()
      .then((o) => {
        if (!active) return;
        setOverview(o);
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

  // 工具调用统计：随 toolDays 变化重新拉取（null = 全部时间，不携带 days 参数）。
  useEffect(() => {
    if (!canViewStats) return;

    let active = true;
    setToolLoading(true);
    api
      .getToolCalls(toolDays ?? undefined)
      .then((t) => {
        if (!active) return;
        setToolCalls(t);
      })
      .catch(() => {
        if (!active) return;
        setError('统计数据加载失败');
      })
      .finally(() => {
        if (!active) return;
        setToolLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewStats, toolDays]);

  // 每日活跃用户：随 activeDays 变化重新拉取。
  useEffect(() => {
    if (!canViewStats) return;

    let active = true;
    setActiveLoading(true);
    api
      .getDailyActiveUsers(activeDays)
      .then((d) => {
        if (!active) return;
        setDailyActive(d);
      })
      .catch(() => {
        if (!active) return;
        setError('统计数据加载失败');
      })
      .finally(() => {
        if (!active) return;
        setActiveLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewStats, activeDays]);

  // 工具调用统计：同一工具不同操作（如 analyze/download）按 slug 归并为一个条目，
  // count 相加，label 显示中文工具名；最终按 count 降序（与后端返回排序一致）。
  const toolCallChartData = toolCalls
    .reduce<ToolCallChartItem[]>((items, toolCall) => {
      if (!toolCall.action.startsWith('tool.')) return items;
      const parts = toolCall.action.slice('tool.'.length).split('.');
      // slug = 去掉最后一个 ".操作段"（如 tool.attendance.process → attendance）。
      const slug = parts.length > 1 ? parts.slice(0, -1).join('.') : parts.join('.');
      const label = TOOL_SLUG_NAMES[slug] ?? slug;
      const existing = items.find((item) => item.label === label);
      if (existing) {
        existing.value += toolCall.count;
        existing.actions.push(toolCall.action);
      } else {
        items.push({ label, value: toolCall.count, actions: [toolCall.action] });
      }
      return items;
    }, [])
    .sort((a, b) => b.value - a.value);

  if (!canViewStats) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>无统计数据查看权限</EmptyTitle>
          <EmptyDescription>请使用侧边栏导航其他页面。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-muted-foreground">系统运行状态总览</p>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台统计数据"
          label="正在加载统计数据"
          detail="等待安全聚合"
        />
      ) : !error && (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
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

          <div className="flex flex-col gap-6">
            <PermissionGuard permission="stats:read">
              <Card>
                <CardHeader>
                  <CardTitle>每日活跃用户</CardTitle>
                  <CardDescription>最近 {activeDays} 天</CardDescription>
                  <CardAction>
                    <ChartRangeSelector
                      options={[
                        { value: 7, label: '7D' },
                        { value: 14, label: '14D' },
                        { value: 30, label: '30D' },
                      ]}
                      value={activeDays}
                      onChange={setActiveDays}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {activeLoading ? (
                    <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                      加载中...
                    </div>
                  ) : (
                    <TrendChart data={dailyActive} emptyHint="暂无活跃数据" />
                  )}
                </CardContent>
              </Card>
            </PermissionGuard>

            <PermissionGuard permission="stats:read">
              <Card>
                <CardHeader>
                  <CardTitle>工具调用次数</CardTitle>
                  <CardDescription>
                    {toolDays ? `最近 ${toolDays} 天` : '全部时间'}
                  </CardDescription>
                  <CardAction>
                    <ChartRangeSelector
                      options={[
                        { value: 7, label: '7D' },
                        { value: 14, label: '14D' },
                        { value: 30, label: '30D' },
                        { value: null, label: 'ALL' },
                      ]}
                      value={toolDays}
                      onChange={setToolDays}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {toolLoading ? (
                    <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                      加载中...
                    </div>
                  ) : (
                    <BarChart data={toolCallChartData} emptyHint="暂无工具调用记录" />
                  )}
                </CardContent>
              </Card>
            </PermissionGuard>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;

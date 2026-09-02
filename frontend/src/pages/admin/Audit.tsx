import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAdminApi } from './hooks/use-admin-api';
import { parseServerDate } from '../../lib/format-time';
import type { AuditLog } from './hooks/use-admin-api';
import AdminLoadingState from './components/AdminLoadingState';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const ACTION_FILTERS = [
  { value: '', label: '全部事件' },
  { value: 'user.', label: '用户' },
  { value: 'tool.', label: '工具' },
] as const;

const ACTION_INFO: Record<string, { label: string; tone: string }> = {
  'user.login': { label: '登录', tone: 'text-muted-foreground' },
  'user.create': { label: '创建用户', tone: 'text-primary' },
  'user.update': { label: '修改用户', tone: 'text-primary' },
  'user.delete': { label: '删除用户', tone: 'text-primary' },
  'tool.qrcode.generate': { label: '二维码生成', tone: 'text-primary' },
  'tool.calendar.info': { label: '日历查询', tone: 'text-primary' },
  'tool.asset.scan': { label: '资产扫描', tone: 'text-primary' },
  'tool.asset.compare': { label: '资产比对', tone: 'text-primary' },
  'tool.asset.finalize': { label: '比对定稿', tone: 'text-primary' },
  'tool.asset.download': { label: '产物下载', tone: 'text-primary' },
  'tool.attendance.process': { label: '出勤整理', tone: 'text-primary' },
  'tool.attendance.analyze': { label: '出勤分析', tone: 'text-primary' },
  'tool.attendance.download': { label: '出勤结果下载', tone: 'text-primary' },
  'tool.attendance.delete_result': { label: '删除出勤结果', tone: 'text-primary' },
  'tool.atlas_merge.delete': { label: '删除合并结果', tone: 'text-primary' },
  'tool.asset.save': { label: '资产保存', tone: 'text-primary' },
  'tool.asset.export': { label: '资产导出', tone: 'text-primary' },
  'tool.meta.update': { label: '工具配置', tone: 'text-primary' },
  'tool.meta.bulk_update': { label: '批量配置', tone: 'text-primary' },
};

interface AuditDateGroup {
  key: string;
  day: string;
  weekday: string;
  logs: AuditLog[];
}

const getAuditDateParts = (value: string) => {
  // 后端为无时区 UTC，parseServerDate 补 Z 解析后按本地时区取日期/时间。
  const date = parseServerDate(value);
  if (!date) return { key: '', day: '', weekday: '', time: '' };
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return {
    key: `${year}-${month}-${day}`,
    day: `${month} / ${day}`,
    weekday: date.toLocaleDateString('zh-CN', { weekday: 'long' }),
    time: date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
};

const groupAuditLogs = (logs: AuditLog[]) => {
  const groups: AuditDateGroup[] = [];

  for (const log of logs) {
    const date = getAuditDateParts(log.created_at);
    const currentGroup = groups.at(-1);

    if (currentGroup?.key === date.key) {
      currentGroup.logs.push(log);
    } else {
      groups.push({
        key: date.key,
        day: date.day,
        weekday: date.weekday,
        logs: [log],
      });
    }
  }

  return groups;
};

const formatAction = (action: string) =>
  ACTION_INFO[action] ?? { label: action, tone: 'text-primary' };

const AdminAudit: React.FC = () => {
  const api = useAdminApi();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionPrefix, setActionPrefix] = useState('');
  const [username, setUsername] = useState('');

  const fetchLogs = useCallback(
    (currentPage: number, currentPageSize: number) => {
      setLoading(true);
      setError('');
      api
        .listAuditLogs({
          skip: (currentPage - 1) * currentPageSize,
          limit: currentPageSize,
          action_prefix: actionPrefix || undefined,
          username: username || undefined,
        })
        .then((data) => {
          setLogs(data.items);
          setTotal(data.total);
        })
        .catch(() => setError('加载审计日志失败'))
        .finally(() => setLoading(false));
    },
    [api, actionPrefix, username],
  );

  useEffect(() => {
    fetchLogs(page, pageSize);
  }, [fetchLogs, page, pageSize]);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  const handleActionPrefixChange = (value: string) => {
    setActionPrefix(value);
    setPage(1);
  };

  const groupedLogs = groupAuditLogs(logs);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-sm text-muted-foreground">按时间倒序查看系统操作记录。</p>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="筛选事件类型"
        >
          {ACTION_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={actionPrefix === filter.value ? 'default' : 'outline'}
              aria-pressed={actionPrefix === filter.value}
              onClick={() => handleActionPrefixChange(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          id="audit-username-filter"
          type="search"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            setPage(1);
          }}
          placeholder="筛选用户名"
          aria-label="筛选用户名"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="hidden sm:flex">
            {total} 条 · 倒序
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>加载失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台审计日志"
          label="正在加载审计日志"
          detail="等待事件索引"
        />
      ) : groupedLogs.length > 0 ? (
        <div className="flex flex-col gap-6">
          {groupedLogs.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`audit-date-${group.key}`}
              className="flex flex-col gap-3"
            >
              <div>
                <h2
                  id={`audit-date-${group.key}`}
                  className="text-sm font-medium tracking-tight"
                >
                  {group.day}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {group.weekday} · {group.logs.length} 条
                </p>
              </div>

              <div className="overflow-hidden rounded-xl border">
                {group.logs.map((log) => (
                  <AuditEventRow key={log.id} log={log} />
                ))}
              </div>
            </section>
          ))}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm tabular-nums text-muted-foreground">
                显示 {rangeStart}–{rangeEnd} / {total}
              </span>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                每页
                <Select
                  value={String(pageSize)}
                  onValueChange={(value) => handlePageSizeChange(Number(value))}
                >
                  <SelectTrigger size="sm" aria-label="每页日志条数">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </Button>
              <span className="px-2 text-sm tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                下一页
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>无日志记录</EmptyTitle>
            <EmptyDescription>当前筛选条件下没有审计事件。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
};

const AuditEventRow: React.FC<{ log: AuditLog }> = ({ log }) => {
  const [expanded, setExpanded] = useState(false);
  const date = getAuditDateParts(log.created_at);
  const action = formatAction(log.action);

  return (
    <article className="border-b last:border-b-0 hover:bg-muted/40">
      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 md:grid-cols-[6rem_8rem_minmax(8rem,1fr)_minmax(6rem,1fr)_auto] md:items-center">
        <div className="text-sm tabular-nums">
          {date.time}
          <span className="mt-1 block text-xs text-muted-foreground">
            事件 #{log.id}
          </span>
        </div>

        <div className="min-w-0 text-sm">
          <span className="block truncate">{log.username ?? '系统'}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {log.ip_address ?? '—'}
          </span>
        </div>

        <div className="min-w-0">
          <strong className="block text-sm font-medium">{action.label}</strong>
          <code className={`mt-1 block truncate text-xs ${action.tone}`}>
            {log.action}
          </code>
        </div>

        <div className="min-w-0 text-sm">
          <span className="block truncate">
            {log.target_id ?? '无目标'}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {log.target_id ? `${log.target_type}#${log.target_id}` : '无目标'}
          </span>
        </div>

        <div className="flex justify-end sm:col-span-2 md:col-span-1">
          {log.detail ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? '收起' : '查看'}
            </Button>
          ) : (
            <span className="px-3 text-sm text-muted-foreground">—</span>
          )}
        </div>
      </div>

      {expanded && log.detail && (
        <AuditDetailPanel log={log} />
      )}
    </article>
  );
};

const AuditDetailPanel: React.FC<{ log: AuditLog }> = ({ log }) => {
  let detail = log.detail ?? '';

  try {
    detail = JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    // 非 JSON 详情按原文展示。
  }

  return (
    <div className="mx-4 mb-4 grid gap-4 rounded-lg border bg-muted/40 p-4 text-sm sm:grid-cols-2">
      <div>
        <span className="text-muted-foreground">目标类型</span>
        <p className="mt-1">{log.target_type ?? '—'}</p>
      </div>
      <div>
        <span className="text-muted-foreground">目标 ID</span>
        <p className="mt-1">{log.target_id ?? '—'}</p>
      </div>
      <div>
        <span className="text-muted-foreground">请求来源</span>
        <p className="mt-1">{log.ip_address ?? '—'}</p>
      </div>
      <div>
        <span className="text-muted-foreground">事件编号</span>
        <p className="mt-1">#{log.id}</p>
      </div>
      <div className="sm:col-span-2">
        <span className="text-muted-foreground">Payload</span>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-3 text-xs">
          {detail}
        </pre>
      </div>
    </div>
  );
};

export default AdminAudit;

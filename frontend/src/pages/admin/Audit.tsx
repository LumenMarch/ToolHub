import React, { useCallback, useEffect, useState } from 'react';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
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
    <div className="space-y-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Chronological evidence
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
            事件时间带
          </h2>
        </div>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="筛选事件类型"
        >
          {ACTION_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={actionPrefix === filter.value}
              onClick={() => handleActionPrefixChange(filter.value)}
              className={
                actionPrefix === filter.value
                  ? 'min-h-11 border border-primary px-4 font-mono text-xs uppercase tracking-widest text-primary'
                  : 'min-h-11 border border-border px-4 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground hover:text-foreground'
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <label
        htmlFor="audit-username-filter"
        className="flex min-h-14 items-center gap-4 border-y border-border"
      >
        <MagnifyingGlass
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">筛选用户名</span>
        <input
          id="audit-username-filter"
          type="search"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            setPage(1);
          }}
          placeholder="筛选用户名"
          className="min-w-0 flex-1 bg-transparent py-3 font-mono text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <span className="hidden shrink-0 font-mono text-xs uppercase tracking-widest text-muted-foreground sm:block">
          {total} events · desc
        </span>
      </label>

      {error && (
        <div className="border-l-2 border-primary bg-primary/10 p-4 font-mono text-sm uppercase tracking-widest text-primary">
          [ 异常: {error} ]
        </div>
      )}

      {loading ? (
        <AdminLoadingState
          ariaLabel="正在加载后台审计日志"
          label="[ 审计日志 · 同步中 ]"
          detail="等待事件索引"
        />
      ) : groupedLogs.length > 0 ? (
        <div>
          {groupedLogs.map((group) => (
            <section
              key={group.key}
              aria-labelledby={`audit-date-${group.key}`}
              className="grid border-t border-border md:grid-cols-[7.5rem_minmax(0,1fr)]"
            >
              <div className="py-5 pr-5 md:py-7">
                <h3
                  id={`audit-date-${group.key}`}
                  className="font-mono text-2xl font-medium tracking-tight"
                >
                  {group.day}
                </h3>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {group.weekday} · {group.logs.length} events
                </p>
              </div>

              <div className="border-l border-border">
                {group.logs.map((log) => (
                  <AuditEventRow key={log.id} log={log} />
                ))}
              </div>
            </section>
          ))}

          <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                显示 {rangeStart}–{rangeEnd} / {total}
              </span>
              <label className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                每页
                <span className="relative">
                  <select
                    aria-label="每页日志条数"
                    value={pageSize}
                    onChange={(event) =>
                      handlePageSizeChange(Number(event.target.value))
                    }
                    className="min-h-9 appearance-none border border-border bg-transparent py-1 pl-3 pr-8 text-base outline-none focus:border-primary sm:text-xs"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                  <CaretDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2" />
                </span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="min-h-11 border border-border px-4 font-mono text-xs uppercase tracking-widest transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                ← 上一页
              </button>
              <span className="px-2 font-mono text-xs tabular-nums text-muted-foreground">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                className="min-h-11 border border-border px-4 font-mono text-xs uppercase tracking-widest transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                下一页 →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-border px-6 py-16 text-center">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            [ 无日志记录 ]
          </p>
        </div>
      )}
    </div>
  );
};

const AuditEventRow: React.FC<{ log: AuditLog }> = ({ log }) => {
  const [expanded, setExpanded] = useState(false);
  const date = getAuditDateParts(log.created_at);
  const action = formatAction(log.action);

  return (
    <article
      className={`relative border-b border-border pl-5 transition-colors last:border-b-0 hover:bg-muted/40 before:absolute before:-left-[0.3125rem] before:top-7 before:size-2 before:border before:bg-background ${
        expanded
          ? 'before:border-primary before:bg-primary'
          : 'before:border-muted-foreground'
      }`}
    >
      <div className="grid gap-4 py-4 pr-1 sm:grid-cols-2 md:min-h-[4.75rem] md:grid-cols-[5.75rem_8.5rem_12.5rem_minmax(8rem,1fr)_4rem] md:items-center md:gap-0 md:py-0">
        <div className="font-mono text-xs tabular-nums">
          {date.time}
          <span className="mt-1 block text-xs text-muted-foreground">
            事件 #{log.id}
          </span>
        </div>

        <div className="min-w-0 font-mono text-xs">
          <span className="block truncate">{log.username ?? '系统'}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {log.ip_address ?? '—'}
          </span>
        </div>

        <div className="min-w-0">
          <strong className="block text-sm font-medium">{action.label}</strong>
          <code
            className={`mt-1 block truncate font-mono text-xs ${action.tone}`}
          >
            {log.action}
          </code>
        </div>

        <div className="min-w-0 text-sm">
          <span className="block truncate">
            {log.target_id ?? '无目标'}
          </span>
          <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
            {log.target_id ? `${log.target_type}#${log.target_id}` : '无目标'}
          </span>
        </div>

        <div className="flex justify-end sm:col-span-2 md:col-span-1">
          {log.detail ? (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
              className="min-h-9 border border-border px-3 font-mono text-xs transition-colors hover:border-primary hover:text-primary"
            >
              {expanded ? '收起' : '查看'}
            </button>
          ) : (
            <span className="px-3 font-mono text-xs text-muted-foreground">
              —
            </span>
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
    <div className="mb-5 mr-1 grid gap-4 border border-primary bg-primary/[0.03] p-4 font-mono text-xs sm:grid-cols-2">
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
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all bg-foreground p-3 text-background">
          {detail}
        </pre>
      </div>
    </div>
  );
};

export default AdminAudit;

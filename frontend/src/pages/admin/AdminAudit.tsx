import React, { useCallback, useEffect, useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { useAdminApi } from '../../hooks/useAdminApi';
import type { AuditLog } from '../../hooks/useAdminApi';
import DataTable from '../../components/admin/DataTable';
import type { Column } from '../../components/admin/DataTable';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const AdminAudit: React.FC = () => {
  const api = useAdminApi();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 筛选条件
  const [actionPrefix, setActionPrefix] = useState('');
  const [username, setUsername] = useState('');

  const fetchLogs = useCallback(
    (p: number, size: number) => {
      setLoading(true);
      setError('');
      api
        .listAuditLogs({
          skip: (p - 1) * size,
          limit: size,
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

  const formatDate = (s: string) => {
    const d = new Date(s);
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // 把 action 转成可读的中文标签 + 配色。
  const formatAction = (action: string) => {
    const map: Record<string, { label: string; tone: string }> = {
      'user.login': { label: '登录', tone: 'text-muted-foreground' },
      'user.create': { label: '创建用户', tone: 'text-primary' },
      'user.update': { label: '修改用户', tone: 'text-primary' },
      'user.delete': { label: '删除用户', tone: 'text-primary' },
      'tool.attendance.process': { label: '出勤整理', tone: '' },
      'tool.attendance.analyze': { label: '出勤分析', tone: '' },
      'tool.asset.save': { label: '资产保存', tone: '' },
      'tool.asset.export': { label: '资产导出', tone: '' },
      'tool.meta.update': { label: '工具配置', tone: '' },
      'tool.meta.bulk_update': { label: '批量配置', tone: '' },
    };
    const info = map[action] ?? { label: action, tone: '' };
    return info;
  };

  const columns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      header: '时间',
      sortable: true,
      sortValue: (l) => l.created_at,
      render: (l) => (
        <span className="text-[11px] font-mono text-muted-foreground">
          {formatDate(l.created_at)}
        </span>
      ),
    },
    {
      key: 'username',
      header: '用户',
      sortable: true,
      sortValue: (l) => l.username ?? '',
      render: (l) => (
        <span className="text-xs font-mono">
          {l.username ?? <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      key: 'action',
      header: '操作',
      render: (l) => {
        const info = formatAction(l.action);
        return (
          <span className={`text-[11px] font-mono uppercase tracking-widest ${info.tone}`}>
            {info.label}
          </span>
        );
      },
    },
    {
      key: 'target',
      header: '目标',
      render: (l) =>
        l.target_id ? (
          <span className="text-[11px] font-mono text-muted-foreground">
            {l.target_type}#{l.target_id}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'ip_address',
      header: 'IP',
      render: (l) => (
        <span className="text-[11px] font-mono text-muted-foreground">
          {l.ip_address ?? '—'}
        </span>
      ),
    },
    {
      key: 'detail',
      header: '详情',
      render: (l) =>
        l.detail ? <DetailCell detail={l.detail} /> : <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-8">
      <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        谁在何时做了什么
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={actionPrefix}
            onChange={(e) => handleActionPrefixChange(e.target.value)}
            className="appearance-none bg-transparent border border-border px-3 py-2 pr-8 text-[11px] font-mono uppercase tracking-widest focus:border-primary outline-none"
          >
            <option value="">全部操作</option>
            <option value="user.">用户相关</option>
            <option value="tool.">工具相关</option>
          </select>
          <CaretDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-muted-foreground" />
        </div>
        <input
          type="search"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setPage(1);
          }}
          placeholder="筛选用户名..."
          className="awwwards-input w-48"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            每页
          </span>
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="appearance-none bg-transparent border border-border px-2 py-1 pr-6 text-[11px] font-mono focus:border-primary outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <CaretDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-muted-foreground" />
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm font-mono text-primary bg-primary/10 p-4 border-l-2 border-primary uppercase tracking-widest">
          [ 异常: {error} ]
        </div>
      )}

      <div className="border border-border">
        <DataTable
          columns={columns}
          data={logs}
          rowKey={(l) => l.id}
          emptyHint={loading ? '加载中...' : '无日志记录'}
          pageSize={pageSize}
          page={page}
          onPageChange={setPage}
          total={total}
          alwaysShowPagination
        />
      </div>
    </div>
  );
};

// 详情单元格：点击展开 JSON。
const DetailCell: React.FC<{ detail: string }> = ({ detail }) => {
  const [expanded, setExpanded] = React.useState(false);

  let pretty = detail;
  try {
    pretty = JSON.stringify(JSON.parse(detail), null, 2);
  } catch {
    // 非 JSON 原样展示。
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors"
      >
        {expanded ? '收起' : '查看'}
      </button>
      {expanded && (
        <pre className="mt-2 p-2 bg-muted/40 text-[10px] font-mono overflow-x-auto max-w-xs whitespace-pre-wrap break-all">
          {pretty}
        </pre>
      )}
    </div>
  );
};

export default AdminAudit;

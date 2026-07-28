import React from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  // 用于排序的字段访问器
  sortValue?: (row: T) => string | number;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  emptyHint?: string;
  // 分页
  pageSize?: number;
  // 当前页（受控）
  page?: number;
  onPageChange?: (page: number) => void;
  total?: number;
  // 是否始终显示分页信息条（即使只有一页）。默认 false。
  alwaysShowPagination?: boolean;
}

function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyHint = '暂无数据',
  pageSize,
  page,
  onPageChange,
  total,
  alwaysShowPagination = false,
}: DataTableProps<T>) {
  const [internalPage, setInternalPage] = React.useState(1);
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  // 内部分页模式（未传 page 时）
  const effectivePage = page ?? internalPage;
  const setPage = onPageChange ?? setInternalPage;
  const effectivePageSize = pageSize ?? data.length;
  const effectiveTotal = total ?? data.length;
  const totalPages = Math.max(1, Math.ceil(effectiveTotal / effectivePageSize));

  // 内部排序（仅在未传 total 时，即客户端分页模式生效）
  const sortedData = React.useMemo(() => {
    if (total !== undefined) return data; // 服务端分页，不在前端排序
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;
    const sorted = data.toSorted((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data, sortKey, sortDir, columns, total]);

  const handleSort = (col: Column<T>) => {
    if (!col.sortable) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  };

  const showPagination =
    pageSize !== undefined &&
    (alwaysShowPagination || effectiveTotal > effectivePageSize);

  return (
    <div className="w-full">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left py-3 px-3 text-[11px] font-mono uppercase tracking-widest text-muted-foreground font-medium ${col.className ?? ''}`}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col)}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground select-none"
                    >
                      {col.header}
                      {sortKey === col.key && (
                        sortDir === 'asc' ? <CaretUp className="w-3 h-3" /> : <CaretDown className="w-3 h-3" />
                      )}
                    </button>
                  ) : (
                    <span>{col.header}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="py-12 text-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground opacity-60"
                >
                  {emptyHint}
                </td>
              </tr>
            ) : (
              sortedData.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors"
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`py-3 px-3 text-sm ${col.className ?? ''}`}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <div className="flex items-center justify-between mt-4 px-3">
          <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            {(effectivePage - 1) * effectivePageSize + 1}-{Math.min(effectivePage * effectivePageSize, effectiveTotal)} / {effectiveTotal}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, effectivePage - 1))}
              disabled={effectivePage <= 1}
              className="px-3 py-1 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              上一页
            </button>
            <span className="text-[11px] font-mono">
              {effectivePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, effectivePage + 1))}
              disabled={effectivePage >= totalPages}
              className="px-3 py-1 text-[11px] font-mono uppercase tracking-widest border border-border hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;

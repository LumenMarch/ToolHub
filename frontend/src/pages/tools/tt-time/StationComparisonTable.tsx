import React, { useMemo } from 'react';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import type { StationBoxGroup } from './lib';
import { buildStationComparisonTable, formatStationNumericName } from './lib';

interface StationComparisonTableProps {
  groups: StationBoxGroup[];
  title?: string;
  className?: string;
}

export const StationComparisonTable: React.FC<StationComparisonTableProps> = ({
  groups,
  title = '各机台数据对比',
  className = '',
}) => {
  const tableData = useMemo(() => buildStationComparisonTable(groups), [groups]);

  // 导出表格为 Excel 文件
  const handleExportExcel = () => {
    if (groups.length === 0) return;
    const headerRow = ['机台', ...tableData.stations.map((s) => formatStationNumericName(s))];
    const dataRows = tableData.rows.map((row) => [
      row.label,
      ...tableData.stations.map((s) => row.values[s] ?? ''),
    ]);

    const aoa = [headerRow, ...dataRows];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, '机台数据对比');
    XLSX.writeFile(wb, `${title || '机台数据对比'}.xlsx`);
  };

  if (groups.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        暂无机台统计数据
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-semibold text-foreground tracking-tight">
            {title}
          </h3>
          <span className="text-xs text-muted-foreground">
            (共 {tableData.stations.length} 台机台 · 可拖动下方滑块横向浏览)
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExportExcel}
          className="h-8 gap-1.5 text-xs"
        >
          <Download className="size-3.5" />
          导出 Excel 表格
        </Button>
      </div>

      <div className="relative w-full rounded-md border border-border bg-card shadow-xs">
        <div className="w-full overflow-x-auto overflow-y-auto pb-1 [scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground)/0.4)_hsl(var(--muted)/0.4)] [&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-track]:bg-muted/40 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/60">
          <table className="w-full border-collapse text-center text-xs">
            <thead>
              <tr className="bg-muted text-muted-foreground">
                <th className="sticky left-0 top-0 z-20 min-w-[72px] max-w-[90px] border-b border-r border-border/80 bg-muted px-3 py-2 font-bold text-foreground">
                  机台
                </th>
                {tableData.stations.map((station) => (
                  <th
                    key={`th-${station}`}
                    title={`原始机台: ${station}`}
                    className="sticky top-0 z-10 min-w-[48px] border-b border-r border-border/80 bg-muted px-2 py-2 font-semibold text-foreground last:border-r-0"
                  >
                    {formatStationNumericName(station)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {tableData.rows.map((row) => (
                <tr
                  key={row.label}
                  className="transition-colors hover:bg-muted/40"
                >
                  <th className="sticky left-0 z-10 border-r border-border/80 bg-card px-3 py-2 text-left font-bold text-foreground shadow-[1px_0_0_0_hsl(var(--border))]">
                    {row.label}
                  </th>
                  {tableData.stations.map((station) => {
                    const val = row.values[station];
                    const isQ3 = row.label === 'Q3';
                    return (
                      <td
                        key={`cell-${row.label}-${station}`}
                        className={`min-w-[48px] border-r border-border/60 px-2 py-2 tabular-nums last:border-r-0 ${
                          isQ3
                            ? 'font-bold text-primary bg-primary/5'
                            : 'text-foreground/90'
                        }`}
                      >
                        {val !== undefined ? val : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

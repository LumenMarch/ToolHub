// 导出页的测试项勾选列表：搜索、全选/清空、仅保留有规格限。
import React from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { shortName } from '../lib/stats';
import type { MergeItem } from '../store/useOppStore';
import type { ParsedDataset } from '../lib/dataset';

interface ExportItemPickerProps {
  merged: MergeItem[];
  filtered: MergeItem[];
  checkedNames: Set<string>;
  query: string;
  compareMode: boolean;
  datasetA: ParsedDataset | null;
  datasetB: ParsedDataset | null;
  onQueryChange: (value: string) => void;
  onCheckedChange: (next: Set<string>) => void;
  /** 卡片底部的导出动作区，沿用同一张卡片的边框与间距 */
  footer?: React.ReactNode;
}

/** 该测试项在任一数据源里是否带规格限。 */
function hasSpecLimit(name: string, datasetA: ParsedDataset | null, datasetB: ParsedDataset | null): boolean {
  const a = datasetA?.columns.find((c) => c.name === name);
  const b = datasetB?.columns.find((c) => c.name === name);
  return !!((a && (a.upper !== null || a.lower !== null)) || (b && (b.upper !== null || b.lower !== null)));
}

export const ExportItemPicker: React.FC<ExportItemPickerProps> = ({
  merged,
  filtered,
  checkedNames,
  query,
  compareMode,
  datasetA,
  datasetB,
  onQueryChange,
  onCheckedChange,
  footer,
}) => {
  const toggle = (name: string) => {
    const next = new Set(checkedNames);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onCheckedChange(next);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="搜索测试项"
            placeholder="搜索测试项…"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            已勾选 {checkedNames.size}/{merged.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onCheckedChange(new Set(merged.map((m) => m.name)))}
          >
            全选
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onCheckedChange(new Set())}>
            清空
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onCheckedChange(
                new Set(merged.flatMap((m) => (hasSpecLimit(m.name, datasetA, datasetB) ? [m.name] : []))),
              )
            }
          >
            仅保留有规格限
          </Button>
        </div>
      </div>

      <div className="max-h-[28rem] overflow-y-auto px-2 py-1">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">无匹配测试项</p>
        ) : null}
        {filtered.map((m) => (
          <label
            key={m.name}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={checkedNames.has(m.name)}
              onChange={() => toggle(m.name)}
              className="size-3.5 shrink-0 accent-primary"
            />
            <span className="min-w-0 flex-1 break-words text-sm leading-snug">{shortName(m.name)}</span>
            {compareMode ? (
              <span
                className={cn(
                  'shrink-0 rounded-md border px-1.5 py-0.5 text-[0.5625rem]',
                  m.hasA && m.hasB
                    ? 'border-status-success-foreground bg-status-success-surface text-status-success-foreground'
                    : 'border-status-warning-foreground bg-status-warning-surface text-status-warning-foreground',
                )}
              >
                {m.hasA && m.hasB ? 'A·B' : !m.hasA ? 'B only' : 'A only'}
              </span>
            ) : null}
          </label>
        ))}
      </div>
      {footer}
    </div>
  );
};

export default ExportItemPicker;

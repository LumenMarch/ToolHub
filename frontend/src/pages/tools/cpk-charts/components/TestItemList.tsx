// 测试项列表（左侧栏）— 点击选中测试项；含 GREP 搜索与来源徽章
import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useShallow } from 'zustand/react/shallow';
import useOppStore, { getFiltered, getMerged } from '../store/useOppStore';
import { shortName } from '../lib/stats';

const TestItemList: React.FC = () => {
  const query = useOppStore((s) => s.query);
  const setQuery = useOppStore((s) => s.setQuery);
  const setSelectedName = useOppStore((s) => s.setSelectedName);
  const selectedName = useOppStore((s) => s.selectedName);
  const merged = useOppStore(useShallow((s) => getMerged(s)));
  const filtered = useOppStore(useShallow((s) => getFiltered(s)));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="GREP 搜索测试项"
          placeholder="GREP 搜索（正则）"
          className="h-8 pl-8 text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.625rem] text-muted-foreground">
        <span className="rounded-md border px-2 py-0.5">共 {filtered.length} 项</span>
        <span className="rounded-md border border-status-success-foreground bg-status-success-surface px-2 py-0.5 text-status-success-foreground">
          {filtered.filter((m) => m.hasA && m.hasB).length} 两边
        </span>
        <span className="rounded-md border border-status-warning-foreground bg-status-warning-surface px-2 py-0.5 text-status-warning-foreground">
          {filtered.filter((m) => m.hasA !== m.hasB).length} 仅一边
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-background">
        {filtered.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">无匹配测试项</p>
        ) : null}
        <ul className="divide-y divide-border">
          {filtered.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                onClick={() => setSelectedName(m.name)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-[0.6875rem] transition-colors',
                  selectedName === m.name ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 break-words leading-snug">{shortName(m.name)}</span>
                <span className="shrink-0 text-muted-foreground">{m.unit || '—'}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-md border px-1.5 py-0.5 text-[0.5625rem]',
                    !m.hasData
                      ? 'border-border text-muted-foreground'
                      : m.hasA && m.hasB
                        ? 'border-status-success-foreground bg-status-success-surface text-status-success-foreground'
                        : 'border-status-warning-foreground bg-status-warning-surface text-status-warning-foreground',
                  )}
                >
                  {!m.hasData ? 'NO DATA' : !m.hasA ? 'B only' : !m.hasB ? 'A only' : 'A·B'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {merged.length === 0 ? <p className="text-[0.625rem] text-muted-foreground">暂无可展示项</p> : null}
    </div>
  );
};

export default TestItemList;

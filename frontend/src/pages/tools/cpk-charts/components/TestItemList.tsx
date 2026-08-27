// 测试项列表（左侧栏）— 点击选中测试项；含 GREP 搜索与来源徽章
import React from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from '../../../../lib/cn';
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
      {/* 搜索 + 计数 */}
      <div className="flex items-center gap-2 border border-border bg-muted/30 px-2 py-1.5">
        <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="GREP 搜索测试项"
          placeholder="GREP 搜索（正则）"
          className="w-full min-w-0 bg-transparent font-mono text-[0.6875rem] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.625rem] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        <span className="border border-border px-2 py-0.5">共 {filtered.length} 项</span>
        <span className="border border-status-success-foreground bg-status-success-surface px-2 py-0.5 text-status-success-foreground">
          {filtered.filter((m) => m.hasA && m.hasB).length} 两边
        </span>
        <span className="border border-status-warning-foreground bg-status-warning-surface px-2 py-0.5 text-status-warning-foreground">
          {filtered.filter((m) => m.hasA !== m.hasB).length} 仅一边
        </span>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-auto border border-border bg-background">
        {filtered.length === 0 && (
          <p className="p-4 font-mono text-xs text-muted-foreground">[ 无匹配测试项 ]</p>
        )}
        <ul className="divide-y divide-border">
          {filtered.map((m) => (
            <li key={m.name}>
              <button
                type="button"
                onClick={() => setSelectedName(m.name)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[0.6875rem] transition-colors',
                  selectedName === m.name ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 break-words leading-snug">{shortName(m.name)}</span>
                <span className="shrink-0 text-muted-foreground">{m.unit || '—'}</span>
                <span
                  className={cn(
                    'shrink-0 border px-1.5 py-0.5 text-[0.5625rem] uppercase tracking-[0.1em]',
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

      {merged.length === 0 && <p className="font-mono text-[0.625rem] text-muted-foreground">暂无可展示项</p>}
    </div>
  );
};

export default TestItemList;

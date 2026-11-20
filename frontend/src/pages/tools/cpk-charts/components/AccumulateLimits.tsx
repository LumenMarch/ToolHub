// 累加模式：同一测试项在不同 Upper/Lower Limit 下的 CPK 对比。
// 打开后填 limits 点「添加」，在原图下方追加对应规格限的图；每条都可删除。
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  analyzeColumn,
  formatIndex,
  formatSpecLimit,
  type ChartSettings,
  type ColumnValues,
} from '../lib/stats';
import { loadColumn, type ParsedDataset } from '../lib/dataset';
import useOppStore, { accumulatedKey, type AccumulatedLimit } from '../store/useOppStore';
import CpkHistogram from './CpkHistogram';
import CdfChart from './CdfChart';
import TimeSeriesChart from './TimeSeriesChart';
import type { ChartView } from './ChartWorkspace';

const MAX_ENTRIES = 20;
const NO_ENTRIES: AccumulatedLimit[] = [];

interface AccumulateLimitsProps {
  dataset: ParsedDataset | null;
  selectedName: string;
  view: Exclude<ChartView, 'correlation'>;
  settings: ChartSettings;
  excludeFail: boolean;
  /** 打开累加模式时预填的规格限（当前列的生效值） */
  defaultUpper: number | null;
  defaultLower: number | null;
}

/** 只允许输入数值（可带负号与一个小数点），其余按键直接忽略。 */
const NUMERIC_DRAFT = /^-?\d*\.?\d*$/;

/** 解析输入框：空白回退到原规格限（背景默认值），非法输入返回 undefined。 */
const resolveLimit = (
  raw: string,
  fallback: number | null,
): number | null | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
};

export const AccumulateLimits: React.FC<AccumulateLimitsProps> = ({
  dataset,
  selectedName,
  view,
  settings,
  excludeFail,
  defaultUpper,
  defaultLower,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [draftUpper, setDraftUpper] = useState('');
  const [draftLower, setDraftLower] = useState('');
  // 累加组合放在 store：导出报告也要读同一份数据
  const accumulatedLimits = useOppStore((s) => s.accumulatedLimits);
  const addAccumulatedLimit = useOppStore((s) => s.addAccumulatedLimit);
  const removeAccumulatedLimit = useOppStore((s) => s.removeAccumulatedLimit);
  const clearAccumulatedLimits = useOppStore((s) => s.clearAccumulatedLimits);
  // 一并记录数据所属的 key：切换数据集/测试项的首帧不会拿旧列算出错的图
  const [loaded, setLoaded] = useState<{ key: string; values: ColumnValues } | null>(null);

  const key = dataset ? accumulatedKey(dataset.uploadId, selectedName) : '';
  const entries = useMemo(() => accumulatedLimits[key] ?? NO_ENTRIES, [accumulatedLimits, key]);
  const columnIndex = dataset ? dataset.columns.findIndex((c) => c.name === selectedName) : -1;

  useEffect(() => {
    if (!enabled || !dataset || columnIndex < 0) return;
    let cancelled = false;
    void loadColumn(dataset, columnIndex)
      .then((values) => {
        if (!cancelled) setLoaded({ key, values });
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, dataset, columnIndex, key]);

  const analyses = useMemo(() => {
    if (!enabled || !dataset || !loaded || loaded.key !== key || columnIndex < 0) return [];
    const column = dataset.columns[columnIndex];
    const mask = excludeFail ? dataset.statusPass : null;
    return entries.map((entry) => ({
      entry,
      analysis: analyzeColumn(
        { ...column, upper: entry.upper, lower: entry.lower },
        loaded.values,
        mask,
        settings.binCount,
        settings.lowerRange,
        settings.upperRange,
        settings.showLimits,
      ),
    }));
  }, [enabled, dataset, loaded, key, columnIndex, entries, excludeFail, settings]);

  const toggle = () => setEnabled((prev) => !prev);

  // 输入框始终从空开始，原规格限只作为 placeholder 提示，不参与编辑内容
  const draftUpperLimit = resolveLimit(draftUpper, defaultUpper);
  const draftLowerLimit = resolveLimit(draftLower, defaultLower);
  const draftValid = (() => {
    if (draftUpperLimit === undefined || draftLowerLimit === undefined) return false;
    if (draftUpperLimit === null && draftLowerLimit === null) return false;
    if (draftUpperLimit !== null && draftLowerLimit !== null && !(draftUpperLimit > draftLowerLimit)) return false;
    return true;
  })();

  const addEntry = () => {
    if (!draftValid || !key) return;
    const upper = draftUpperLimit;
    const lower = draftLowerLimit;
    if (upper === undefined || lower === undefined) return;
    addAccumulatedLimit(key, { upper, lower });
  };

  const removeEntry = (id: string) => {
    if (key) removeAccumulatedLimit(key, id);
  };

  const clearEntries = () => {
    if (key) clearAccumulatedLimits(key);
  };

  const renderChart = (
    analysis: (typeof analyses)[number]['analysis'],
    extraStats: Array<{ label: string; value: string }>,
  ) => {
    if (view === 'cdf') {
      return <CdfChart analysis={analysis} settings={settings} extraStats={extraStats} />;
    }
    if (view === 'timeseries') {
      return <TimeSeriesChart analysis={analysis} settings={settings} extraStats={extraStats} />;
    }
    return <CpkHistogram analysis={analysis} settings={settings} extraStats={extraStats} />;
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={enabled ? 'default' : 'outline'}
          onClick={toggle}
          aria-pressed={enabled}
        >
          <Plus data-icon="inline-start" />
          累加模式
        </Button>
        {enabled ? (
          <>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Upper
              <Input
                aria-label="累加规格上限"
                className="h-8 w-24"
                inputMode="decimal"
                placeholder={defaultUpper === null ? '不设限' : formatSpecLimit(defaultUpper)}
                value={draftUpper}
                onChange={(e) => {
                  const next = e.target.value;
                  if (NUMERIC_DRAFT.test(next)) setDraftUpper(next);
                }}
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Lower
              <Input
                aria-label="累加规格下限"
                className="h-8 w-24"
                inputMode="decimal"
                placeholder={defaultLower === null ? '不设限' : formatSpecLimit(defaultLower)}
                value={draftLower}
                onChange={(e) => {
                  const next = e.target.value;
                  if (NUMERIC_DRAFT.test(next)) setDraftLower(next);
                }}
              />
            </label>
            <Button type="button" size="sm" variant="outline" disabled={!draftValid} onClick={addEntry}>
              添加
            </Button>
            {entries.length > 0 ? (
              <Button type="button" size="sm" variant="ghost" onClick={clearEntries}>
                清空
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">
              留空沿用原规格限；最多 {MAX_ENTRIES} 组
            </span>
          </>
        ) : null}
      </div>

      {enabled && analyses.map(({ entry, analysis }) => {
        const extraStats = [
          { label: 'Upper', value: formatSpecLimit(entry.upper) },
          { label: 'Lower', value: formatSpecLimit(entry.lower) },
        ];
        return (
        <div key={entry.id} className="flex flex-col gap-2 rounded-lg border bg-background p-2 sm:p-3">
          <div
            className={
              settings.showStats
                ? 'flex items-start justify-end px-1'
                : 'flex flex-wrap items-start justify-between gap-2 px-1'
            }
          >
            {/* 统计关闭时左侧没有 Cpk/规格限，退回到卡片头部展示 */}
            {settings.showStats ? null : (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium tabular-nums">
                  Cpk {formatIndex(analysis.stat.cpk)}
                </span>
                <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                  Upper {formatSpecLimit(entry.upper)} · Lower {formatSpecLimit(entry.lower)}
                </span>
              </div>
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`删除 Upper ${formatSpecLimit(entry.upper)} Lower ${formatSpecLimit(entry.lower)}`}
              onClick={() => removeEntry(entry.id)}
            >
              <X />
            </Button>
          </div>
          {renderChart(analysis, extraStats)}
        </div>
        );
      })}

      {enabled && analyses.length === 0 ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Trash2 className="size-3.5" />
          还没有累加图：填好 Upper / Lower 后点「添加」。
        </p>
      ) : null}
    </div>
  );
};

export default AccumulateLimits;

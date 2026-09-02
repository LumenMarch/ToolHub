import React, { useMemo, useState } from 'react';
import { BarChart3, Download, Images, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import useOppStore, { getActive, getCorrPair, getMerged, getSharedPair } from '../store/useOppStore';
import { shortName } from '../lib/stats';
import { exportChartPng, exportComparedByName, exportCorrelationPng } from '../lib/export';
import { buildItemCheckImages, exportItemCheckReport } from '../lib/itemCheckReport';
import type { ParsedDataset } from '../lib/csv';
type ExportState = { kind: 'single' } | { kind: 'all'; done: number; total: number } | { kind: 'itemCheck'; done: number; total: number } | null;

const Export: React.FC = () => {
  const datasetA = useOppStore((s) => s.datasetA);
  const datasetB = useOppStore((s) => s.datasetB);
  const selectedName = useOppStore((s) => s.selectedName);
  const corrYName = useOppStore((s) => s.corrYName);
  const chartType = useOppStore((s) => s.chartType);
  const settings = useOppStore((s) => s.settings);
  const fileNameA = useOppStore((s) => s.fileNameA);
  const fileNameB = useOppStore((s) => s.fileNameB);
  const compareMode = useOppStore((s) => s.compareMode);
  const setError = useOppStore((s) => s.setError);
  const merged = useOppStore(useShallow((s) => getMerged(s)));

  const [exporting, setExporting] = useState<ExportState>(null);
  const [exportQuery, setExportQuery] = useState('');
  const [exportChecked, setExportChecked] = useState<Set<string>>(() => new Set(merged.map((m) => m.name)));

  const filteredExport = useMemo(() => {
    const q = exportQuery.trim().toLowerCase();
    return merged.filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [merged, exportQuery]);

  const hasAnyLimit = (name: string): boolean => {
    const a = datasetA?.columns.find((c) => c.name === name);
    const b = datasetB?.columns.find((c) => c.name === name);
    return !!((a && (a.upper !== null || a.lower !== null)) || (b && (b.upper !== null || b.lower !== null)));
  };

  const shared = getSharedPair({ datasetA, datasetB, compareMode, selectedName, settings } as never);
  const activeA = useMemo(() => {
    if (shared) return { index: shared.idxA, analysis: shared.pair.a };
    return getActive(datasetA, selectedName, settings);
  }, [shared, datasetA, selectedName, settings]);
  const activeB = useMemo(() => {
    if (shared) return { index: shared.idxB, analysis: shared.pair.b };
    return getActive(datasetB, selectedName, settings);
  }, [shared, datasetB, selectedName, settings]);

  const handleExportCurrent = async () => {
    if (!activeA && !activeB) return;
    setExporting({ kind: 'single' });
    try {
      // 两个文件都存在时导出当前 Item 的两张图，用 A_/B_ 前缀区分来源
      if (activeA) await exportChartPng(activeA.analysis, settings, 'A');
      if (datasetB && activeB) await exportChartPng(activeB.analysis, settings, 'B');
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片导出失败');
    } finally {
      setExporting(null);
    }
  };

  const handleExportCorrelation = async () => {
    const pair = getCorrPair(datasetA, selectedName, corrYName, settings) ?? getCorrPair(datasetB, selectedName, corrYName, settings);
    if (!pair) return;
    setExporting({ kind: 'single' });
    try {
      await exportCorrelationPng(pair, settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : '相关性图导出失败');
    } finally {
      setExporting(null);
    }
  };

  const hasBothDatasets = Boolean(datasetA && datasetB);

  /** 批量导出勾选测试项的图片 ZIP：A / B / 双源合并。 */
  const handleExportImages = async (scope: 'A' | 'B' | 'all') => {
    if (exportChecked.size === 0) return;
    const names = Array.from(exportChecked);
    const sources: Array<{ dataset: ParsedDataset; prefix: string }> = [];
    if (datasetA && scope !== 'B') sources.push({ dataset: datasetA, prefix: 'A' });
    if (datasetB && scope !== 'A') sources.push({ dataset: datasetB, prefix: 'B' });
    if (sources.length === 0) return;
    setExporting({ kind: 'all', done: 0, total: names.length });
    try {
      // 同名 Item 在双数据源下会产出多个文件：total 以导出器实际值为准，避免 2/1 之类的显示
      await exportComparedByName(sources, names, settings, (done, total) => setExporting({ kind: 'all', done, total }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量导出失败');
    } finally {
      setExporting(null);
    }
  };

  /** 批量导出报告：A / B 单列报告或 A+B 合并报告。 */
  const handleExportReport = async (scope: 'A' | 'B' | 'merged') => {
    if (exportChecked.size === 0) return;
    const names = merged.flatMap((m) => (exportChecked.has(m.name) ? [m.name] : []));
    if (names.length === 0) return;
    setExporting({ kind: 'itemCheck', done: 0, total: names.length });
    try {
      const view = chartType === 'cdf' || chartType === 'timeseries' ? chartType : 'histogram';
      const onProgress = (done: number) => setExporting({ kind: 'itemCheck', done, total: names.length });
      if (scope === 'B') {
        const { imagesB } = await buildItemCheckImages(null, datasetB, names, settings, onProgress, view);
        await exportItemCheckReport({
          items: names,
          fileNameA: fileNameB || datasetB?.title || '数据 B',
          imagesA: imagesB,
        });
        return;
      }
      const { imagesA, imagesB } = await buildItemCheckImages(
        datasetA,
        scope === 'A' ? null : datasetB,
        names,
        settings,
        onProgress,
        view,
      );
      if (scope === 'A') {
        await exportItemCheckReport({
          items: names,
          fileNameA: fileNameA || datasetA?.title || '数据 A',
          imagesA,
        });
        return;
      }
      await exportItemCheckReport({
        items: names,
        fileNameA: fileNameA || datasetA?.title || '数据 A',
        fileNameB: fileNameB || datasetB?.title || '数据 B',
        imagesA,
        imagesB,
      });
    } catch (err) {
      const detail = (err as unknown as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (err instanceof Error ? err.message : '报告导出失败'));
    } finally {
      setExporting(null);
    }
  };

  if (!datasetA && !datasetB) {
    return (
      <Empty className="h-64 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BarChart3 />
          </EmptyMedia>
          <EmptyTitle>请先在总览上传数据</EmptyTitle>
          <EmptyDescription>返回总览后选择 CSV 再导出。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3">
        <Button type="button" variant="outline" size="sm" onClick={handleExportCurrent} disabled={exporting !== null || (!activeA && !activeB)}>
          <Download data-icon="inline-start" />
          导出当前{selectedName ? ` · ${shortName(selectedName)}` : ''}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleExportCorrelation} disabled={exporting !== null || !selectedName || !corrYName}>
          <Download data-icon="inline-start" />
          导出相关性图{selectedName && corrYName ? ` · ${shortName(selectedName)} vs ${shortName(corrYName)}` : ''}
        </Button>
        {exporting?.kind === 'single' ? <span className="text-xs text-muted-foreground">导出中…</span> : null}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card">
        <div className="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              value={exportQuery}
              onChange={(e) => setExportQuery(e.target.value)}
              aria-label="搜索测试项"
              placeholder="搜索测试项…"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">已勾选 {exportChecked.size}/{merged.length}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExportChecked(new Set(merged.map((m) => m.name)))}>
              全选
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExportChecked(new Set())}>
              清空
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExportChecked(new Set(merged.flatMap((m) => (hasAnyLimit(m.name) ? [m.name] : []))))}
            >
              仅保留有规格限
            </Button>
          </div>
        </div>

        <div className="max-h-[28rem] overflow-y-auto px-2 py-1">
          {filteredExport.length === 0 ? <p className="p-4 text-sm text-muted-foreground">无匹配测试项</p> : null}
          {filteredExport.map((m) => (
            <label key={m.name} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-muted">
              <input type="checkbox" checked={exportChecked.has(m.name)} onChange={() => setExportChecked((prev) => { const next = new Set(prev); if (next.has(m.name)) next.delete(m.name); else next.add(m.name); return next; })} className="size-3.5 shrink-0 accent-primary" />
              <span className="min-w-0 flex-1 break-words text-sm leading-snug">{shortName(m.name)}</span>
              {compareMode ? (
                <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[0.5625rem]', m.hasA && m.hasB ? 'border-status-success-foreground bg-status-success-surface text-status-success-foreground' : 'border-status-warning-foreground bg-status-warning-surface text-status-warning-foreground')}>
                  {m.hasA && m.hasB ? 'A·B' : !m.hasA ? 'B only' : 'A only'}
                </span>
              ) : null}
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs tabular-nums text-muted-foreground">
            {exporting && (exporting.kind === 'all' || exporting.kind === 'itemCheck') ? <span>导出中 {exporting.done}/{exporting.total} {exporting.kind === 'itemCheck' ? '(报告)' : '(ZIP)'}</span> : null}
            {!exporting ? <span className="hidden sm:inline">勾选 {exportChecked.size} 项 · 表头取文件名</span> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hasBothDatasets ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleExportImages('A')} disabled={exporting !== null || exportChecked.size === 0}>
                  {exporting?.kind === 'all' ? '打包中…' : '导出 A_图片'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleExportImages('B')} disabled={exporting !== null || exportChecked.size === 0}>
                  {exporting?.kind === 'all' ? '打包中…' : '导出 B_图片'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleExportReport('A')} disabled={exporting !== null || exportChecked.size === 0}>
                  {exporting?.kind === 'itemCheck' ? '生成中…' : '导出 A_报告'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleExportReport('B')} disabled={exporting !== null || exportChecked.size === 0}>
                  {exporting?.kind === 'itemCheck' ? '生成中…' : '导出 B_报告'}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleExportReport('merged')}
                  disabled={exporting !== null || exportChecked.size === 0}
                  title="按 Item_Check_For_Aquila1 格式生成 .numbers：A列Item，B/C列为数据A/B图表，表头为文件名"
                >
                  <Images data-icon="inline-start" />
                  {exporting?.kind === 'itemCheck' ? '报告生成中…' : '导出合并报告'}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleExportImages('all')} disabled={exporting !== null || exportChecked.size === 0}>
                  {exporting?.kind === 'all' ? 'ZIP 打包中…' : `导出图片 (${exportChecked.size})`}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleExportReport('merged')}
                  disabled={exporting !== null || exportChecked.size === 0}
                  title="按 Item_Check_For_Aquila1 格式生成 .numbers：A列Item，B列为图表，表头为文件名"
                >
                  <Images data-icon="inline-start" />
                  {exporting?.kind === 'itemCheck' ? '报告生成中…' : '导出报告 (.numbers)'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Export;

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChartBar, DownloadSimple, Images, MagnifyingGlass } from '@phosphor-icons/react';
import { useShallow } from 'zustand/react/shallow';
import useOppStore, { getActive, getCorrPair, getMerged, getSharedPair } from '../store/useOppStore';
import { shortName } from '../lib/stats';
import { exportChartPng, exportComparedByName, exportCorrelationPng } from '../lib/export';
import { buildItemCheckImages, exportItemCheckReport } from '../lib/itemCheckReport';
import { cn } from '../../../../lib/cn';
import type { ParsedDataset } from '../lib/csv';
type ExportState = { kind: 'single' } | { kind: 'all'; done: number; total: number } | { kind: 'itemCheck'; done: number; total: number } | null;

const Export: React.FC = () => {
  const navigate = useNavigate();
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
      if (activeA) await exportChartPng(activeA.analysis, activeA.index + 1, settings);
      if (compareMode && activeB) await exportChartPng(activeB.analysis, activeB.index + 1, settings);
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

  const handleExportChecked = async () => {
    if (exportChecked.size === 0) return;
    const names = Array.from(exportChecked);
    const sources: Array<{ dataset: ParsedDataset; prefix: string }> = [];
    if (datasetA) sources.push({ dataset: datasetA, prefix: 'A' });
    if (compareMode && datasetB) sources.push({ dataset: datasetB, prefix: 'B' });
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

  const handleExportItemCheck = async () => {
    if (exportChecked.size === 0) return;
    const names = merged.flatMap((m) => (exportChecked.has(m.name) ? [m.name] : []));
    if (names.length === 0) return;
    setExporting({ kind: 'itemCheck', done: 0, total: names.length });
    try {
      const { imagesA, imagesB } = await buildItemCheckImages(datasetA, datasetB, names, settings, (done) => setExporting({ kind: 'itemCheck', done, total: names.length }), chartType === 'cdf' || chartType === 'timeseries' ? chartType : 'histogram');
      await exportItemCheckReport({
        items: names,
        fileNameA: fileNameA || datasetA?.title || '数据 A',
        fileNameB: compareMode ? fileNameB || datasetB?.title || '数据 B' : undefined,
        imagesA,
        imagesB: compareMode ? imagesB : undefined,
      });
    } catch (err) {
      const detail = (err as unknown as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (err instanceof Error ? err.message : 'Item Check 报告导出失败'));
    } finally {
      setExporting(null);
    }
  };

  if (!datasetA && !datasetB) {
    return (
      <div className="flex h-64 flex-col items-center justify-center border border-dashed border-border p-8 text-center">
        <ChartBar className="mb-4 size-12 text-muted-foreground opacity-40" />
        <p className="font-mono text-sm text-muted-foreground">[ 请先在总览上传数据 ]</p>
        <button type="button" onClick={() => navigate('/tools/cpk-charts')} className="mt-4 border border-border px-3 py-1.5 font-mono text-xs text-foreground hover:border-foreground">
          返回总览
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/tools/cpk-charts')} className="border border-border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground hover:border-foreground hover:text-foreground">
          ← 总览
        </button>
        <span className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-foreground">导出与报告</span>
        <span className="font-mono text-[0.625rem] text-muted-foreground">共 {merged.length} 项</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-border bg-muted/40 px-4 py-3">
        <button type="button" onClick={handleExportCurrent} disabled={exporting !== null || (!activeA && !activeB)} className="flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-foreground hover:border-foreground disabled:opacity-40">
          <DownloadSimple className="size-3.5" />
          导出当前{selectedName ? ` · ${shortName(selectedName)}` : ''}
        </button>
        <button type="button" onClick={handleExportCorrelation} disabled={exporting !== null || !selectedName || !corrYName} className="flex items-center gap-1.5 border border-border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-foreground hover:border-foreground disabled:opacity-40">
          <DownloadSimple className="size-3.5" />
          导出相关性图{selectedName && corrYName ? ` · ${shortName(selectedName)} vs ${shortName(corrYName)}` : ''}
        </button>
        {exporting?.kind === 'single' && <span className="font-mono text-[0.625rem] text-muted-foreground">导出中…</span>}
      </div>

      <div className="flex flex-col gap-3 border border-border bg-background">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 border border-border px-3 py-1.5">
            <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
            <input type="text" value={exportQuery} onChange={(e) => setExportQuery(e.target.value)} aria-label="搜索测试项" placeholder="搜索测试项…" className="w-full bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">已勾选 {exportChecked.size}/{merged.length}</span>
            <button type="button" onClick={() => setExportChecked(new Set(merged.map((m) => m.name)))} className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
              全选
            </button>
            <button type="button" onClick={() => setExportChecked(new Set())} className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
              清空
            </button>
            <button
              type="button"
              onClick={() => setExportChecked(new Set(merged.flatMap((m) => (hasAnyLimit(m.name) ? [m.name] : []))))}
              className="border border-border px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-foreground hover:border-foreground"
            >
              仅保留有规格限
            </button>
          </div>
        </div>

        <div className="max-h-[28rem] overflow-y-auto px-2 py-1">
          {filteredExport.length === 0 && <p className="p-4 font-mono text-xs text-muted-foreground">[ 无匹配测试项 ]</p>}
          {filteredExport.map((m) => (
            <label key={m.name} className="flex w-full cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-left hover:bg-muted">
              <input type="checkbox" checked={exportChecked.has(m.name)} onChange={() => setExportChecked((prev) => { const next = new Set(prev); if (next.has(m.name)) next.delete(m.name); else next.add(m.name); return next; })} className="size-3.5 shrink-0 accent-primary" />
              <span className="min-w-0 flex-1 break-words font-mono text-[0.6875rem] leading-snug text-foreground">{shortName(m.name)}</span>
              {compareMode && (
                <span className={cn('shrink-0 border px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase tracking-[0.1em]', m.hasA && m.hasB ? 'border-status-success-foreground bg-status-success-surface text-status-success-foreground' : 'border-status-warning-foreground bg-status-warning-surface text-status-warning-foreground')}>
                  {m.hasA && m.hasB ? 'A·B' : !m.hasA ? 'B only' : 'A only'}
                </span>
              )}
            </label>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
            {exporting && (exporting.kind === 'all' || exporting.kind === 'itemCheck') && <span>导出中 {exporting.done}/{exporting.total} {exporting.kind === 'itemCheck' ? '(报告)' : '(ZIP)'}</span>}
            {!exporting && <span className="hidden sm:inline">勾选 {exportChecked.size} 项 · 表头取文件名</span>}
          </div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={handleExportChecked} disabled={exporting !== null || exportChecked.size === 0} className="border border-border bg-muted px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-foreground hover:border-foreground disabled:opacity-40">
              {exporting?.kind === 'all' ? 'ZIP 打包中…' : `导出 ZIP (${exportChecked.size})`}
            </button>
            <button
              type="button"
              onClick={handleExportItemCheck}
              disabled={exporting !== null || exportChecked.size === 0}
              title="按 Item_Check_For_Aquila1 格式生成 .numbers：A列Item，B/C列为数据A/B图表，表头为文件名"
              className="flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.14em] text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              <Images className="size-4" />
              {exporting?.kind === 'itemCheck' ? '报告生成中…' : '导出报告 (.numbers)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Export;

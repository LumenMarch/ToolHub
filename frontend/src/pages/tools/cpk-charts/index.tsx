// OPP 复刻主视图 — 单页布局：
// header(标题) → 文件选择(A/B) → 图表类型选择(Histogram/CDF/TimeSeries/Correlation + 单文件/对比)
// → 主体两栏：左上测试项列表 · 右上设置 · 右下图
import React, { useEffect, useRef } from 'react';
import { Database, DownloadSimple } from '@phosphor-icons/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { gsap } from 'gsap';
import { cn } from '../../../lib/cn';
import useOppStore from './store/useOppStore';
import LoadingOverlay from './components/LoadingOverlay';
import TestItemList from './components/TestItemList';
import ChartWorkspace, { type ChartView } from './components/ChartWorkspace';
import FileDropZone from '../../../components/FileDropZone';
import ExportPage from './pages/Export';

const CHART_TABS: Array<{ key: ChartView; label: string }> = [
  { key: 'histogram', label: 'Histogram' },
  { key: 'cdf', label: 'CDF' },
  { key: 'timeseries', label: 'TimeSeries' },
  { key: 'correlation', label: 'Correlation' },
];

const CpkChartsTool: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const chartType = useOppStore((s) => s.chartType);
  const setChartType = useOppStore((s) => s.setChartType);
  const compareMode = useOppStore((s) => s.compareMode);
  const setCompareMode = useOppStore((s) => s.setCompareMode);
  const datasetB = useOppStore((s) => s.datasetB);
  const datasetA = useOppStore((s) => s.datasetA);
  const fileA = useOppStore((s) => s.fileA);
  const fileB = useOppStore((s) => s.fileB);
  const loadFileA = useOppStore((s) => s.loadFileA);
  const loadFileB = useOppStore((s) => s.loadFileB);
  const clearFileA = useOppStore((s) => s.clearFileA);
  const clearFileB = useOppStore((s) => s.clearFileB);
  const loading = useOppStore((s) => s.loading);
  const progress = useOppStore((s) => s.progress);

  const hasB = datasetB !== null && datasetB.columns.length > 0;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.from('.gsap-reveal', { y: 16, opacity: 0, duration: 0.65, stagger: 0.08, ease: 'expo.out', delay: 0.12 });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  // /export 子路由：渲染导出页
  const isExportRoute = location.pathname.endsWith('/export');

  return isExportRoute ? (
    <div ref={containerRef} className="-mb-8 flex w-full min-w-0 flex-col min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <div className="relative z-10 flex flex-col gap-5">
        <header className="gsap-reveal flex items-center justify-between border-b border-border pb-3">
          <div className="min-w-0">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">[ OPP · 导出与报告 ]</span>
          </div>
          <button type="button" onClick={() => navigate('/tools/cpk-charts')} className="border border-border px-3 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-foreground hover:border-foreground">
            ← 返回
          </button>
        </header>
        <ExportPage />
      </div>
    </div>
  ) : (
    <div ref={containerRef} className="-mb-8 flex w-full min-w-0 flex-col min-[80rem]:-mx-44 min-[80rem]:w-auto">
      <div className="relative z-10 flex flex-col gap-5">
        {/* header */}
        <header className="gsap-reveal flex flex-col gap-4 border-b border-border pb-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-muted-foreground">[ TEST DATA / 测试数据对比 ]</span>
              <h1 className="mt-2 flex items-center gap-3 font-mono text-xl font-bold tracking-tight break-all text-foreground sm:text-2xl">
                <Database className="size-5 shrink-0 text-muted-foreground" />
                <span>{datasetA?.title || 'OPP — 未加载数据文件'}</span>
              </h1>
              <p className="mt-1 font-mono text-[0.625rem] text-muted-foreground">OPP.app v2.2.9 · Web 复刻</p>
            </div>
            <button type="button" onClick={() => navigate('/tools/cpk-charts/export')} className="flex items-center gap-1.5 border border-primary bg-primary px-3 py-1.5 font-mono text-[0.625rem] font-bold uppercase tracking-[0.14em] text-primary-foreground hover:opacity-90">
              <DownloadSimple className="size-4" />
              导出
            </button>
          </div>
        </header>

        {/* 文件选择 */}
        <div className="gsap-reveal flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="mb-2 font-mono text-[0.625rem] text-muted-foreground">{datasetA ? `${datasetA.records} 条 / ${datasetA.columns.length} 项` : '上传产线导出 CSV'}</p>
            <FileDropZone
              id="cpk-csv-a"
              label="上传数据 CSV"
              description="产线导出 / 通用 CSV"
              accept=".csv,text/csv"
              file={fileA}
              onSelect={(f) => void loadFileA(f)}
              onClear={() => clearFileA()}
              fileNameClassName="text-sm font-semibold md:text-base"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="mb-2 font-mono text-[0.625rem] text-muted-foreground">{datasetB ? `${datasetB.records} 条 / ${datasetB.columns.length} 项` : '可选，用于对比'}</p>
            <FileDropZone
              id="cpk-csv-b"
              label="上传数据 CSV"
              description="对比用（可选）"
              accept=".csv,text/csv"
              file={fileB}
              onSelect={(f) => void loadFileB(f)}
              onClear={() => clearFileB()}
              fileNameClassName="text-sm font-semibold md:text-base"
            />
          </div>
        </div>

        {/* 图表类型选择 + 单文件/对比 */}
        <div className="gsap-reveal flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1">
            {CHART_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setChartType(t.key)}
                className={cn(
                  'px-3 py-1.5 font-mono text-[0.625rem] font-bold uppercase tracking-[0.14em]',
                  chartType === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {hasB && (
            <div className="flex items-center gap-1 border border-border p-1 font-mono text-[0.625rem] uppercase tracking-[0.14em]">
              <button type="button" onClick={() => setCompareMode(false)} className={cn('px-3 py-1', !compareMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                单文件
              </button>
              <button type="button" onClick={() => setCompareMode(true)} className={cn('px-3 py-1', compareMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                对比
              </button>
            </div>
          )}
        </div>

        {/* 主体：左上列表 · 右侧设置+图 */}
        <div className="gsap-reveal grid min-h-0 items-stretch gap-5 lg:grid-cols-[minmax(15rem,18rem)_1fr]">
          <div className="relative min-h-0 overflow-hidden border border-border bg-background">
            <div className="absolute inset-0 p-3">
              <TestItemList />
            </div>
          </div>
          <div className="min-w-0">
            <ChartWorkspace view={chartType} />
          </div>
        </div>


      </div>

      <LoadingOverlay loading={loading} progress={progress} />
    </div>
  );
};

export default CpkChartsTool;

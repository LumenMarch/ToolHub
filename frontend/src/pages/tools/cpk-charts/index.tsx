// OPP 复刻主视图 —
// 文件选择(A/B) → 图表类型选择(Histogram/CDF/TimeSeries/Correlation + 单文件/对比)
// → 主体两栏：左上测试项列表 · 右上导出+设置 · 右下图
import React from 'react';
import { Database } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  const error = useOppStore((s) => s.error);
  const clearError = useOppStore((s) => s.setError);

  const hasB = datasetB !== null && datasetB.columns.length > 0;

  // /export 子路由：渲染导出页
  const isExportRoute = location.pathname.endsWith('/export');

  return isExportRoute ? (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">导出与报告</p>
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/tools/cpk-charts')}>
          返回
        </Button>
      </div>
      <ExportPage />
    </div>
  ) : (
    <div className="flex w-full min-w-0 flex-col gap-5">
      {error ? (
        <Alert variant="destructive" className="border-status-danger/50 bg-status-danger/10 text-status-danger-foreground">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span className="min-w-0">{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => clearError('')}
              aria-label="关闭错误提示"
            >
              关闭
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {datasetA ? (
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Database className="size-4 shrink-0" />
          <span className="truncate">{datasetA.title}</span>
          <span className="shrink-0 tabular-nums">
            {datasetA.records} 条 / {datasetA.columns.length} 项
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="mb-2 text-xs text-muted-foreground">
            {datasetA ? `${datasetA.records} 条 / ${datasetA.columns.length} 项` : '上传产线导出 CSV'}
          </p>
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
          <p className="mb-2 text-xs text-muted-foreground">
            {datasetB ? `${datasetB.records} 条 / ${datasetB.columns.length} 项` : '可选，用于对比'}
          </p>
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-2">
        <div className="flex flex-wrap items-center gap-1">
          {CHART_TABS.map((t) => (
            <Button
              key={t.key}
              type="button"
              size="sm"
              variant={chartType === t.key ? 'default' : 'ghost'}
              onClick={() => setChartType(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {hasB ? (
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <Button
              type="button"
              size="sm"
              variant={!compareMode ? 'default' : 'ghost'}
              onClick={() => setCompareMode(false)}
            >
              单文件
            </Button>
            <Button
              type="button"
              size="sm"
              variant={compareMode ? 'default' : 'ghost'}
              onClick={() => setCompareMode(true)}
            >
              对比
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 items-stretch gap-5 lg:grid-cols-[minmax(15rem,18rem)_1fr]">
        <div className="relative min-h-0 overflow-hidden rounded-xl border bg-card">
          <div className="absolute inset-0 p-3">
            <TestItemList />
          </div>
        </div>
        <div className="min-w-0">
          <ChartWorkspace view={chartType} />
        </div>
      </div>

      <LoadingOverlay loading={loading} progress={progress} />
    </div>
  );
};

export default CpkChartsTool;

// 图表工作区（右侧）— 上：导出按钮行（导出全部 / 导出当前）+ 设置行（按图类型）· 下：图区（单图或 A/B 并排对比）+ CPK 统计
// 支持 Histogram / CDF / TimeSeries / Correlation 四类，对齐 OPP 各设置面板
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import useOppStore, { getActive, getCorrPair, getSharedPair } from '../store/useOppStore';
import CpkHistogram from './CpkHistogram';
import CdfChart from './CdfChart';
import TimeSeriesChart from './TimeSeriesChart';
import CorrelationChart from './CorrelationChart';
import type { CorrelationPair } from './CorrelationChart';
import CorrelationSettings from './CorrelationSettings';
import ItemSettingsPanel from '../pages/ItemSettingsPanel';
import { pearsonCorrelation, formatIndex, formatValue, shortName, type ColumnAnalysis } from '../lib/stats';
import {
  downloadBlob,
  renderCdfSvg,
  renderCorrelationSvg,
  renderHistogramSvg,
  renderTimeSeriesSvg,
  sanitizeFilename,
  svgToPng,
} from '../lib/export';

export type ChartView = 'histogram' | 'cdf' | 'timeseries' | 'correlation';

/** 配对统计（模块级纯函数）：从 pair 的原始行配对 X/Y 并计算 Pearson 回归统计。 */
function corrStatsOf(pair: CorrelationPair | null): { r: number | null; slope: number; intercept: number; meanX: number; meanY: number; stdX: number; stdY: number; n: number } | null {
  if (!pair) return null;
  const n0 = Math.min(pair.rawX.length, pair.rawY.length);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n0; i += 1) {
    // 空白单元格按缺失处理：Number('') === 0 会伪造有效样本
    if (pair.rawX[i].trim() === '' || pair.rawY[i].trim() === '') continue;
    const x = Number(pair.rawX[i]);
    const y = Number(pair.rawY[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  const { r, slope, intercept } = pearsonCorrelation(xs, ys);
  const meanX = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const meanY = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
  const stdX = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - meanX) * (b - meanX), 0) / (xs.length - 1)) : 0;
  const stdY = ys.length > 1 ? Math.sqrt(ys.reduce((a, b) => a + (b - meanY) * (b - meanY), 0) / (ys.length - 1)) : 0;
  return { r, slope, intercept, meanX, meanY, stdX, stdY, n: xs.length };
}

function singleStatsCards(st: NonNullable<ReturnType<typeof corrStatsOf>>): Array<{ label: string; value: string }> {
  return [
    { label: 'r', value: st.r !== null ? st.r.toFixed(4) : '—' },
    { label: 'slope', value: st.slope.toFixed(4) },
    { label: 'intercept', value: st.intercept.toFixed(4) },
    { label: 'n', value: String(st.n) },
  ];
}

const STAT_ROWS = ['Cpk', 'Cpu', 'Cpl', 'Mean', 'Std. Dev.', 'Data Count', 'Failure Count'] as const;

interface ChartWorkspaceProps {
  view: ChartView;
}

const ChartWorkspace: React.FC<ChartWorkspaceProps> = ({ view }) => {
  const navigate = useNavigate();
  const datasetA = useOppStore((s) => s.datasetA);
  const datasetB = useOppStore((s) => s.datasetB);
  const selectedName = useOppStore((s) => s.selectedName);
  const setSelectedName = useOppStore((s) => s.setSelectedName);
  const corrYName = useOppStore((s) => s.corrYName);
  const setCorrYName = useOppStore((s) => s.setCorrYName);
  const compareMode = useOppStore((s) => s.compareMode);
  const settings = useOppStore((s) => s.settings);
  const updateSetting = useOppStore((s) => s.updateSetting);
  const setError = useOppStore((s) => s.setError);

  const [zoom, setZoom] = useState<'A' | 'B' | null>(null);

  // ---- Correlation 数据处理 ----
  const pairA = useMemo(() => (view === 'correlation' ? getCorrPair(datasetA, selectedName, corrYName, settings) : null), [datasetA, selectedName, corrYName, settings, view]);
  const pairB = useMemo(() => (view === 'correlation' ? getCorrPair(datasetB, selectedName, corrYName, settings) : null), [datasetB, selectedName, corrYName, settings, view]);
  const statA = pairA ? corrStatsOf(pairA) : null;
  const statB = pairB ? corrStatsOf(pairB) : null;

  // ---- Histogram / CDF / TimeSeries 数据处理 ----
  // 对比配对：派生自原始字段（zustand v5 selector 必须返回稳定引用，用 useMemo 缓存）
  const shared = useMemo(
    () => getSharedPair({ datasetA, datasetB, selectedName, compareMode, settings } as never),
    [datasetA, datasetB, selectedName, compareMode, settings],
  );
  const activeA = useMemo(() => {
    if (shared) return { index: shared.idxA, analysis: shared.pair.a };
    return getActive(datasetA, selectedName, settings);
  }, [shared, datasetA, selectedName, settings]);
  const activeB = useMemo(() => {
    if (shared) return { index: shared.idxB, analysis: shared.pair.b };
    return getActive(datasetB, selectedName, settings);
  }, [shared, datasetB, selectedName, settings]);
  const activeCol = activeA?.analysis ?? activeB?.analysis ?? null;

  const isCorr = view === 'correlation';
  // 两个数据源都存在（无论是否处于对比视图）：导出当前即导出 A/B 两张
  const hasBothDatasets = Boolean(datasetA && datasetB);

  /** 当前视图是否可导出（有配对 / 有激活测试项数据）。 */
  const canExportCurrent = isCorr ? Boolean(pairA ?? pairB) : Boolean(activeCol);

  /** 导出当前可见图：单图存一张，双数据源存 A/B 两张。 */
  const handleExportCurrent = async (): Promise<void> => {
    try {
      if (isCorr) {
        // 双数据源导出 A/B 两张；否则导出唯一可见的散点图
        const targets: Array<{ pair: CorrelationPair | null; prefix: string }> = hasBothDatasets
          ? [
              { pair: pairA, prefix: 'A_' },
              { pair: pairB, prefix: 'B_' },
            ]
          : [{ pair: pairA ?? pairB, prefix: '' }];
        await Promise.all(
          targets
            .filter((t): t is { pair: CorrelationPair; prefix: string } => t.pair !== null)
            .map(({ pair, prefix }) => svgToPng(renderCorrelationSvg(pair, settings)).then((png) => downloadBlob(png, `${prefix}${sanitizeFilename(pair.xName)}_vs_${sanitizeFilename(pair.yName)}.png`))),
        );
        return;
      }
      if (!activeCol) return;
      const renderOne = (analysis: ColumnAnalysis): Promise<void> => {
        const svg = view === 'cdf' ? renderCdfSvg(analysis, settings) : view === 'timeseries' ? renderTimeSeriesSvg(analysis, settings) : renderHistogramSvg(analysis, settings);
        return svgToPng(svg).then((png) => downloadBlob(png, `${sanitizeFilename(analysis.column.name)}.png`));
      };
      if (hasBothDatasets) {
        const a = activeA?.analysis ?? null;
        const b = activeB?.analysis ?? null;
        // 显式展开避免循环内 await；文件名加 A_/B_ 前缀区分来源
        await Promise.all([
          ...(a ? [svgToPng(view === 'cdf' ? renderCdfSvg(a, settings) : view === 'timeseries' ? renderTimeSeriesSvg(a, settings) : renderHistogramSvg(a, settings)).then((png) => downloadBlob(png, `A_${sanitizeFilename(a.column.name)}.png`))] : []),
          ...(b ? [svgToPng(view === 'cdf' ? renderCdfSvg(b, settings) : view === 'timeseries' ? renderTimeSeriesSvg(b, settings) : renderHistogramSvg(b, settings)).then((png) => downloadBlob(png, `B_${sanitizeFilename(b.column.name)}.png`))] : []),
        ]);
      } else {
        await renderOne(activeCol);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '当前图表导出失败');
    }
  };

  const renderChart = (analysis: ColumnAnalysis | null) => {
    if (!analysis) return <div className="flex h-40 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">无此测试项</div>;
    if (view === 'cdf') return <CdfChart analysis={analysis} settings={settings} />;
    if (view === 'timeseries') return <TimeSeriesChart analysis={analysis} settings={settings} />;
    return <CpkHistogram analysis={analysis} settings={settings} />;
  };

  const renderCorrPanel = (pair: CorrelationPair | null, st: ReturnType<typeof corrStatsOf>, label: string, keyPrefix: string) => (
    <div className="relative rounded-xl border bg-card p-2 sm:p-3">
      <span className={cn('absolute -top-2.5 left-3 z-10 rounded-md border bg-background px-2 py-0.5 text-[0.625rem] font-medium', label === '数据 A' ? 'border-primary/40 text-primary' : 'border-status-warning-foreground/40 text-status-warning-foreground')}>
        {label}
      </span>
      {pair ? <CorrelationChart pair={pair} settings={settings} /> : <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{label} 无配对数据</div>}
      {settings.showStats && st && (
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
          {singleStatsCards(st).map((m) => (
            <div key={keyPrefix + m.label} className="bg-background p-2">
              <p className="text-[0.625rem] text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-xs tabular-nums">{m.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* 上：导出按钮行 + 设置行 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate('/tools/cpk-charts/export')}>
            <Download data-icon="inline-start" />
            导出全部
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canExportCurrent}
            onClick={() => void handleExportCurrent()}
          >
            <Download data-icon="inline-start" />
            导出当前
          </Button>
        </div>
        {isCorr ? (
          <CorrelationSettings
            settings={settings}
            onUpdate={updateSetting}
            selectedName={selectedName}
            onSelectedName={setSelectedName}
            corrYName={corrYName}
            onCorrYName={setCorrYName}
          />
        ) : (
          <ItemSettingsPanel view={view} settings={settings} onUpdate={updateSetting} activeCol={activeCol} />
        )}
      </div>

      {/* 下：图区 */}
      {isCorr ? (
        !pairA && !pairB ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">请选择 X 与 Y 测试项以绘制相关性散点</div>
        ) : compareMode && datasetA && datasetB ? (
          <div className="flex flex-col gap-5">
            {renderCorrPanel(pairA, statA, '数据 A', 'A')}
            {renderCorrPanel(pairB, statB, '数据 B', 'B')}
          </div>
        ) : (
          renderCorrPanel(pairA ?? pairB, statA ?? statB, pairA ? '数据 A' : '数据 B', 'S')
        )
      ) : !datasetA && !datasetB ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">请先上传数据</p>
        </div>
      ) : !selectedName ? (
        <p className="text-sm text-muted-foreground">未选择测试项</p>
      ) : !activeCol ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">该测试项无数据: {shortName(selectedName)}</p>
        </div>
      ) : compareMode && datasetA && datasetB ? (
        <div className="flex flex-col gap-5">
          <div className="relative">
            <span className="absolute -top-2.5 left-3 z-10 rounded-md border border-primary/40 bg-background px-2 py-0.5 text-[0.625rem] font-medium text-primary">数据 A</span>
            <div className="relative rounded-xl border bg-card p-2 sm:p-3">
              {renderChart(activeA?.analysis ?? null)}
              {activeA ? (
                <Button type="button" variant="outline" size="xs" onClick={() => setZoom('A')} className="absolute top-2 right-2">
                  <Maximize2 data-icon="inline-start" />放大
                </Button>
              ) : null}
            </div>
          </div>
          <div className="relative">
            <span className="absolute -top-2.5 left-3 z-10 rounded-md border border-status-warning-foreground/40 bg-background px-2 py-0.5 text-[0.625rem] font-medium text-status-warning-foreground">数据 B</span>
            <div className="relative rounded-xl border bg-card p-2 sm:p-3">
              {renderChart(activeB?.analysis ?? null)}
              {activeB ? (
                <Button type="button" variant="outline" size="xs" onClick={() => setZoom('B')} className="absolute top-2 right-2">
                  <Maximize2 data-icon="inline-start" />放大
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-2 sm:p-3">{renderChart(activeCol)}</div>
      )}

      {/* CPK 统计网格（histogram/cdf/timeseries 单测试项时显示） */}
      {!isCorr && activeCol && !(compareMode && datasetA && datasetB) && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
          {[
            { label: 'Data Count', value: String(activeCol.stat.count) },
            { label: 'NA Count', value: String(activeCol.stat.naCount) },
            { label: 'Failure Count', value: `${activeCol.stat.failureCount} (${activeCol.stat.failureRate.toFixed(2)}%)` },
            { label: 'Cpk', value: formatIndex(activeCol.stat.cpk) },
            { label: 'Mean', value: formatValue(activeCol.stat.mean) },
            { label: 'Std. Dev.', value: formatValue(activeCol.stat.stdDev) },
            { label: 'Cpu', value: formatIndex(activeCol.stat.cpu) },
            { label: 'Cpl', value: formatIndex(activeCol.stat.cpl) },
          ].map((mm) => (
            <div key={mm.label} className="bg-background p-3">
              <p className="text-[0.625rem] text-muted-foreground">{mm.label}</p>
              <p className="mt-1 text-sm font-medium tabular-nums">{mm.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* 对比模式：指标对比表 */}
      {!isCorr && compareMode && activeA && activeB && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-[0.625rem] text-muted-foreground">指标</th>
                <th className="px-3 py-2 text-right text-[0.625rem] text-muted-foreground">数据 A</th>
                <th className="px-3 py-2 text-right text-[0.625rem] text-muted-foreground">数据 B</th>
              </tr>
            </thead>
            <tbody>
              {STAT_ROWS.map((k) => {
                const pick = (a: NonNullable<typeof activeA>) =>
                  k === 'Cpk'
                    ? formatIndex(a.analysis.stat.cpk)
                    : k === 'Cpu'
                      ? formatIndex(a.analysis.stat.cpu)
                      : k === 'Cpl'
                        ? formatIndex(a.analysis.stat.cpl)
                        : k === 'Mean'
                          ? formatValue(a.analysis.stat.mean)
                          : k === 'Std. Dev.'
                            ? formatValue(a.analysis.stat.stdDev)
                            : k === 'Data Count'
                              ? String(a.analysis.stat.count)
                              : `${a.analysis.stat.failureCount} (${a.analysis.stat.failureRate.toFixed(2)}%)`;
                return (
                  <tr key={k} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-1.5 text-muted-foreground">{k}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{pick(activeA)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{pick(activeB)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={Boolean(zoom)} onOpenChange={(open) => { if (!open) setZoom(null); }}>
        <DialogContent className="max-h-[92vh] w-full max-w-5xl overflow-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>数据集 {zoom} · 放大视图</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto">
            {zoom === 'A' && activeA ? renderChart(activeA.analysis) : zoom === 'B' && activeB ? renderChart(activeB.analysis) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChartWorkspace;

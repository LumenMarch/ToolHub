// Time Series 时序图 — 对齐 OPP（CorePlot 折线+点）：X=样本序号，Y=测量值；叠加 LSL/USL 红线与均值虚线
// 选项（对齐 OPP theTimeSeriesPlotSymbol / displayLines / theLineWidth）：
//   Data Ticks：None/O/+/x（0/1/2/3）；Show Lines 复选框；线宽 segmented 0→0 / 1→0.5 / 2→1.0 / 3→2.0
import React, { useMemo } from 'react';
import { formatTick, type ChartSettings, type ColumnAnalysis } from '../lib/stats';
import { H, PLOT_BOTTOM, PLOT_H, PLOT_LEFT, PLOT_RIGHT, PLOT_TOP, SPEC_COLOR, W, minorTicks, pow10Interval, ticksFor } from '../lib/layout';
import PlotLegend from './PlotLegend';
import StatsLabels from './StatsLabels';

const mapRange = (v: number, lo: number, hi: number, pl: number, ph: number): number => pl + ((v - lo) / (hi - lo)) * (ph - pl);

function yRangeOf(a: ColumnAnalysis | null): [number, number] {
  if (!a || a.values.length === 0) return [0, 1];
  let lo = Math.min(...a.values);
  let hi = Math.max(...a.values);
  if (a.column.lower !== null) lo = Math.min(lo, a.column.lower);
  if (a.column.upper !== null) hi = Math.max(hi, a.column.upper);
  let m = hi - lo;
  if (!(m > 0)) m = 1;
  return [lo - m * 0.08, hi + m * 0.08];
}

/** 线宽映射（对齐 OPP updateLineWidth: 的 NSSegmentedControl：0/0.5/1/2）。 */
function strokeOf(lineWidth: ChartSettings['lineWidth']): number {
  return lineWidth === 'none' ? 0 : lineWidth === 'thin' ? 0.5 : lineWidth === 'med' ? 1 : 2;
}

interface TimeSeriesChartProps {
  analysis: ColumnAnalysis | null;
  settings: ChartSettings;
  secondary?: ColumnAnalysis | null;
  secondaryStroke?: string;
  stroke?: string;
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ analysis, settings, secondary, secondaryStroke, stroke }) => {
  const n = analysis?.values.length ?? 0;
  const xLo = 0;
  const xHi = Math.max(1, n - 1);
  const xTicks = useMemo(() => ticksFor(xLo, xHi), [xHi]);
  const [yLo, yHi] = useMemo(() => yRangeOf(analysis ?? null), [analysis]);
  const yStep = useMemo(() => pow10Interval(yHi - yLo, 10), [yLo, yHi]);
  // OPP：YMin 向下取整到 interval 整数倍；上限 = YMin + ceil(跨度/interval)*interval
  const [yTickLo, yTickHi] = useMemo(() => {
    if (!(yStep > 0)) return [0, 1];
    const lo = Math.floor(yLo / yStep) * yStep;
    const hi = lo + Math.ceil((yHi - lo) / yStep) * yStep;
    return [lo, hi];
  }, [yLo, yHi, yStep]);
  const yTicks = useMemo(() => {
    const out: number[] = [];
    for (let v = yTickLo; v <= yTickHi + yStep / 2; v += yStep) out.push(v);
    return out;
  }, [yTickLo, yTickHi, yStep]);
  const yMinor = useMemo(() => minorTicks(yTickLo, yTickHi, yStep, 3), [yTickLo, yTickHi, yStep]);
  const lineOf = useMemo(() => {
    const mk = (a: ColumnAnalysis | null) => (a ? a.values.map((v, i) => `${Math.round(mapRange(i, xLo, xHi, PLOT_LEFT, PLOT_RIGHT) * 100) / 100},${Math.round(mapRange(v, yLo, yHi, PLOT_BOTTOM, PLOT_TOP) * 100) / 100}`).join(' ') : '');
    return { main: mk(analysis), sec: mk(secondary ?? null) };
  }, [analysis, secondary, xHi, yLo, yHi]);
  const mean = useMemo(() => (analysis && analysis.values.length > 0 ? analysis.values.reduce((s, v) => s + v, 0) / analysis.values.length : NaN), [analysis]);
  const unitSuffix = analysis?.column.unit ? ` (${analysis.column.unit})` : '';
  // OPP：绘图符号尺寸固定 10pt；按数据符号类型渲染
  const symbol = settings.dataSymbol;
  const lineWidth = strokeOf(settings.lineWidth);
  const symbolEl = (cx: number, cy: number, color: string, r: number) => {
    if (symbol === 'circle') return (<circle key={cx + '-' + cy} cx={cx} cy={cy} r={r} fill={color} />);
    if (symbol === 'plus') {
      return (<g key={cx + '-' + cy} stroke={color} strokeWidth={1}><line x1={cx - r} x2={cx + r} y1={cy} y2={cy} /><line x1={cx} x2={cx} y1={cy - r} y2={cy + r} /></g>);
    }
    if (symbol === 'cross') {
      const d = r * 0.7;
      return (<g key={cx + '-' + cy} stroke={color} strokeWidth={1}><line x1={cx - d} x2={cx + d} y1={cy - d} y2={cy + d} /><line x1={cx - d} x2={cx + d} y1={cy + d} y2={cy - d} /></g>);
    }
    return null;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="font-sans text-foreground" role="img" aria-label="Time Series 时序图" preserveAspectRatio="xMidYMid meet">
      {settings.showTitle && analysis && (<text x={W / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">{analysis.column.name}{unitSuffix}</text>)}
      {settings.showStats && analysis && (<StatsLabels stat={analysis.stat} />)}
      {yTicks.map((t) => { const y = Math.round(mapRange(t, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)); return (<g key={t}><line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} /><text x={PLOT_LEFT - 12} y={y + 3.5} textAnchor="end" fontSize={9} fontWeight={500} fill="currentColor">{formatTick(t)}</text></g>); })}
      {yMinor.map((v) => { const y = Math.round(mapRange(v, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)); return (<line key={"ym-" + v} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />); })}
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_TOP} y2={PLOT_TOP} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
      {settings.tsMean && analysis && analysis.values.length > 0 && !Number.isNaN(mean) && (<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={mapRange(mean, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)} y2={mapRange(mean, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} strokeDasharray="5 4" />)}
      {analysis && settings.showLimits && analysis.column.upper !== null && (<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={mapRange(analysis.column.upper!, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)} y2={mapRange(analysis.column.upper!, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)} stroke={SPEC_COLOR} strokeWidth={2} />)}
      {analysis && settings.showLimits && analysis.column.lower !== null && (<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={mapRange(analysis.column.lower!, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)} y2={mapRange(analysis.column.lower!, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)} stroke={SPEC_COLOR} strokeWidth={2} />)}
      {settings.tsLines !== false && lineOf.sec && secondary && (<polyline points={lineOf.sec} fill="none" stroke={secondaryStroke || SPEC_COLOR} strokeWidth={Math.max(0.5, lineWidth * 1.75)} opacity={0.9} />)}
      {settings.tsLines !== false && lineOf.main && analysis && lineWidth > 0 && (<polyline points={lineOf.main} fill="none" stroke={stroke || '#2563eb'} strokeWidth={lineWidth} />)}
      {/* Data Ticks（None/O/+/x），对齐 OPP theTimeSeriesPlotSymbol */}
      {settings.dataSymbol !== 'none' && analysis && analysis.values.map((v, i) => { const cx = mapRange(i, xLo, xHi, PLOT_LEFT, PLOT_RIGHT); const cy = mapRange(v, yLo, yHi, PLOT_BOTTOM, PLOT_TOP); return symbolEl(cx, cy, stroke || '#2563eb', 2.6); })}
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="currentColor" strokeWidth={1.75} />
      {xTicks.map((t) => (<g key={t}><line x1={mapRange(t, xLo, xHi, PLOT_LEFT, PLOT_RIGHT)} x2={mapRange(t, xLo, xHi, PLOT_LEFT, PLOT_RIGHT)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} stroke="currentColor" strokeWidth={1} /><text x={mapRange(t, xLo, xHi, PLOT_LEFT, PLOT_RIGHT)} y={PLOT_BOTTOM + 16} textAnchor="middle" fontSize={9} fontWeight={500} fill="currentColor">{Math.round(t)}</text></g>))}
      {analysis?.column.unit && (<text x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={PLOT_BOTTOM + 32} textAnchor="middle" fontSize={9.5} fontWeight={500} fill="currentColor">{analysis.column.unit}</text>)}
      <text x={PLOT_LEFT - 32} y={PLOT_TOP + PLOT_H / 2} textAnchor="middle" fontSize={8} fontWeight={600} fill="currentColor" transform={`rotate(-90 ${PLOT_LEFT - 32} ${PLOT_TOP + PLOT_H / 2})`}>Value</text>
      {settings.legendEnabled && analysis && (
        <PlotLegend
          entries={[
            { label: analysis.column.name, color: stroke || '#2563eb', count: analysis.stat.count },
            ...(secondary ? [{ label: secondary.column.name, color: secondaryStroke || SPEC_COLOR, count: secondary.stat.count }] : []),
          ]}
          position={settings.legendPosition}
          showCounts={settings.legendCounts}
        />
      )}
    </svg>
  );
};

export default TimeSeriesChart;

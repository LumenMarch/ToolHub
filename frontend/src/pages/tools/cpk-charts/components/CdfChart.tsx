// CDF 累积分布图 — 对齐 OPP generateCDF（CorePlot 折线）
// X=测量值（线性刻度），Y=累积概率（0~1，显示 0~100%）
// 类型：CDF / CCDF（反向累积）/ Folded（以 n/2 折叠：前段正向、后段反向镜像）
// 选项（对齐 OPP cdfIsLog / cdfShowHundredths / displayCDFFill）：
//   cdfLog 影响 Y 轴（log scale，range location=0.0001|0.001、length=1.0）
import React from 'react';
import { formatTick, type ChartSettings, type ColumnAnalysis } from '../lib/stats';
import { H, PLOT_BOTTOM, PLOT_H, PLOT_LEFT, PLOT_RIGHT, PLOT_TOP, SPEC_COLOR, W, cptNiceNum, mapX, minorTicks, ticksFor, yTicksFor } from '../lib/layout';
import PlotLegend from './PlotLegend';
import StatsLabels from './StatsLabels';

// 对齐 OPP generateCDF：Y 轴 Automatic policy、preferredNumberOfMajorTicks=8
// → interval = CPTNiceNum(span/7)；span=1.0（0~1 累积概率）→ 0.1 → 显示 10%
const CDF_Y_INTERVAL = cptNiceNum(1 / 7);

/** 累积占比序列（0~1），对齐 OPP generateCDF:withReturnData: cdfData[j]=j/n。 */
function cdfSeq(values: number[]): Array<{ x: number; y: number }> {
  if (values.length === 0) return [];
  const sorted = values.toSorted((a, b) => a - b);
  const n = sorted.length;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += 1) out.push({ x: sorted[i], y: n === 1 ? 1 : i / (n - 1) });
  return out;
}

/** 按 cdfType 转换（对齐 OPP numbersForPlot）：0=CDF 正向、1=CCDF 反向、2=Folded 折叠。 */
function cdfPointsOf(values: number[], type: 'cdf' | 'ccdf' | 'folded'): Array<{ x: number; y: number }> {
  const base = cdfSeq(values);
  // CCDF：互补概率 1-p，保持 X 升序，曲线单调下降
  if (type === 'ccdf') return base.map(({ x, y }) => ({ x, y: Math.max(0, 1 - y) }));
  if (type === 'folded') {
    const n = base.length;
    if (n <= 1) return base;
    const half = Math.floor(n / 2);
    const front = base.slice(0, half);
    const back = base.slice(0, half).toReversed();
    return [...front, ...back];
  }
  return base;
}

function yPxProb(p: number): number {
  return Math.round((PLOT_BOTTOM - p * PLOT_H) * 100) / 100;
}

/** log Y 轴主刻度：每 decade 一个（CorePlot log 轴近似），从 Y range location 起。 */
function logYTicks(loc: number): number[] {
  const out: number[] = [];
  for (let p = loc; p <= 1.0001; p *= 10) out.push(p);
  return out;
}

/** log Y 像素映射：y = log10(p) 线性到 [log10(loc), log10(1)]；p 低于 loc 时夹取到 loc，避免 log10(0) 发散。 */
function yPxLog(p: number, loc: number): number {
  const clamped = Math.max(p, loc);
  const lo = Math.log10(loc);
  const hi = Math.log10(1);
  const t = (Math.log10(clamped) - lo) / (hi - lo);
  return Math.round((PLOT_BOTTOM - t * PLOT_H) * 100) / 100;
}

/** 百分比标签（对齐 OPP NSNumberFormatterPercentStyle）：数值×100 加 %；hundredths 时 1 位小数。 */
function pctLabel(p: number, hundredths: boolean): string {
  const v = p * 100;
  return v.toFixed(hundredths ? 1 : 0) + '%';
}

interface CdfChartProps {
  analysis: ColumnAnalysis | null;
  settings: ChartSettings;
  secondary?: ColumnAnalysis | null;
  secondaryStroke?: string;
  stroke?: string;
}

const CdfChart: React.FC<CdfChartProps> = ({ analysis, settings, secondary, secondaryStroke, stroke }) => {
  const [dlo, dhi] = analysis?.domain ?? [-1, 1];
  const xTicks = ticksFor(dlo, dhi);
  const xMajor = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : dhi - dlo;
  const xMinor = minorTicks(dlo, dhi, xMajor, 4);
  const logMode = settings.cdfLog;
  const yLogLoc = settings.cdfShowHundredths ? 0.001 : 0.0001;
  const yTicks = logMode ? logYTicks(yLogLoc) : yTicksFor(1, CDF_Y_INTERVAL);
  const yMinor = logMode ? [] : minorTicks(0, 1, CDF_Y_INTERVAL, 1);
  const yOf = (p: number): number => (logMode ? yPxLog(p, yLogLoc) : yPxProb(p));
  const yLabel = (p: number): string => pctLabel(p, settings.cdfShowHundredths);

  // 主/次数据点串（轻量计算，每渲染直接执行）
  const mainPts = analysis ? cdfPointsOf(analysis.values, settings.cdfType) : [];
  const secPts = secondary ? cdfPointsOf(secondary.values, settings.cdfType) : [];
  const mainC = mainPts.map((p) => `${mapX(dlo, dhi, p.x)},${yOf(p.y)}`);
  const secC = secPts.map((p) => `${mapX(dlo, dhi, p.x)},${yOf(p.y)}`);
  const mainClosed = mainC.length > 0 ? `${mainC[0]} L ${mainC.join(' L ')} L ${mainC[mainC.length - 1].split(',')[0]},${PLOT_BOTTOM} L ${mainC[0].split(',')[0]},${PLOT_BOTTOM} Z` : '';
  const unitSuffix = analysis?.column.unit ? ` (${analysis.column.unit})` : '';
  const limX = (v: number): number => mapX(dlo, dhi, v);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="font-sans text-foreground" role="img" aria-label="CDF 累积分布图" preserveAspectRatio="xMidYMid meet">
      {settings.showTitle && analysis && (<text x={W / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">{analysis.column.name}{unitSuffix}</text>)}
      {settings.showStats && analysis && (<StatsLabels stat={analysis.stat} />)}
      {yTicks.map((t) => { const y = yOf(t); return (<g key={t}><line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={t === 0 ? 0.9 : 0.45} strokeWidth={1} /><text x={PLOT_LEFT - 12} y={y + 3.5} textAnchor="end" fontSize={9} fontWeight={500} fill="currentColor">{yLabel(t)}</text></g>); })}
      {yMinor.map((v) => { const y = yOf(v); return (<line key={'ym-' + v} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />); })}
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_TOP} y2={PLOT_TOP} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
      {settings.cdfFill && mainClosed && (<path d={mainClosed} fill={stroke || '#2563eb'} opacity={0.15} />)}
      {secC.length > 1 && secondary && (<polyline points={secC.join(' ')} fill="none" stroke={secondaryStroke || SPEC_COLOR} strokeWidth={1.75} opacity={0.9} />)}
      {mainC.length > 1 && analysis && (<polyline points={mainC.join(' ')} fill="none" stroke={stroke || '#2563eb'} strokeWidth={2} />)}
      {analysis && settings.showLimits && analysis.column.upper !== null && limX(analysis.column.upper) >= PLOT_LEFT && limX(analysis.column.upper) <= PLOT_RIGHT && (<line x1={limX(analysis.column.upper)} x2={limX(analysis.column.upper)} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke={SPEC_COLOR} strokeWidth={2} strokeDasharray="4 3" />)}
      {analysis && settings.showLimits && analysis.column.lower !== null && limX(analysis.column.lower) >= PLOT_LEFT && limX(analysis.column.lower) <= PLOT_RIGHT && (<line x1={limX(analysis.column.lower)} x2={limX(analysis.column.lower)} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke={SPEC_COLOR} strokeWidth={2} strokeDasharray="4 3" />)}
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="currentColor" strokeWidth={1.75} />
      {xMinor.map((v) => (<line key={'mn-' + v} x1={mapX(dlo, dhi, v)} x2={mapX(dlo, dhi, v)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 2.5} stroke="currentColor" strokeWidth={0.75} />))}
      {xTicks.map((t) => (<g key={t}><line x1={mapX(dlo, dhi, t)} x2={mapX(dlo, dhi, t)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} stroke="currentColor" strokeWidth={1} /><text x={mapX(dlo, dhi, t)} y={PLOT_BOTTOM + 16} textAnchor="middle" fontSize={9} fontWeight={500} fill="currentColor">{formatTick(t)}</text></g>))}
      {analysis?.column.unit && (<text x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={PLOT_BOTTOM + 32} textAnchor="middle" fontSize={9.5} fontWeight={500} fill="currentColor">{analysis.column.unit}</text>)}
      <text x={PLOT_LEFT - 32} y={PLOT_TOP + PLOT_H / 2} textAnchor="middle" fontSize={8} fontWeight={600} fill="currentColor" transform={`rotate(-90 ${PLOT_LEFT - 32} ${PLOT_TOP + PLOT_H / 2})`}>Probability</text>
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

export default CdfChart;

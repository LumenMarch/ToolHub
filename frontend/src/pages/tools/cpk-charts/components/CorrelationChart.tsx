// Correlation 相关性散点图 — 对齐 OPP generateCorrelation（CorePlot 散点 + 可选回归线 + 四限线）
// X=测试项X，Y=测试项Y；标题显示 "X vs Y (r=...)"；可选 Square 等距轴 / 回归线 / 离群高亮
import React, { useMemo } from 'react';
import { formatTick, pearsonCorrelation, type ChartSettings } from '../lib/stats';
import { H, PLOT_BOTTOM, PLOT_H, PLOT_LEFT, PLOT_RIGHT, PLOT_TOP, PLOT_W, SPEC_COLOR, W, ticksFor } from '../lib/layout';
import PlotLegend from './PlotLegend';

export interface CorrelationPair {
  xName: string;
  yName: string;
  rawX: string[];
  rawY: string[];
  xUpper: number | null;
  xLower: number | null;
  yUpper: number | null;
  yLower: number | null;
}

const mapXp = (lo: number, hi: number, v: number): number => PLOT_LEFT + ((v - lo) / (hi - lo)) * PLOT_W;
const mapYp = (lo: number, hi: number, v: number): number => PLOT_BOTTOM - ((v - lo) / (hi - lo)) * PLOT_H;

function domainOf(vals: number[], lo: number | null, hi: number | null): [number, number] {
  let dlo = vals.length ? Math.min(...vals) : 0;
  let dhi = vals.length ? Math.max(...vals) : 1;
  if (lo !== null && Number.isFinite(lo)) dlo = Math.min(dlo, lo);
  if (hi !== null && Number.isFinite(hi)) dhi = Math.max(dhi, hi);
  if (!(dhi > dlo)) { dlo -= 1; dhi += 1; }
  return [dlo, dhi];
}

interface CorrelationChartProps {
  pair: CorrelationPair;
  settings: ChartSettings;
}

const CorrelationChart: React.FC<CorrelationChartProps> = ({ pair, settings }) => {
  const s = settings;
  const { pts, xs, ys } = useMemo(() => {
    const n0 = Math.min(pair.rawX.length, pair.rawY.length);
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n0; i += 1) {
      const x = Number(pair.rawX[i]);
      const y = Number(pair.rawY[i]);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
    }
    const xs2 = out.map((q) => q.x);
    const ys2 = out.map((q) => q.y);
    return { pts: out, xs: xs2, ys: ys2 };
  }, [pair.rawX, pair.rawY]);
  const corr = useMemo(() => pearsonCorrelation(xs, ys), [xs, ys]);

  // 域：Square 时 X/Y 共用同一范围（等距轴）（轻量计算，每渲染执行）
  const rawXDomain: [number, number] = domainOf(xs, pair.xLower, pair.xUpper);
  const rawYDomain: [number, number] = domainOf(ys, pair.yLower, pair.yUpper);
  const xDom: [number, number] = s.corrSquare ? [Math.min(rawXDomain[0], rawYDomain[0]), Math.max(rawXDomain[1], rawYDomain[1])] : rawXDomain;
  const yDom: [number, number] = s.corrSquare ? xDom : rawYDomain;
  const xTicks = ticksFor(xDom[0], xDom[1]);
  const yTicks = ticksFor(yDom[0], yDom[1]);

  // 回归线端点在 X 域两端
  const regEnds = (() => {
    if (!s.corrRegression || corr.r === null) return null;
    const y0 = corr.intercept + corr.slope * xDom[0];
    const y1 = corr.intercept + corr.slope * xDom[1];
    return { y0, y1 };
  })();

  // 离群点（|z| > σ 阈值）
  const outliers = (() => {
    if (!s.corrHighlightOutliers || pts.length < 2) return new Set<number>();
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const vx = xs.reduce((a, b) => a + (b - mx) * (b - mx), 0) / (xs.length - 1);
    const yy = ys.reduce((a, b) => a + (b - my) * (b - my), 0) / (ys.length - 1);
    const sdx = Math.sqrt(vx);
    const sdy = Math.sqrt(yy);
    const th = s.corrOutlierSigma ?? 3;
    const set = new Set<number>();
    pts.forEach((q, i) => {
      const zx = sdx > 0 ? Math.abs(q.x - mx) / sdx : 0;
      const zy = sdy > 0 ? Math.abs(q.y - my) / sdy : 0;
      if (zx > th || zy > th) set.add(i);
    });
    return set;
  })();

  const unitLine = (v: number, dir: 'v' | 'h') => {
    if (dir === 'v') {
      const px = mapXp(xDom[0], xDom[1], v);
      return px >= PLOT_LEFT && px <= PLOT_RIGHT ? <line x1={px} x2={px} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke={SPEC_COLOR} strokeWidth={2} /> : null;
    }
    const py = mapYp(yDom[0], yDom[1], v);
    return py >= PLOT_TOP && py <= PLOT_BOTTOM ? <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={py} y2={py} stroke={SPEC_COLOR} strokeWidth={2} /> : null;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="font-sans text-foreground" role="img" aria-label="Correlation 相关性散点图" preserveAspectRatio="xMidYMid meet">
      {s.showTitle && (
        <text x={W / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">
          {`${pair.xName} vs ${pair.yName}${corr.r !== null ? `  (r=${corr.r.toFixed(4)})` : ''}`}
        </text>
      )}
      {/* Y 网格 + 刻度 */}
      {yTicks.map((t) => { const y = mapYp(yDom[0], yDom[1], t); return (<g key={t}><line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} /><text x={PLOT_LEFT - 12} y={y + 3.5} textAnchor="end" fontSize={9} fontWeight={500} fill="currentColor">{formatTick(t)}</text></g>); })},
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_TOP} y2={PLOT_TOP} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
      {/* 规格限红线 */}
      {s.showLimits && pair.xLower !== null && unitLine(pair.xLower, 'v')}
      {s.showLimits && pair.xUpper !== null && unitLine(pair.xUpper, 'v')}
      {s.showLimits && pair.yLower !== null && unitLine(pair.yLower, 'h')}
      {s.showLimits && pair.yUpper !== null && unitLine(pair.yUpper, 'h')}
      {/* 回归线 */}
      {regEnds && (<line x1={mapXp(xDom[0], xDom[1], xDom[0])} y1={mapYp(yDom[0], yDom[1], regEnds.y0)} x2={mapXp(xDom[0], xDom[1], xDom[1])} y2={mapYp(yDom[0], yDom[1], regEnds.y1)} stroke="#2563eb" strokeWidth={2} />)}
      {/* 散点 */}
      {pts.map((q, i) => {
        const cx = mapXp(xDom[0], xDom[1], q.x);
        const cy = mapYp(yDom[0], yDom[1], q.y);
        const isOut = outliers.has(i);
        return (<g key={i}><circle cx={cx} cy={cy} r={isOut ? 3.2 : 1.8} fill={isOut ? SPEC_COLOR : 'currentColor'} stroke={isOut ? SPEC_COLOR : 'none'} strokeWidth={isOut ? 1 : 0} /><title>{`(${formatTick(q.x)}, ${formatTick(q.y)})`}</title></g>);
      })},
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="currentColor" strokeWidth={1.75} />
      {xTicks.map((t) => (<g key={t}><line x1={mapXp(xDom[0], xDom[1], t)} x2={mapXp(xDom[0], xDom[1], t)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} stroke="currentColor" strokeWidth={1} /><text x={mapXp(xDom[0], xDom[1], t)} y={PLOT_BOTTOM + 16} textAnchor="middle" fontSize={9} fontWeight={500} fill="currentColor">{formatTick(t)}</text></g>))}
      {s.legendEnabled && (
        <PlotLegend
          entries={[{ label: `${pair.xName} vs ${pair.yName}`, color: '#2563eb', count: pts.length }]}
          position={s.legendPosition}
          showCounts={s.legendCounts}
        />
      )}
    </svg>
  );
};

export default CorrelationChart;
// 图表导出：单张 PNG 下载 / 勾选导出（按 CSV 列顺序打包 zip）
// 导出版本为独立 SVG（白底黑字 + 红线），不依赖页面主题与 Tailwind 类
import { zipSync } from 'fflate';
import {
  H,
  PLOT_BOTTOM,
  PLOT_H,
  PLOT_LEFT,
  PLOT_RIGHT,
  PLOT_TOP,
  PLOT_W,
  SPEC_COLOR,
  W,
  cptNiceNum,
  mapX,
  minorTicks,
  oppInterval,
  ticksFor,
  yTicksFor,
} from './layout';
import {
  analyzeColumn,
  analyzeColumnPair,
  computeCdf,
  DEFAULT_CHART_SETTINGS,
  formatIndex,
  formatTick,
  formatValue,
  pearsonCorrelation,
  type ChartSettings,
  type ColumnAnalysis,
} from './stats';
import type { ParsedDataset } from './csv';
import type { CorrelationPair } from '../components/CorrelationChart';
import { pow10Interval } from './layout';

const TEXT_COLOR = '#000000';
const FONT_FAMILY = 'Helvetica, Arial, sans-serif';
const CONCURRENCY = 4;

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 生成与页面组件一致的独立 SVG 字符串（白底黑字）。 */
export function renderHistogramSvg(analysis: ColumnAnalysis, settings: ChartSettings = DEFAULT_CHART_SETTINGS): string {
  const { column, stat, bins, domain, hasLimits } = analysis;
  const s = settings;
  const [dlo, dhi] = domain;
  // 对齐 OPP：plotSpace X range = bin 域 × expandRangeByFactor(1.05)，两端各留 2.5% 边距
  const xCenter = (dlo + dhi) / 2;
  const xHalf = ((dhi - dlo) / 2) * 1.05;
  const plo = xCenter - xHalf;
  const phi = xCenter + xHalf;
  const xTicks = ticksFor(plo, phi);
  const xMajor = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : oppInterval(plo, phi);
  const xMinor = minorTicks(plo, phi, xMajor, 4);
  // 柱宽按数据单位换算像素：OPP barWidth = binSize（数据坐标）
  const binWData = bins.length > 1 ? bins[1]!.x0 - bins[0]!.x0 : dhi - dlo;
  const binW = (binWData / (phi - plo)) * PLOT_W;
  const unitSuffix = column.unit ? ` (${column.unit})` : '';

  const yVal = (count: number, percent: number): number => (s.showPercentage ? percent : count);
  // 柱计数最大值（Y 上限自动推导的依据）
  let maxCount = 0;
  for (const b of bins) {
    if (b.count > maxCount) maxCount = b.count;
  }
  let yMax: number;
  let yStep: number;
  if (s.showPercentage) {
    // 对齐 OPP：Percent 模式 FixedInterval（interval = 20、上限 100）
    yMax = 100;
    yStep = 20;
  } else if (s.yUpper !== null && s.yUpper > 0) {
    // 对齐 OPP useCustomYUpperValue：上限 = Y-Upper 输入，主刻度间隔 = Y-Upper / 5
    yMax = s.yUpper;
    yStep = yMax / 5;
  } else {
    // 对齐 OPP：上限 = 最大柱计数 + floor(maxCount × 0.1)
    yMax = maxCount + Math.floor(maxCount * 0.1);
    yStep = cptNiceNum(yMax / 4);
  }
  if (!(yStep > 0)) yStep = 1;
  const yTicks = yTicksFor(yMax, yStep);
  const yMinorFracs = s.showPercentage ? [0.25, 0.5, 0.75] : [0.2, 0.4, 0.6, 0.8];
  const barY = (val: number): number => PLOT_BOTTOM - (val / yMax) * PLOT_H;

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Data Count', value: String(stat.count) },
    { label: 'NA Count', value: String(stat.naCount) },
    { label: 'Failure Count', value: `${stat.failureCount} (${stat.failureRate.toFixed(2)}%)` },
    { label: 'Max', value: formatValue(stat.max) },
    { label: 'Min', value: formatValue(stat.min) },
    { label: 'Mean', value: formatValue(stat.mean) },
    { label: 'Std. Dev.', value: formatValue(stat.stdDev) },
    { label: 'Cpu', value: formatIndex(stat.cpu) },
    { label: 'Cpl', value: formatIndex(stat.cpl) },
    { label: 'Cpk', value: formatIndex(stat.cpk) },
  ];

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff" />`);
  parts.push(`<defs><clipPath id="cpk-plot-clip"><rect x="${PLOT_LEFT}" y="${PLOT_TOP}" width="${PLOT_W}" height="${PLOT_H}" /></clipPath></defs>`);
  if (s.showTitle) {
    parts.push(`<text x="${W / 2}" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="${TEXT_COLOR}">${escapeXml(column.name + unitSuffix)}</text>`);
  }
  if (s.showStats) {
    stats.forEach((item, i) => {
      const y = 29 + i * 20;
      const w = item.label === 'Cpk' ? 700 : 500;
      const isF = item.label === 'Failure Count' && stat.failureCount > 0;
      const fill = isF ? SPEC_COLOR : TEXT_COLOR;
      parts.push(`<text x="14" y="${y}" font-size="10" font-weight="${w}" fill="${fill}">${escapeXml(item.label)}: ${escapeXml(item.value)}</text>`);
    });
  }
  // Y 轴标签：垂直旋转，Percentage / Count
  parts.push(`<text x="${PLOT_LEFT - 32}" y="${PLOT_TOP + PLOT_H / 2}" text-anchor="middle" font-size="8" font-weight="600" fill="${TEXT_COLOR}" transform="rotate(-90 ${PLOT_LEFT - 32} ${PLOT_TOP + PLOT_H / 2})">${s.showPercentage ? 'Percentage' : 'Count'}</text>`);
  // Y 网格 + 刻度：实线在刻度处，虚线在每两刻度间均匀加3条浅灰虚线
  yTicks.forEach((t) => {
    const y = barY(t);
    parts.push(`<line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${y}" y2="${y}" stroke="${TEXT_COLOR}" stroke-opacity="${t === 0 ? 0.9 : 0.85}" stroke-width="1" />`);
    parts.push(`<text x="${PLOT_LEFT - 12}" y="${y + 3.5}" text-anchor="end" font-size="9" font-weight="500" fill="${TEXT_COLOR}">${t}</text>`);
  });
  yTicks.slice(0, -1).forEach((t) => {
    yMinorFracs.forEach((frac) => {
      const v = t + yStep * frac;
      if (v >= yMax - 1e-9) return;
      const y = barY(v);
      parts.push(`<line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${y}" y2="${y}" stroke="${TEXT_COLOR}" stroke-opacity="0.18" stroke-width="1" />`);
    });
  });
  parts.push(`<line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${PLOT_TOP}" y2="${PLOT_TOP}" stroke="${TEXT_COLOR}" stroke-opacity="0.6" stroke-width="1" />`);
  // 直方柱 + 柱顶数量/描边（超出 Y 轴上限部分被裁剪，对齐 OPP）
  parts.push('<g clip-path="url(#cpk-plot-clip)">');
  bins.forEach((b) => {
    // 对齐 OPP：bar 中心在 bin 中心、宽 1 bin → 起点左移半个 bin 宽（柱身会压过规格限红线）
    const x = mapX(plo, phi, b.x0) - binW / 2;
    const y = barY(yVal(b.count, b.percent));
    const h = Math.max(0, PLOT_BOTTOM - y);
    if (h <= 0) return;
    const sw = s.showOutlines ? ' stroke="' + TEXT_COLOR + '" stroke-width="0.75"' : '';
    parts.push(`<rect x="${x}" y="${y}" width="${Math.max(1, binW)}" height="${h}" fill="${TEXT_COLOR}" opacity="1"${sw} />`);
    if (s.showCounts) {
      // Percentage 模式柱顶显示占比百分数（整数），Count 模式显示样本数
      const topLabel = s.showPercentage ? Math.round(b.percent) : b.count;
      parts.push(`<text x="${x + binW / 2}" y="${y - 3}" text-anchor="middle" font-size="8" font-weight="600" fill="${TEXT_COLOR}">${topLabel}</text>`);
    }
  });
  parts.push('</g>');
  // 规格限红线
  if (s.showLimits && column.upper !== null && mapX(plo, phi, column.upper) >= PLOT_LEFT && mapX(plo, phi, column.upper) <= PLOT_RIGHT) {
    const x = mapX(plo, phi, column.upper);
    parts.push(`<line x1="${x}" x2="${x}" y1="${PLOT_TOP}" y2="${PLOT_BOTTOM}" stroke="${SPEC_COLOR}" stroke-width="3" />`);
  }
  if (s.showLimits && column.lower !== null && mapX(plo, phi, column.lower) >= PLOT_LEFT && mapX(plo, phi, column.lower) <= PLOT_RIGHT) {
    const x = mapX(plo, phi, column.lower);
    parts.push(`<line x1="${x}" x2="${x}" y1="${PLOT_TOP}" y2="${PLOT_BOTTOM}" stroke="${SPEC_COLOR}" stroke-width="3" />`);
  }
  if (s.showLimits && !hasLimits) {
    parts.push(`<text x="${PLOT_RIGHT - 6}" y="${PLOT_TOP + 13}" text-anchor="end" font-size="9" font-weight="500" fill="${TEXT_COLOR}">[ NO SPEC LIMITS ]</text>`);
  }
  // X 轴主线 + 小刻度（无数字） + 主刻度 + 轴名
  parts.push(`<line x1="${PLOT_LEFT}" x2="${PLOT_RIGHT}" y1="${PLOT_BOTTOM}" y2="${PLOT_BOTTOM}" stroke="${TEXT_COLOR}" stroke-width="1.75" />`);
  xMinor.forEach((v) => {
    const mx = mapX(plo, phi, v);
    parts.push(`<line x1="${mx}" x2="${mx}" y1="${PLOT_BOTTOM}" y2="${PLOT_BOTTOM + 2.5}" stroke="${TEXT_COLOR}" stroke-width="0.75" />`);
  });
  xTicks.forEach((t) => {
    const x = mapX(plo, phi, t);
    parts.push(`<line x1="${x}" x2="${x}" y1="${PLOT_BOTTOM}" y2="${PLOT_BOTTOM + 5}" stroke="${TEXT_COLOR}" stroke-width="1" />`);
    parts.push(`<text x="${x}" y="${PLOT_BOTTOM + 16}" text-anchor="middle" font-size="9" font-weight="500" fill="${TEXT_COLOR}">${escapeXml(formatTick(t))}</text>`);
  });
  if (column.unit) {
    parts.push(`<text x="${(PLOT_LEFT + PLOT_RIGHT) / 2}" y="${PLOT_BOTTOM + 32}" text-anchor="middle" font-size="9.5" font-weight="500" fill="${TEXT_COLOR}">${escapeXml(column.unit)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** CDF 累积分布图独立 SVG（白底黑字），对齐组件 CdfChart。 */
export function renderCdfSvg(analysis: ColumnAnalysis, settings: ChartSettings = DEFAULT_CHART_SETTINGS): string {
  const s = settings;
  const [dlo, dhi] = analysis.domain;
  const xTicks = ticksFor(dlo, dhi);
  const xMajor = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : dhi - dlo;
  const xMinor = minorTicks(dlo, dhi, xMajor, 4);
  const yInterval = cptNiceNum(1 / 7);
  const yTicks = yTicksFor(1, yInterval);
  const yMinor = minorTicks(0, 1, yInterval, 1);
  const yPx = (p: number): number => PLOT_BOTTOM - p * PLOT_H;
  const xp = (v: number): number => mapX(dlo, dhi, v);
  const unitSuffix = analysis.column.unit ? ' (' + analysis.column.unit + ')' : '';

  const parts: string[] = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FONT_FAMILY + '">');
  parts.push('<rect width="' + W + '" height="' + H + '" fill="#ffffff" />');
  if (s.showTitle) parts.push('<text x="' + (W / 2) + '" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="' + TEXT_COLOR + '">' + escapeXml(analysis.column.name + unitSuffix) + '</text>');
  yTicks.forEach((t) => {
    const y = yPx(t);
    parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + TEXT_COLOR + '" stroke-opacity="' + (t === 0 ? 0.9 : 0.45) + '" stroke-width="1" />');
    parts.push('<text x="' + (PLOT_LEFT - 12) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" font-weight="500" fill="' + TEXT_COLOR + '">' + Math.round(t * 100) + '%</text>');
  });
  yMinor.forEach((v) => {
    const y = yPx(v);
    parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.18" stroke-width="1" />');
  });
  parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + PLOT_TOP + '" y2="' + PLOT_TOP + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.6" stroke-width="1" />');
  const base = computeCdf(analysis.values).map((p) => ({ x: p.x, y: p.y / 100 }));
  let mainPts = base;
  if (s.cdfType === 'ccdf') mainPts = base.toReversed();
  else if (s.cdfType === 'folded' && mainPts.length > 1) {
    const half = Math.floor(mainPts.length / 2);
    mainPts = [...mainPts.slice(0, half), ...mainPts.slice(0, half).toReversed()];
  }
  const mainC = mainPts.map((p) => xp(p.x) + ',' + yPx(p.y)).join(' ');
  if (mainC.length > 0) parts.push('<polyline points="' + mainC + '" fill="none" stroke="#2563eb" stroke-width="2" />');
  if (s.showLimits && analysis.column.upper !== null) { const x = xp(analysis.column.upper); if (x >= PLOT_LEFT && x <= PLOT_RIGHT) parts.push('<line x1="' + x + '" x2="' + x + '" y1="' + PLOT_TOP + '" y2="' + PLOT_BOTTOM + '" stroke="' + SPEC_COLOR + '" stroke-width="2" stroke-dasharray="4 3" />'); }
  if (s.showLimits && analysis.column.lower !== null) { const x = xp(analysis.column.lower); if (x >= PLOT_LEFT && x <= PLOT_RIGHT) parts.push('<line x1="' + x + '" x2="' + x + '" y1="' + PLOT_TOP + '" y2="' + PLOT_BOTTOM + '" stroke="' + SPEC_COLOR + '" stroke-width="2" stroke-dasharray="4 3" />'); }
  parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + PLOT_BOTTOM + '" y2="' + PLOT_BOTTOM + '" stroke="' + TEXT_COLOR + '" stroke-width="1.75" />');
  xMinor.forEach((v) => {
    const x = xp(v);
    parts.push('<line x1="' + x + '" x2="' + x + '" y1="' + PLOT_BOTTOM + '" y2="' + (PLOT_BOTTOM + 2.5) + '" stroke="' + TEXT_COLOR + '" stroke-width="0.75" />');
  });
  xTicks.forEach((t) => {
    const x = xp(t);
    parts.push('<line x1="' + x + '" x2="' + x + '" y1="' + PLOT_BOTTOM + '" y2="' + (PLOT_BOTTOM + 5) + '" stroke="' + TEXT_COLOR + '" stroke-width="1" />');
    parts.push('<text x="' + x + '" y="' + (PLOT_BOTTOM + 16) + '" text-anchor="middle" font-size="9" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(formatTick(t)) + '</text>');
  });
  if (analysis.column.unit) parts.push('<text x="' + ((PLOT_LEFT + PLOT_RIGHT) / 2) + '" y="' + (PLOT_BOTTOM + 32) + '" text-anchor="middle" font-size="9.5" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(analysis.column.unit) + '</text>');
  parts.push('<text x="' + (PLOT_LEFT - 32) + '" y="' + (PLOT_TOP + PLOT_H / 2) + '" text-anchor="middle" font-size="8" font-weight="600" fill="' + TEXT_COLOR + '" transform="rotate(-90 ' + (PLOT_LEFT - 32) + ' ' + (PLOT_TOP + PLOT_H / 2) + ')">Probability</text>');
  parts.push('</svg>');
  return parts.join('');
}

/** Time Series 时序图独立 SVG（白底黑字），对齐组件 TimeSeriesChart。 */
export function renderTimeSeriesSvg(analysis: ColumnAnalysis, settings: ChartSettings = DEFAULT_CHART_SETTINGS): string {
  const s = settings;
  const n = analysis.values.length;
  const xLo = 0;
  const xHi = Math.max(1, n - 1);
  const xTicks = ticksFor(xLo, xHi);
  const range = (): [number, number] => {
    if (analysis.values.length === 0) return [0, 1];
    let lo = Math.min(...analysis.values);
    let hi = Math.max(...analysis.values);
    if (analysis.column.lower !== null) lo = Math.min(lo, analysis.column.lower);
    if (analysis.column.upper !== null) hi = Math.max(hi, analysis.column.upper);
    if (s.upperRange !== null) hi = s.upperRange;
    if (s.lowerRange !== null) lo = s.lowerRange;
    if (!(hi > lo)) return [lo - 1, hi + 1];
    if (s.upperRange !== null || s.lowerRange !== null) return [lo, hi];
    let m = hi - lo;
    if (!(m > 0)) m = 1;
    return [lo - m * 0.08, hi + m * 0.08];
  };
  const [yLo, yHi] = range();
  const yStep = pow10Interval(yHi - yLo, 10);
  const yTickLo = Math.floor(yLo / yStep) * yStep;
  const yTickHi = yTickLo + Math.ceil((yHi - yTickLo) / yStep) * yStep;
  const yTicks: number[] = [];
  for (let v = yTickLo; v <= yTickHi + yStep / 2; v += yStep) yTicks.push(v);
  const yMinor = minorTicks(yTickLo, yTickHi, yStep, 3);
  const mrange = (v: number, lo: number, hi: number, pl: number, ph: number): number => pl + ((v - lo) / (hi - lo)) * (ph - pl);
  const unitSuffix = analysis.column.unit ? ' (' + analysis.column.unit + ')' : '';
  const lineWidth = s.lineWidth === 'none' ? 0 : s.lineWidth === 'thin' ? 0.5 : s.lineWidth === 'med' ? 1 : 2;
  const mean = analysis.values.length > 0 ? analysis.values.reduce((a, b) => a + b, 0) / analysis.values.length : NaN;

  const parts: string[] = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FONT_FAMILY + '">');
  parts.push('<rect width="' + W + '" height="' + H + '" fill="#ffffff" />');
  if (s.showTitle) parts.push('<text x="' + (W / 2) + '" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="' + TEXT_COLOR + '">' + escapeXml(analysis.column.name + unitSuffix) + '</text>');
  yTicks.forEach((t) => {
    const y = mrange(t, yLo, yHi, PLOT_BOTTOM, PLOT_TOP);
    parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.45" stroke-width="1" />');
    parts.push('<text x="' + (PLOT_LEFT - 12) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(formatTick(t)) + '</text>');
  });
  yMinor.forEach((v) => {
    const y = mrange(v, yLo, yHi, PLOT_BOTTOM, PLOT_TOP);
    parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.18" stroke-width="1" />');
  });
  parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + PLOT_TOP + '" y2="' + PLOT_TOP + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.6" stroke-width="1" />');
  if (s.tsMean && analysis.values.length > 0 && !Number.isNaN(mean)) {
    const y = mrange(mean, yLo, yHi, PLOT_BOTTOM, PLOT_TOP);
    parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="5 4" />');
  }
  if (s.showLimits && analysis.column.upper !== null) { const y = mrange(analysis.column.upper, yLo, yHi, PLOT_BOTTOM, PLOT_TOP); parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + SPEC_COLOR + '" stroke-width="2" />'); }
  if (s.showLimits && analysis.column.lower !== null) { const y = mrange(analysis.column.lower, yLo, yHi, PLOT_BOTTOM, PLOT_TOP); parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + SPEC_COLOR + '" stroke-width="2" />'); }
  const ptsStr = analysis.values.map((v, i) => mrange(i, xLo, xHi, PLOT_LEFT, PLOT_RIGHT) + ',' + mrange(v, yLo, yHi, PLOT_BOTTOM, PLOT_TOP)).join(' ');
  if (analysis.values.length > 0) {
    // Show Fill：折线与基线间的填充多边形（对齐组件）
    if (s.tsFill) {
      const fillPts = PLOT_LEFT + ',' + PLOT_BOTTOM + ' ' + ptsStr + ' ' + PLOT_RIGHT + ',' + PLOT_BOTTOM;
      parts.push('<polygon points="' + fillPts + '" fill="#2563eb" opacity="0.15" />');
    }
    if (s.tsLines !== false && lineWidth > 0) parts.push('<polyline points="' + ptsStr + '" fill="none" stroke="#2563eb" stroke-width="' + lineWidth + '" />');
    const r = 2.6;
    analysis.values.forEach((v, i) => {
      const cx = mrange(i, xLo, xHi, PLOT_LEFT, PLOT_RIGHT);
      const cy = mrange(v, yLo, yHi, PLOT_BOTTOM, PLOT_TOP);
      if (s.dataSymbol === 'circle') parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#2563eb" />');
      else if (s.dataSymbol === 'plus') parts.push('<path d="M ' + (cx - r) + ' ' + cy + ' L ' + (cx + r) + ' ' + cy + ' M ' + cx + ' ' + (cy - r) + ' L ' + cx + ' ' + (cy + r) + '" stroke="#2563eb" stroke-width="1" />');
      else if (s.dataSymbol === 'cross') { const d = r * 0.7; parts.push('<path d="M ' + (cx - d) + ' ' + (cy - d) + ' L ' + (cx + d) + ' ' + (cy + d) + ' M ' + (cx - d) + ' ' + (cy + d) + ' L ' + (cx + d) + ' ' + (cy - d) + '" stroke="#2563eb" stroke-width="1" />'); }
    });
  }
  parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + PLOT_BOTTOM + '" y2="' + PLOT_BOTTOM + '" stroke="' + TEXT_COLOR + '" stroke-width="1.75" />');
  xTicks.forEach((t) => {
    const x = mrange(t, xLo, xHi, PLOT_LEFT, PLOT_RIGHT);
    parts.push('<line x1="' + x + '" x2="' + x + '" y1="' + PLOT_BOTTOM + '" y2="' + (PLOT_BOTTOM + 5) + '" stroke="' + TEXT_COLOR + '" stroke-width="1" />');
    parts.push('<text x="' + x + '" y="' + (PLOT_BOTTOM + 16) + '" text-anchor="middle" font-size="9" font-weight="500" fill="' + TEXT_COLOR + '">' + Math.round(t) + '</text>');
  });
  if (analysis.column.unit) parts.push('<text x="' + ((PLOT_LEFT + PLOT_RIGHT) / 2) + '" y="' + (PLOT_BOTTOM + 32) + '" text-anchor="middle" font-size="9.5" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(analysis.column.unit) + '</text>');
  parts.push('<text x="' + (PLOT_LEFT - 32) + '" y="' + (PLOT_TOP + PLOT_H / 2) + '" text-anchor="middle" font-size="8" font-weight="600" fill="' + TEXT_COLOR + '" transform="rotate(-90 ' + (PLOT_LEFT - 32) + ' ' + (PLOT_TOP + PLOT_H / 2) + ')">Value</text>');
  parts.push('</svg>');
  return parts.join('');
}

export function renderCorrelationSvg(pair: CorrelationPair, settings: ChartSettings = DEFAULT_CHART_SETTINGS): string {
  const s = settings;
  const pts: Array<{ x: number; y: number }> = [];
  const n0 = Math.min(pair.rawX.length, pair.rawY.length);
  for (let i = 0; i < n0; i += 1) {
    const x = Number(pair.rawX[i]);
    const y = Number(pair.rawY[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const domainOf = (vals: number[], lo: number | null, hi: number | null): [number, number] => {
    let dlo = vals.length ? Math.min(...vals) : 0;
    let dhi = vals.length ? Math.max(...vals) : 1;
    if (lo !== null && Number.isFinite(lo)) dlo = Math.min(dlo, lo);
    if (hi !== null && Number.isFinite(hi)) dhi = Math.max(dhi, hi);
    if (!(dhi > dlo)) { dlo -= 1; dhi += 1; }
    return [dlo, dhi];
  };
  const rawXDomain = domainOf(xs, pair.xLower, pair.xUpper);
  const rawYDomain = domainOf(ys, pair.yLower, pair.yUpper);
  const xDom: [number, number] = s.corrSquare ? [Math.min(rawXDomain[0], rawYDomain[0]), Math.max(rawXDomain[1], rawYDomain[1])] : rawXDomain;
  const yDom: [number, number] = s.corrSquare ? xDom : rawYDomain;
  const xTicks = ticksFor(xDom[0], xDom[1]);
  const yTicks = ticksFor(yDom[0], yDom[1]);
  const corr = pearsonCorrelation(xs, ys);
  const xp = (v: number): number => PLOT_LEFT + ((v - xDom[0]) / (xDom[1] - xDom[0])) * PLOT_W;
  const yp = (v: number): number => PLOT_BOTTOM - ((v - yDom[0]) / (yDom[1] - yDom[0])) * PLOT_H;

  const parts: string[] = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FONT_FAMILY + '">');
  parts.push('<rect width="' + W + '" height="' + H + '" fill="#ffffff" />');
  if (s.showTitle) {
    const title = escapeXml(pair.xName + ' vs ' + pair.yName) + (corr.r !== null ? '  (r=' + corr.r.toFixed(4) + ')' : '');
    parts.push('<text x="' + (W / 2) + '" y="15" text-anchor="middle" font-size="11" font-weight="700" fill="' + TEXT_COLOR + '">' + title + '</text>');
  }
  yTicks.forEach((t) => {
    const y = yp(t);
    parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + y + '" y2="' + y + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.4" stroke-width="1" />');
    parts.push('<text x="' + (PLOT_LEFT - 12) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(formatTick(t)) + '</text>');
  });
  parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + PLOT_TOP + '" y2="' + PLOT_TOP + '" stroke="' + TEXT_COLOR + '" stroke-opacity="0.6" stroke-width="1" />');
  if (s.showLimits && pair.xLower !== null) { const px = xp(pair.xLower); if (px >= PLOT_LEFT && px <= PLOT_RIGHT) parts.push('<line x1="' + px + '" x2="' + px + '" y1="' + PLOT_TOP + '" y2="' + PLOT_BOTTOM + '" stroke="' + SPEC_COLOR + '" stroke-width="2" />'); }
  if (s.showLimits && pair.xUpper !== null) { const px = xp(pair.xUpper); if (px >= PLOT_LEFT && px <= PLOT_RIGHT) parts.push('<line x1="' + px + '" x2="' + px + '" y1="' + PLOT_TOP + '" y2="' + PLOT_BOTTOM + '" stroke="' + SPEC_COLOR + '" stroke-width="2" />'); }
  if (s.showLimits && pair.yLower !== null) { const py = yp(pair.yLower); if (py >= PLOT_TOP && py <= PLOT_BOTTOM) parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + py + '" y2="' + py + '" stroke="' + SPEC_COLOR + '" stroke-width="2" />'); }
  if (s.showLimits && pair.yUpper !== null) { const py = yp(pair.yUpper); if (py >= PLOT_TOP && py <= PLOT_BOTTOM) parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + py + '" y2="' + py + '" stroke="' + SPEC_COLOR + '" stroke-width="2" />'); }
  if (s.corrRegression && corr.r !== null) {
    const y0 = corr.intercept + corr.slope * xDom[0];
    const y1 = corr.intercept + corr.slope * xDom[1];
    parts.push('<line x1="' + xp(xDom[0]) + '" y1="' + yp(y0) + '" x2="' + xp(xDom[1]) + '" y2="' + yp(y1) + '" stroke="#2563eb" stroke-width="2" />');
  }
  const outliers = new Set<number>();
  if (s.corrHighlightOutliers && pts.length >= 2) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const vx = xs.reduce((a, b) => a + (b - mx) * (b - mx), 0) / (xs.length - 1);
    const vy = ys.reduce((a, b) => a + (b - my) * (b - my), 0) / (ys.length - 1);
    const sdx = Math.sqrt(vx);
    const sdy = Math.sqrt(vy);
    const th = s.corrOutlierSigma ?? 3;
    pts.forEach((q, i) => {
      const zx = sdx > 0 ? Math.abs(q.x - mx) / sdx : 0;
      const zy = sdy > 0 ? Math.abs(q.y - my) / sdy : 0;
      if (zx > th || zy > th) outliers.add(i);
    });
  }
  pts.forEach((q, i) => {
    const cx = xp(q.x);
    const cy = yp(q.y);
    const isOut = outliers.has(i);
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (isOut ? 3.2 : 1.8) + '" fill="' + (isOut ? SPEC_COLOR : TEXT_COLOR) + '" />');
  });
  parts.push('<line x1="' + PLOT_LEFT + '" x2="' + PLOT_RIGHT + '" y1="' + PLOT_BOTTOM + '" y2="' + PLOT_BOTTOM + '" stroke="' + TEXT_COLOR + '" stroke-width="1.75" />');
  xTicks.forEach((t) => {
    const x = xp(t);
    parts.push('<line x1="' + x + '" x2="' + x + '" y1="' + PLOT_BOTTOM + '" y2="' + (PLOT_BOTTOM + 5) + '" stroke="' + TEXT_COLOR + '" stroke-width="1" />');
    parts.push('<text x="' + x + '" y="' + (PLOT_BOTTOM + 16) + '" text-anchor="middle" font-size="9" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(formatTick(t)) + '</text>');
  });
  parts.push('<text x="' + ((PLOT_LEFT + PLOT_RIGHT) / 2) + '" y="' + (PLOT_BOTTOM + 32) + '" text-anchor="middle" font-size="9.5" font-weight="500" fill="' + TEXT_COLOR + '">' + escapeXml(pair.xName) + '</text>');
  parts.push('<text x="' + (PLOT_LEFT - 32) + '" y="' + (PLOT_TOP + PLOT_H / 2) + '" text-anchor="middle" font-size="8" font-weight="600" fill="' + TEXT_COLOR + '" transform="rotate(-90 ' + (PLOT_LEFT - 32) + ' ' + (PLOT_TOP + PLOT_H / 2) + ')">' + escapeXml(pair.yName) + '</text>');
  parts.push('</svg>');
  return parts.join('');
}

/** 导出单张 Correlation PNG。 */
export async function exportCorrelationPng(pair: CorrelationPair, settings: ChartSettings = DEFAULT_CHART_SETTINGS): Promise<void> {
  const svg = renderCorrelationSvg(pair, settings);
  const png = await svgToPng(svg);
  downloadBlob(png, 'Correlation_' + sanitizeFilename(pair.xName) + '_vs_' + sanitizeFilename(pair.yName) + '.png');
}

/** 清洗文件名（去除非法字符、控制 200 字符以内）。 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.+$/, '')
    .replace(/\s+$/, '')
    .trim();
  return cleaned.slice(0, 200) || 'undefined';
}

/** SVG 字符串 → PNG Blob（2x 分辨率，白色背景）。 */
export async function svgToPng(svg: string, width: number = W, height: number = H, scale: number = 2): Promise<Blob> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  let out: Blob;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG 解析失败'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    out = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))), 'image/png');
    });
  } catch (e) {
    // 失败路径也必须释放 object URL，避免批量导出时泄漏
    URL.revokeObjectURL(url);
    throw e;
  }
  URL.revokeObjectURL(url);
  return out;
}

/** 触发浏览器下载。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 导出勾选项目：按 CSV 列顺序打包 zip。 */
// (exportCheckedCharts removed — 改用 exportComparedByName)

/** 导出单张 PNG。 */
export async function exportChartPng(analysis: ColumnAnalysis, index: number, settings: ChartSettings = DEFAULT_CHART_SETTINGS): Promise<void> {
  const svg = renderHistogramSvg(analysis, settings);
  const png = await svgToPng(svg);
  downloadBlob(png, `${index}_${sanitizeFilename(analysis.column.name)}.png`);
}


/**
 * 按测试项名称批量导出（支持单份或 A/B 双数据集对比）。
 * 每个 source { dataset, prefix }：数据集及文件名前缀（A/B）。
 * 输出 zip，文件名为 `<prefix>_<序号>_<测试项>.png`。
 */
interface NameEntrySrc {
  src: { prefix: string };
  idx: number;
  effUpper: number | null;
  effLower: number | null;
  raw: string[];
  columnEff: ParsedDataset['columns'][number];
}
interface NameEntry {
  name: string;
  entries: NameEntrySrc[];
}

/** 单个 name 的渲染（双侧共享域 / 单侧）；模块级函数，await 不在任何循环内。 */
async function renderNameEntry(
  ne: NameEntry,
  canShare: boolean,
  settings: ChartSettings,
): Promise<Array<{ fname: string; bytes: Uint8Array } | null>> {
  const { name, entries } = ne;
  if (entries.length === 2 && canShare) {
    const a = entries[0]!, b = entries[1]!;
    const pair = analyzeColumnPair(a.columnEff, a.raw, b.columnEff, b.raw, settings.binCount, settings.lowerRange, settings.upperRange, settings.showLimits);
    const make = async (analysis: ColumnAnalysis, pre: string, idx: number) => {
      const svg = renderHistogramSvg(analysis, settings);
      const png = await svgToPng(svg);
      const bytes = new Uint8Array(await png.arrayBuffer());
      return { fname: `${pre}_${idx + 1}_${sanitizeFilename(name)}.png`, bytes };
    };
    return [await make(pair.a, a.src.prefix, a.idx), await make(pair.b, b.src.prefix, b.idx)];
  }
  // 单侧（entries 最多 2：A/B 各自一条），显式展开避免循环内 await
  const r1 = async (en: NameEntrySrc) => {
    const analysis = analyzeColumn(en.columnEff, en.raw, settings.binCount, settings.lowerRange, settings.upperRange, settings.showLimits);
    const svg = renderHistogramSvg(analysis, settings);
    const png = await svgToPng(svg);
    const bytes = new Uint8Array(await png.arrayBuffer());
    return { fname: `${en.src.prefix}_${en.idx + 1}_${sanitizeFilename(name)}.png`, bytes };
  };
  if (entries.length === 1) return [await r1(entries[0]!)];
  if (entries.length === 2) return [await r1(entries[0]!), await r1(entries[1]!)];
  return [];
}

export async function exportComparedByName(
  sources: Array<{ dataset: ParsedDataset; prefix: string }>,
  names: string[],
  settings: ChartSettings,
  onProgress: (done: number, total: number) => void,
): Promise<string> {
  // 当双源且同名 Item 同时存在时，使用共享 X 轴域，保证两图刻度完全一致
  const canShare = sources.length === 2;
  // 预构建每个 name 对应的源信息（含有效列与手动规格限覆盖）
  const nameEntries: NameEntry[] = [];
  for (const name of names) {
    const entries: NameEntry['entries'] = [];
    for (const src of sources) {
      const idx = src.dataset.columns.findIndex((c) => c.name === name);
      if (idx >= 0) {
        const col = src.dataset.columns[idx];
        const effUpper = settings.upperLimit !== null ? settings.upperLimit : col.upper;
        const effLower = settings.lowerLimit !== null ? settings.lowerLimit : col.lower;
        const columnEff = { ...col, upper: effUpper, lower: effLower };
        const raw = src.dataset.rows.map((r) => r[idx] ?? 'NA');
        entries.push({ src, idx, effUpper, effLower, raw, columnEff });
      }
    }
    if (entries.length > 0) nameEntries.push({ name, entries });
  }

  // 展开为扁平任务数，用于进度
  const totalFiles = nameEntries.reduce((s, e) => s + e.entries.length, 0);
  const files: Record<string, Uint8Array> = {};
  // 按 name 批次处理（递归分批，同名 pair 同批共享域；避免循环内 await）
  const runBatches = async (start: number, acc: Record<string, Uint8Array>, dn: number): Promise<void> => {
    if (start >= nameEntries.length) return;
    const batch = nameEntries.slice(start, start + CONCURRENCY);
    const results = await Promise.all(batch.map((ne) => renderNameEntry(ne, canShare, settings)));
    for (const item of results.flat(1)) if (item) acc[item.fname] = item.bytes;
    dn += batch.reduce((s2, ne) => s2 + ne.entries.length, 0);
    onProgress(dn, totalFiles);
    await runBatches(start + CONCURRENCY, acc, dn);
  };
  await runBatches(0, files, 0);
  const zipped = zipSync(files, { level: 5 });
  const base = sanitizeFilename(sources[0]?.dataset.title || 'cpk-charts');
  const zipName = `${base}_cpk_charts.zip`;
  downloadBlob(new Blob([zipped], { type: 'application/zip' }), zipName);
  return zipName;
}
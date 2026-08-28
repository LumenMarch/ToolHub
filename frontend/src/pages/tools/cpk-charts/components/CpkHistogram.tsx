// CPK 过程能力直方图 — 按 OPP 应用（Core Plot）截图排版还原
// 支持对齐 OPP 设置面板的显示开关：标题/统计/规格限/柱顶数量/百分比/柱描边/bin数/Y上限
import React from 'react';
import {
  type ChartSettings,
  type ColumnAnalysis,
  formatIndex,
  formatTick,
  formatValue,
} from '../lib/stats';
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
} from '../lib/layout';

interface CpkHistogramProps {
  analysis: ColumnAnalysis;
  settings: ChartSettings;
}

const CpkHistogram: React.FC<CpkHistogramProps> = ({ analysis, settings }) => {
  const { column, stat, bins, domain, hasLimits } = analysis;
  const s = settings;
  const [dlo, dhi] = domain;

  // 对齐 OPP：plotSpace X range = bin 域 × expandRangeByFactor(1.05)，两端各留 2.5% 边距
  const xCenter = (dlo + dhi) / 2;
  const xHalf = ((dhi - dlo) / 2) * 1.05;
  const [plo, phi] = [xCenter - xHalf, xCenter + xHalf];

  const xTicks = ticksFor(plo, phi);
  const xMajor = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : oppInterval(plo, phi);
  // X 小刻度线（OPP：每主刻度间 4 条次刻度，5 等分）
  const xMinorTicks = minorTicks(plo, phi, xMajor, 4);
  // 柱宽按数据单位换算像素：OPP barWidth = binSize（数据坐标）
  const binWData = bins.length > 1 ? bins[1]!.x0 - bins[0]!.x0 : dhi - dlo;
  const binW = (binWData / (phi - plo)) * PLOT_W;
  const unitSuffix = column.unit ? ` (${column.unit})` : '';

  // Y 轴：百分比或数量；上限自动或手动
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
    // 对齐 OPP：上限 = 最大柱计数 + floor(maxCount × 0.1)，主刻度取 nice 步长
    yMax = maxCount + Math.floor(maxCount * 0.1);
    yStep = cptNiceNum(yMax / 4);
  }
  if (!(yStep > 0)) yStep = 1;
  const yTicks = yTicksFor(yMax, yStep);
  // 对齐 OPP：Count 模式 minorTicksPerInterval=4，Percent=3
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="font-sans text-foreground" role="img" aria-label={`${column.name} CPK 直方图`} preserveAspectRatio="xMidYMid meet">
      <title>{column.name}</title>
      <defs>
        <clipPath id="cpk-plot-clip">
          <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_W} height={PLOT_H} />
        </clipPath>
      </defs>

      {s.showTitle && (
        <text x={W / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="currentColor">
          {column.name}{unitSuffix}
        </text>
      )}

      {s.showStats && stats.map((item, i) => {
        const y = 29 + i * 20;
        const isFailure = item.label === 'Failure Count' && stat.failureCount > 0;
        return (
          <text key={item.label} x={14} y={y} fontSize={10} fill={isFailure ? SPEC_COLOR : 'currentColor'} fontWeight={item.label === 'Cpk' ? 700 : 500} className="tabular-nums">
            {item.label}: {item.value}
          </text>
        );
      })}

      {/* Y 轴标签：紧贴 Y 轴刻度左侧，垂直旋转，Percentage / Count */}
      <text
        x={PLOT_LEFT - 32}
        y={PLOT_TOP + PLOT_H / 2}
        textAnchor="middle"
        fontSize={8}
        fontWeight={600}
        fill="currentColor"
        transform={`rotate(-90 ${PLOT_LEFT - 32} ${PLOT_TOP + PLOT_H / 2})`}
      >
        {s.showPercentage ? 'Percentage' : 'Count'}
      </text>

      {/* Y 网格 + 刻度：实线在刻度处，虚线在每两刻度间均匀加3条浅灰虚线（20→40 间 25/30/35 等） */}
      {yTicks.map((t) => {
        const y = barY(t);
        return (
          <g key={t}>
            <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={t === 0 ? 0.9 : 0.85} strokeWidth={1} />
            <text x={PLOT_LEFT - 12} y={y + 3.5} textAnchor="end" fontSize={9} fontWeight={500} fill="currentColor">{t}</text>
          </g>
        );
      })}
      {yTicks.slice(0, -1).map((t) =>
        yMinorFracs.map((frac) => {
          const v = t + yStep * frac;
          if (v >= yMax - 1e-9) return null;
          const y = barY(v);
          return <line key={`y-light-${t}-${frac}`} x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.18} strokeWidth={1} />;
        }),
      )}
      {/* 绘图区上边框 */}
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_TOP} y2={PLOT_TOP} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />

      {/* 直方柱（超出 Y 轴上限部分被裁剪，对齐 OPP） */}
      <g clipPath="url(#cpk-plot-clip)">
      {bins.map((b, i) => {
        // 对齐 OPP：bar 中心在 bin 中心、宽 1 bin → 起点左移半个 bin 宽（柱身会压过规格限红线）
        const x = mapX(plo, phi, b.x0) - binW / 2;
        const y = barY(yVal(b.count, b.percent));
        const h = Math.max(0, PLOT_BOTTOM - y);
        return (
          <g key={i}>
            <rect x={x} y={y} width={Math.max(1, binW)} height={h} fill="currentColor" opacity={1} stroke={s.showOutlines ? 'currentColor' : 'none'} strokeWidth={s.showOutlines ? 0.75 : 0}>
              <title>{`${formatTick(b.x0)} ~ ${formatTick(b.x1)}: ${b.count} (${b.percent.toFixed(2)}%)`}</title>
            </rect>
            {s.showCounts && h > 0 && (
              // Percentage 模式柱顶显示占比百分数（整数），Count 模式显示样本数
              <text x={x + binW / 2} y={y - 4} textAnchor="middle" fontSize={8} fontWeight={600} fill="currentColor">{s.showPercentage ? Math.round(b.percent) : b.count}</text>
            )}
          </g>
        );
      })}
      </g>

      {/* 规格限红线 */}
      {s.showLimits && column.upper !== null && mapX(plo, phi, column.upper) >= PLOT_LEFT && mapX(plo, phi, column.upper) <= PLOT_RIGHT && (
        <line x1={mapX(plo, phi, column.upper)} x2={mapX(plo, phi, column.upper)} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke={SPEC_COLOR} strokeWidth={3} />
      )}
      {s.showLimits && column.lower !== null && mapX(plo, phi, column.lower) >= PLOT_LEFT && mapX(plo, phi, column.lower) <= PLOT_RIGHT && (
        <line x1={mapX(plo, phi, column.lower)} x2={mapX(plo, phi, column.lower)} y1={PLOT_TOP} y2={PLOT_BOTTOM} stroke={SPEC_COLOR} strokeWidth={3} />
      )}
      {s.showLimits && !hasLimits && (
        <text x={PLOT_RIGHT - 6} y={PLOT_TOP + 13} textAnchor="end" fontSize={9} fontWeight={500} fill="currentColor">[ NO SPEC LIMITS ]</text>
      )}

      {/* X 轴主线 */}
      <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM} stroke="currentColor" strokeWidth={1.75} />
      {/* X 小刻度线 */}
      {xMinorTicks.map((v) => (
        <line key={'minor-' + v} x1={mapX(plo, phi, v)} x2={mapX(plo, phi, v)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 2.5} stroke="currentColor" strokeWidth={0.75} />
      ))}
      {/* X 主刻度 */}
      {xTicks.map((t) => (
        <g key={t}>
          <line x1={mapX(plo, phi, t)} x2={mapX(plo, phi, t)} y1={PLOT_BOTTOM} y2={PLOT_BOTTOM + 5} stroke="currentColor" strokeWidth={1} />
          <text x={mapX(plo, phi, t)} y={PLOT_BOTTOM + 16} textAnchor="middle" fontSize={9} fontWeight={500} fill="currentColor">{formatTick(t)}</text>
        </g>
      ))}
      {column.unit && (
        <text x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={PLOT_BOTTOM + 32} textAnchor="middle" fontSize={9.5} fontWeight={500} fill="currentColor">{column.unit}</text>
      )}
    </svg>
  );
};

export default CpkHistogram;
// CPK 过程能力直方图（SVG 自绘，样式对齐测试系统截图分析：
// 标题 + 左侧统计块 + 相对频率直方图 + 红色规格限线）
import React from 'react';
import {
  type ColumnAnalysis,
  formatIndex,
  formatValue,
} from '../lib/stats';

const W = 980;
const H = 330;
const PLOT_LEFT = 210;
const PLOT_RIGHT = 950;
const PLOT_TOP = 44;
const PLOT_BOTTOM = 252;
const PLOT_W = PLOT_RIGHT - PLOT_LEFT;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;
const SPEC_COLOR = '#ef4444';
const Y_TICKS = [0, 20, 40, 60, 80, 100];

/** X 轴像素映射（绘图域 [lo, hi] → [PLOT_LEFT, PLOT_RIGHT]）。 */
const mapX = (lo: number, hi: number, v: number): number =>
  PLOT_LEFT + ((v - lo) / (hi - lo)) * PLOT_W;

/** Y 轴像素映射（相对频率 % → 像素，0% 在底部）。 */
const mapY = (pct: number): number => PLOT_BOTTOM - (pct / 100) * PLOT_H;

interface CpkHistogramProps {
  analysis: ColumnAnalysis;
}

/**
 * 生成 X 轴 nice 刻度（约 5 个）。
 */
function ticksFor(lo: number, hi: number): number[] {
  const span = hi - lo;
  let step = span / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / pow;
  step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * pow;
  const ticks: number[] = [];
  const start = Math.floor(lo / step) * step;
  for (let v = start; v <= hi + step * 1e-6; v += step) {
    if (v >= lo - step * 1e-6) ticks.push(v);
    if (ticks.length >= 8) break;
  }
  return ticks;
}

const CpkHistogram: React.FC<CpkHistogramProps> = ({ analysis }) => {
  const { column, stat, bins, domain, hasLimits } = analysis;
  const [dlo, dhi] = domain;

  const xTicks = ticksFor(dlo, dhi);
  const binW = bins.length > 0 ? Math.max(1.5, PLOT_W / bins.length - 0.5) : 2;
  const unitSuffix = column.unit ? ` (${column.unit})` : '';

  const stats: Array<{ label: string; value: string }> = [
    { label: 'Data Count', value: String(stat.count) },
    { label: 'NA Count', value: String(stat.naCount) },
    {
      label: 'Failure Count',
      value: `${stat.failureCount} (${stat.failureRate.toFixed(2)}%)`,
    },
    { label: 'Max', value: formatValue(stat.max) },
    { label: 'Min', value: formatValue(stat.min) },
    { label: 'Mean', value: formatValue(stat.mean) },
    { label: 'Std. Dev.', value: formatValue(stat.stdDev) },
    { label: 'Cpu', value: formatIndex(stat.cpu) },
    { label: 'Cpl', value: formatIndex(stat.cpl) },
    { label: 'Cpk', value: formatIndex(stat.cpk) },
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="font-mono text-foreground"
      role="img"
      aria-label={`${column.name} CPK 直方图`}
    >
      <title>{column.name}</title>

      {/* 标题 */}
      <text
        x={W / 2}
        y={16}
        textAnchor="middle"
        fontSize={12}
        fill="currentColor"
      >
        {column.name}{unitSuffix}
      </text>

      {/* 左侧统计块 */}
      {stats.map((s, i) => {
        const y = 36 + i * 22;
        return (
          <g key={s.label}>
            <text
              x={18}
              y={y}
              fontSize={11}
              fill="currentColor"
              opacity={0.55}
            >
              {s.label}
            </text>
            <text
              x={PLOT_LEFT - 10}
              y={y}
              textAnchor="end"
              fontSize={11}
              fill="currentColor"
              fontWeight={s.label === 'Cpk' ? 700 : 400}
            >
              {s.value}
            </text>
          </g>
        );
      })}

      {/* 绘图区背景与边框 */}
      <rect
        x={PLOT_LEFT}
        y={PLOT_TOP}
        width={PLOT_W}
        height={PLOT_H}
        fill="transparent"
        stroke="none"
      />
      {/* 上边框 */}
      <line
        x1={PLOT_LEFT}
        x2={PLOT_RIGHT}
        y1={PLOT_TOP}
        y2={PLOT_TOP}
        stroke="currentColor"
        strokeOpacity={0.5}
        strokeWidth={1}
      />

      {/* Y 轴网格线 + 刻度标签 */}
      {Y_TICKS.map((t) => {
        const y = mapY(t);
        return (
          <g key={t}>
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={t === 0 ? 0.8 : 0.18}
              strokeWidth={1}
            />
            <text
              x={PLOT_LEFT - 12}
              y={y + 4}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              opacity={0.7}
            >
              {t}
            </text>
          </g>
        );
      })}
      {/* Y 轴名 */}
      <text
        x={16}
        y={(PLOT_TOP + PLOT_BOTTOM) / 2}
        fontSize={10}
        fill="currentColor"
        opacity={0.6}
        transform={`rotate(-90 16 ${(PLOT_TOP + PLOT_BOTTOM) / 2})`}
        textAnchor="middle"
      >
        Percent %
      </text>

      {/* 直方柱 */}
      {bins.map((b, i) => {
        const x = mapX(dlo, dhi, b.x0);
        const y = mapY(b.percent);
        const h = PLOT_BOTTOM - y;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={Math.max(1, binW)}
            height={Math.max(0, h)}
            fill="currentColor"
            opacity={0.9}
          >
            <title>
              {`${formatValue(b.x0)} ~ ${formatValue(b.x1)}: ${b.count} 个 (${b.percent.toFixed(2)}%)`}
            </title>
          </rect>
        );
      })}

      {/* 规格限红线 */}
      {column.upper !== null && mapX(dlo, dhi, column.upper) >= PLOT_LEFT && mapX(dlo, dhi, column.upper) <= PLOT_RIGHT && (
        <g>
          <line
            x1={mapX(dlo, dhi, column.upper)}
            x2={mapX(dlo, dhi, column.upper)}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
            stroke={SPEC_COLOR}
            strokeWidth={2}
          />
          <text
            x={mapX(dlo, dhi, column.upper)}
            y={PLOT_TOP - 6}
            textAnchor="middle"
            fontSize={10}
            fill={SPEC_COLOR}
          >
            USL {formatValue(column.upper)}
          </text>
        </g>
      )}
      {column.lower !== null && mapX(dlo, dhi, column.lower) >= PLOT_LEFT && mapX(dlo, dhi, column.lower) <= PLOT_RIGHT && (
        <g>
          <line
            x1={mapX(dlo, dhi, column.lower)}
            x2={mapX(dlo, dhi, column.lower)}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
            stroke={SPEC_COLOR}
            strokeWidth={2}
          />
          <text
            x={mapX(dlo, dhi, column.lower)}
            y={PLOT_BOTTOM + 14}
            textAnchor="middle"
            fontSize={10}
            fill={SPEC_COLOR}
          >
            LSL {formatValue(column.lower)}
          </text>
        </g>
      )}
      {!hasLimits && (
        <text
          x={PLOT_RIGHT - 8}
          y={PLOT_TOP + 14}
          textAnchor="end"
          fontSize={10}
          fill="currentColor"
          opacity={0.5}
        >
          [ NO SPEC LIMITS ]
        </text>
      )}

      {/* X 轴 */}
      <line
        x1={PLOT_LEFT}
        x2={PLOT_RIGHT}
        y1={PLOT_BOTTOM}
        y2={PLOT_BOTTOM}
        stroke="currentColor"
        strokeWidth={1.5}
      />
      {xTicks.map((t) => (
        <g key={t}>
          <line
            x1={mapX(dlo, dhi, t)}
            x2={mapX(dlo, dhi, t)}
            y1={PLOT_BOTTOM}
            y2={PLOT_BOTTOM + 4}
            stroke="currentColor"
            strokeWidth={1}
          />
          <text
            x={mapX(dlo, dhi, t)}
            y={PLOT_BOTTOM + 16}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            opacity={0.7}
          >
            {formatValue(t)}
          </text>
        </g>
      ))}
      {column.unit && (
        <text
          x={(PLOT_LEFT + PLOT_RIGHT) / 2}
          y={PLOT_BOTTOM + 34}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          opacity={0.7}
        >
          {column.unit}
        </text>
      )}
    </svg>
  );
};

export default CpkHistogram;


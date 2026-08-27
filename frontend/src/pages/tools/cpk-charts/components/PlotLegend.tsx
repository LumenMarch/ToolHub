// 图例（SVG 内嵌）— 对齐 OPP CorePlot CPTLegend：按位置放在绘图区内，条目=颜色块+文本
// 位置：None/TopRight/BottomRight/TopLeft/BottomLeft；Show Legend Counts 时附加样本数
import React from 'react';
import { PLOT_BOTTOM, PLOT_LEFT, PLOT_RIGHT, PLOT_TOP } from '../lib/layout';

export interface LegendEntry {
  label: string;
  color: string;
  count?: number;
}

interface PlotLegendProps {
  entries: LegendEntry[];
  position: 'none' | 'topright' | 'bottomright' | 'topleft' | 'bottomleft';
  showCounts: boolean;
}

const PlotLegend: React.FC<PlotLegendProps> = ({ entries, position, showCounts }) => {
  if (position === 'none' || entries.length === 0) return null;
  const itemH = 14;
  const longest = entries.reduce((mx, e) => {
    const label = e.label.length + (showCounts && e.count !== undefined ? 1 + String(e.count).length : 0);
    return Math.max(mx, label);
  }, 6);
  const boxW = Math.min(220, Math.max(64, longest * 5.6 + 22));
  const boxH = entries.length * itemH + 9;
  const bx = position === 'topright' || position === 'bottomright' ? PLOT_RIGHT - boxW - 6 : PLOT_LEFT + 6;
  const by = position === 'topright' || position === 'topleft' ? PLOT_TOP + 6 : PLOT_BOTTOM - boxH - 6;
  return (
    <g>
      <rect x={bx} y={by} width={boxW} height={boxH} fill="rgba(255,255,255,0.88)" stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} />
      {entries.map((e, i) => {
        const y = by + 10 + i * itemH;
        const label = showCounts && e.count !== undefined ? `${e.label} (${e.count})` : e.label;
        return (
          <g key={e.label}>
            <rect x={bx + 6} y={y - 6} width={8} height={8} fill={e.color} stroke={e.color} strokeWidth={1} />
            <text x={bx + 20} y={y} fontSize={9} fontWeight={500} fill="currentColor">{label}</text>
          </g>
        );
      })}
    </g>
  );
};

export default PlotLegend;

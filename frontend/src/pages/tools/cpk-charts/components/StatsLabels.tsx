// 图内左侧统计文本块 — 对齐 OPP generateHistogramLabels / theLabelArray + displayStats
// Data Count / NA Count / Failure Count / Max / Min / Mean / Std. Dev. / Cpu / Cpl / Cpk（直方图/CDF/TimeSeries 共用）
import React from 'react';
import { formatIndex, formatValue, type ColumnStat } from '../lib/stats';
import { SPEC_COLOR } from '../lib/layout';

interface StatsLabelsProps {
  stat: ColumnStat;
}

const StatsLabels: React.FC<StatsLabelsProps> = ({ stat }) => {
  const items: Array<{ label: string; value: string; w: number }> = [
    { label: 'Data Count', value: String(stat.count), w: 500 },
    { label: 'NA Count', value: String(stat.naCount), w: 500 },
    { label: 'Failure Count', value: `${stat.failureCount} (${stat.failureRate.toFixed(2)}%)`, w: 500 },
    { label: 'Max', value: formatValue(stat.max), w: 500 },
    { label: 'Min', value: formatValue(stat.min), w: 500 },
    { label: 'Mean', value: formatValue(stat.mean), w: 500 },
    { label: 'Std. Dev.', value: formatValue(stat.stdDev), w: 500 },
    { label: 'Cpu', value: formatIndex(stat.cpu), w: 500 },
    { label: 'Cpl', value: formatIndex(stat.cpl), w: 500 },
    { label: 'Cpk', value: formatIndex(stat.cpk), w: 700 },
  ];
  return (
    <>
      {items.map((item, i) => {
        const y = 29 + i * 20;
        const isFailure = item.label === 'Failure Count' && stat.failureCount > 0;
        return (
          <text key={item.label} x={14} y={y} fontSize={10} fontWeight={item.w} fill={isFailure ? SPEC_COLOR : 'currentColor'} className="tabular-nums">
            {item.label}: {item.value}
          </text>
        );
      })}
    </>
  );
};

export default StatsLabels;

// 图表下方的统计区：单测试项统计网格 + A/B 对比指标表。
import React from 'react';

import type { ActiveAnalysis } from '../lib/dataset';
import { formatIndex, formatValue, type ColumnAnalysis } from '../lib/stats';

const STAT_ROWS = ['Cpk', 'Cpu', 'Cpl', 'Mean', 'Std. Dev.', 'Data Count', 'Failure Count'] as const;

interface WorkspaceStatsProps {
  activeCol: ColumnAnalysis | null;
  activeA: ActiveAnalysis | null;
  activeB: ActiveAnalysis | null;
  isCorr: boolean;
  compareMode: boolean;
  hasBothDatasets: boolean;
}

/** 单测试项统计网格（histogram/cdf/timeseries，非双数据集对比时显示）。 */
const SingleStats: React.FC<{ analysis: ColumnAnalysis }> = ({ analysis }) => (
  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
    {[
      { label: 'Data Count', value: String(analysis.stat.count) },
      { label: 'NA Count', value: String(analysis.stat.naCount) },
      {
        label: 'Failure Count',
        value: `${analysis.stat.failureCount} (${analysis.stat.failureRate.toFixed(2)}%)`,
      },
      { label: 'Cpk', value: formatIndex(analysis.stat.cpk) },
      { label: 'Mean', value: formatValue(analysis.stat.mean) },
      { label: 'Std. Dev.', value: formatValue(analysis.stat.stdDev) },
      { label: 'Cpu', value: formatIndex(analysis.stat.cpu) },
      { label: 'Cpl', value: formatIndex(analysis.stat.cpl) },
    ].map((metric) => (
      <div key={metric.label} className="bg-background p-3">
        <p className="text-[0.625rem] text-muted-foreground">{metric.label}</p>
        <p className="mt-1 text-sm font-medium tabular-nums">{metric.value}</p>
      </div>
    ))}
  </div>
);

/** 对比表单元格取值：模块级纯函数，避免每次渲染重建。 */
function pickStat(analysis: ActiveAnalysis, row: (typeof STAT_ROWS)[number]): string {
  const stat = analysis.analysis.stat;
  if (row === 'Cpk') return formatIndex(stat.cpk);
  if (row === 'Cpu') return formatIndex(stat.cpu);
  if (row === 'Cpl') return formatIndex(stat.cpl);
  if (row === 'Mean') return formatValue(stat.mean);
  if (row === 'Std. Dev.') return formatValue(stat.stdDev);
  if (row === 'Data Count') return String(stat.count);
  return `${stat.failureCount} (${stat.failureRate.toFixed(2)}%)`;
}

/** 对比模式：A/B 指标并排表。 */
const CompareStats: React.FC<{ activeA: ActiveAnalysis; activeB: ActiveAnalysis }> = ({
  activeA,
  activeB,
}) => {

  return (
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
          {STAT_ROWS.map((row) => (
            <tr key={row} className="border-b border-border last:border-b-0">
              <td className="px-3 py-1.5 text-muted-foreground">{row}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{pickStat(activeA, row)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{pickStat(activeB, row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const WorkspaceStats: React.FC<WorkspaceStatsProps> = ({
  activeCol,
  activeA,
  activeB,
  isCorr,
  compareMode,
  hasBothDatasets,
}) => {
  if (isCorr) return null;
  if (compareMode && activeA && activeB) {
    return <CompareStats activeA={activeA} activeB={activeB} />;
  }
  if (activeCol && !(compareMode && hasBothDatasets)) {
    return <SingleStats analysis={activeCol} />;
  }
  return null;
};

export default WorkspaceStats;

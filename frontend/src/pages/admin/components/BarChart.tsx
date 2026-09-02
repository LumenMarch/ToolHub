import React from 'react';

interface BarChartProps {
  data: Array<{ label: string; value: number; actions?: string[] }>;
  emptyHint?: string;
}

const BarChart: React.FC<BarChartProps> = ({ data, emptyHint = '暂无数据' }) => {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  // 柱状图横向排列，高度按比例。flex-1 让柱子自适应容器宽度，
  // max-w 限制单柱过宽（宽屏下柱组居中，不水平拉伸变形）。
  return (
    <div className="flex h-[200px] w-full items-end justify-center gap-3 md:gap-4">
      {data.map((d) => {
        const heightPct = maxValue > 0 ? (d.value / maxValue) * 100 : 0;
        return (
          <div
            key={d.label}
            className="group flex h-full min-w-0 max-w-[120px] flex-1 flex-col items-center justify-end"
            title={
              d.actions && d.actions.length > 1
                ? `${d.label}: ${d.value} (${d.actions.join(' + ')})`
                : `${d.label}: ${d.value}`
            }
          >
            <span className="mb-2 text-xs tabular-nums text-muted-foreground transition-colors group-hover:text-primary">
              {d.value}
            </span>
            <div
              className="min-h-[2px] w-full rounded-t-sm bg-muted transition-colors group-hover:bg-primary"
              style={{ height: `${heightPct}%` }}
            />
            <span className="mt-2 max-w-full truncate text-center text-xs text-muted-foreground">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default BarChart;

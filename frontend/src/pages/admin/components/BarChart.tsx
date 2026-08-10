import React from 'react';

interface BarChartProps {
  data: Array<{ label: string; value: number; actions?: string[] }>;
  emptyHint?: string;
}

const BarChart: React.FC<BarChartProps> = ({ data, emptyHint = '暂无数据' }) => {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="h-[200px] flex items-center justify-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground opacity-60">
        {emptyHint}
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  // 柱状图横向排列，高度按比例。flex-1 让柱子自适应容器宽度，
  // max-w 限制单柱过宽（宽屏下柱组居中，不水平拉伸变形）。
  return (
    <div className="h-[200px] w-full flex items-end justify-center gap-3 md:gap-4">
      {data.map((d) => {
        const heightPct = maxValue > 0 ? (d.value / maxValue) * 100 : 0;
        return (
          <div
            key={d.label}
            className="flex-1 min-w-0 max-w-[120px] flex flex-col items-center justify-end h-full group"
            title={
              d.actions && d.actions.length > 1
                ? `${d.label}: ${d.value} (${d.actions.join(' + ')})`
                : `${d.label}: ${d.value}`
            }
          >
            <span className="text-[11px] font-mono mb-2 opacity-70 group-hover:opacity-100 group-hover:text-primary transition-[opacity,color]">
              {d.value}
            </span>
            <div
              className="w-full bg-muted group-hover:bg-primary transition-colors min-h-[2px]"
              style={{ height: `${heightPct}%` }}
            />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-2 text-center truncate max-w-full">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default BarChart;

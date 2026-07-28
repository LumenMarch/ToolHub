import React from 'react';

interface TrendChartProps {
  data: Array<{ date: string; count: number }>;
  emptyHint?: string;
}

const TrendChart: React.FC<TrendChartProps> = ({ data, emptyHint = '暂无数据' }) => {
  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="h-[200px] flex items-center justify-center text-[11px] font-mono uppercase tracking-widest text-muted-foreground opacity-60">
        {emptyHint}
      </div>
    );
  }

  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const maxValue = Math.max(...data.map((d) => d.count), 1);
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  // 各点坐标。
  const points = data.map((d, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + innerHeight - (d.count / maxValue) * innerHeight,
    ...d,
  }));

  // 折线路径。
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // 填充区域路径（折线 + 底部封闭）。
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`
      : '';

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[200px] min-w-[400px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* 水平网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + innerHeight - ratio * innerHeight;
          return (
            <line
              key={ratio}
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="currentColor"
              strokeWidth="0.5"
              className="text-border"
            />
          );
        })}

        {/* 填充区域 */}
        {areaPath && (
          <path d={areaPath} className="fill-primary opacity-10" />
        )}

        {/* 折线 */}
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-primary"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* 数据点 */}
        {points.map((p) => (
          <g key={p.date}>
            <circle
              cx={p.x}
              cy={p.y}
              r="2.5"
              className="fill-primary"
            />
            <title>{`${p.date}: ${p.count}`}</title>
          </g>
        ))}

        {/* X 轴日期标签（稀疏显示，避免重叠） */}
        {points.map((p, i) => {
          // 数据点多时隔几个显示一个。
          const skip = data.length > 10 ? 2 : 1;
          if (i % skip !== 0 && i !== data.length - 1) return null;
          const dateLabel = p.date.slice(5); // MM-DD
          return (
            <text
              key={`label-${p.date}`}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted-foreground font-mono"
              style={{ fontSize: '10px' }}
            >
              {dateLabel}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

export default TrendChart;

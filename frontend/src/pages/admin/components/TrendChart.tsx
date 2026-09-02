import React, { useLayoutEffect, useRef, useState } from 'react';

interface TrendChartProps {
  data: Array<{ date: string; count: number }>;
  emptyHint?: string;
}

const CHART_PADDING = { top: 20, right: 20, bottom: 30, left: 36 };

const TrendChart: React.FC<TrendChartProps> = ({ data, emptyHint = '暂无数据' }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // SVG 宽度跟随容器动态测量（viewBox 宽 = 实际宽度），
  // 避免固定 viewBox 在宽屏下被缩放/留白、文字随宽度放大。
  const [width, setWidth] = useState(600);

  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        {emptyHint}
      </div>
    );
  }

  const height = 200;
  const innerWidth = width - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = height - CHART_PADDING.top - CHART_PADDING.bottom;

  // Y 轴最大值取整到美观刻度（1/2/5 × 10^n 的倍数），保证刻度为整数、可整除，避免小数刻度。
  const rawMax = Math.max(...data.map((d) => d.count), 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const niceStep = [1, 2, 5, 10].find((m) => rawMax < m * magnitude * 4) ?? 10;
  const step = niceStep * magnitude;
  const maxValue = Math.ceil(rawMax / step) * step;
  // Y 轴刻度序列（0 到 maxValue，2-4 个刻度区间）。
  const yTicks = Array.from({ length: maxValue / step + 1 }, (_, i) => i * step);
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  // 各点坐标。
  const points = data.map((d, i) => ({
    x: CHART_PADDING.left + i * stepX,
    y: CHART_PADDING.top + innerHeight - (d.count / maxValue) * innerHeight,
    ...d,
  }));

  // 折线路径。
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // 填充区域路径（折线 + 底部封闭）。
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${CHART_PADDING.top + innerHeight} L ${points[0].x} ${CHART_PADDING.top + innerHeight} Z`
      : '';

  return (
    <div className="w-full overflow-x-auto">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="h-[200px] w-full min-w-[400px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y 轴刻度值 + 水平网格线（低透明度，辅助阅读） */}
        {yTicks.map((tick) => {
          const y = CHART_PADDING.top + innerHeight - (tick / maxValue) * innerHeight;
          return (
            <g key={tick}>
              <text
                x={CHART_PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                style={{ fontSize: '10px' }}
              >
                {tick}
              </text>
              <line
                x1={CHART_PADDING.left}
                y1={y}
                x2={width - CHART_PADDING.right}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                className="text-border opacity-40"
              />
            </g>
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

        {/* 数据点 + 数值标注（hover 时数值与点位一起高亮） */}
        {points.map((p) => (
          <g key={p.date} className="group cursor-pointer">
            <title>{`${p.date}: ${p.count}`}</title>
            {/* 点位上方数值标注，常显；hover 时变 primary（对齐 BarChart 交互） */}
            <text
              x={p.x}
              y={p.y - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px] opacity-70 transition-[fill,opacity] group-hover:fill-primary group-hover:opacity-100"
            >
              {p.count}
            </text>
            {/* 数据点本体 */}
            <circle cx={p.x} cy={p.y} r="2.5" className="fill-primary" />
            {/* hover 高亮光晕 */}
            <circle
              cx={p.x}
              cy={p.y}
              r="5"
              className="fill-primary opacity-0 transition-opacity group-hover:opacity-25"
            />
            {/* 扩大 hover 命中区域，便于悬停 */}
            <circle cx={p.x} cy={p.y} r="8" className="fill-transparent" />
          </g>
        ))}

        {/* X 轴日期标签（按可用宽度估算密度，避免重叠） */}
        {points.map((p, i) => {
          // 每个标签约需 28px，按内宽折算隔几个显示一个。
          const labelStep = Math.max(1, Math.ceil((data.length * 28) / innerWidth));
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          const dateLabel = p.date.slice(5); // MM-DD
          return (
            <text
              key={`label-${p.date}`}
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted-foreground"
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

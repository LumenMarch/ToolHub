import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

import { useTheme } from '../../../context/ThemeContext';
import type { Bin, CdfPoint } from './lib';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, SVGRenderer]);

/**
 * TT 时间计算 — 图表组件。
 * 配色跟随 resolvedTheme（浅/深色）；ECharts 对 oklch 支持不佳，全部用固定 hex。
 */

interface Palette {
  foreground: string;
  muted: string;
  border: string;
  card: string;
  primary: string;
  grid: string;
}

const LIGHT: Palette = {
  foreground: '#18181b',
  muted: '#52525b',
  border: '#e4e4e7',
  card: '#ffffff',
  primary: '#2563eb',
  grid: '#e4e4e7',
};

const DARK: Palette = {
  foreground: '#f4f4f5',
  muted: '#a1a1aa',
  border: '#27272a',
  card: '#18181b',
  primary: '#3b82f6',
  grid: '#3f3f46',
};

/** 生成复用 ECharts 实例 + 尺寸自适应 */
const useEchart = (option: EChartsOption | null, deps: unknown[]) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (option) chartRef.current?.setOption(option, true);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return containerRef;
};

const axisStyle = (p: Palette) => ({
  axisLine: { lineStyle: { color: p.border } },
  axisLabel: { color: p.muted },
  splitLine: { lineStyle: { color: p.grid } },
});

/** 模式：X 轴数值为占比(%)或样本数(Count)，Y 轴类别 = 时间分箱 */
export type HistogramMode = 'percent' | 'count';

interface HistogramProps {
  bins: Bin[];
  mode: HistogramMode;
  className?: string;
  /** 图表高度（像素），由父层按桶数自适应 */
  height?: number;
}

/** 横向分布柱状图：Y = 测试时间分箱，X = 占比/Count，柱顶标注占比 */
export const TtHistogramChart: React.FC<HistogramProps> = ({
  bins,
  mode,
  className,
  height = 360,
}) => {
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === 'dark' ? DARK : LIGHT;

  // --- 自适应：图大小固定，柱宽与字号随桶数变化 ---
  const n = bins.length;
  // 每类的可用垂直空间（px）
  const perCat = height / Math.max(n, 1);
  // 柱子宽度：桶少时尽量粗，桶多时收细（6~34px）
  const barWidth = Math.max(6, Math.min(34, perCat * 0.7));
  // 柱顶占比字号：桶越多越小
  const barLabelFont = n <= 8 ? 12 : n <= 15 ? 11 : n <= 24 ? 10 : n <= 40 ? 9 : 8;
  // Y 轴时间标签字号
  const axisLabelFont = n <= 15 ? 12 : n <= 30 ? 11 : 10;
  // 桶特别多时隐藏柱顶文字，避免互相重叠看不清
  const showBarLabel = n <= 40;

  const option = useEchart(
    bins.length === 0
      ? null
      : {
          animation: false,
          grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
          tooltip: {
            trigger: 'item',
            confine: true,
            backgroundColor: p.card,
            borderColor: p.border,
            borderWidth: 1,
            textStyle: { color: p.foreground, fontSize: 12 },
            formatter: (params: unknown) => {
              const i = (params as { dataIndex: number }).dataIndex;
              const b = bins[i];
              if (!b) return '';
              return (
                `<b>${b.label}</b><br/>` +
                `样本数：${b.count}<br/>` +
                `占比：${b.percent.toFixed(1)}%`
              );
            },
          },
          xAxis: {
            type: 'value',
            name: mode === 'percent' ? '占比 (%)' : '样本数',
            nameTextStyle: { color: p.muted },
            ...axisStyle(p),
            axisLabel: {
              color: p.muted,
              formatter: (v: number) =>
                mode === 'percent' ? `${v.toFixed(0)}%` : String(v),
            },
          },
          yAxis: {
            type: 'category',
            data: bins.map((b) => b.label),
            ...axisStyle(p),
            axisLabel: { color: p.muted, fontSize: axisLabelFont },
          },
          series: [
            {
              type: 'bar',
              data: bins.map((b) => (mode === 'percent' ? b.percent : b.count)),
              barMaxWidth: 34,
              barWidth,
              itemStyle: { color: p.primary, borderRadius: [0, 4, 4, 0] },
              label: {
                show: showBarLabel,
                position: 'right',
                color: p.foreground,
                fontSize: barLabelFont,
                formatter: (params: unknown) => {
                  const i = (params as { dataIndex: number }).dataIndex;
                  const b = bins[i];
                  if (!b) return '';
                  return mode === 'percent'
                    ? `${b.percent.toFixed(1)}%`
                    : `${b.count} (${b.percent.toFixed(1)}%)`;
                },
              },
            },
          ],
        } as EChartsOption,
    [bins, mode, resolvedTheme],
  );

  return <div ref={option} className={className} style={{ height }} />;
};

interface CdfProps {
  points: CdfPoint[];
  className?: string;
  height?: number;
}

/** 累计分布曲线：X = 测试时间(S)，Y = 累计占比(%) */
export const TtCdfChart: React.FC<CdfProps> = ({
  points,
  className,
  height = 320,
}) => {
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === 'dark' ? DARK : LIGHT;

  const option = useEchart(
    points.length === 0
      ? null
      : {
          animation: false,
          grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
          tooltip: {
            trigger: 'axis',
            confine: true,
            backgroundColor: p.card,
            borderColor: p.border,
            borderWidth: 1,
            textStyle: { color: p.foreground, fontSize: 12 },
          },
          xAxis: {
            type: 'value',
            name: '测试时间 (S)',
            nameTextStyle: { color: p.muted },
            ...axisStyle(p),
            axisLabel: { color: p.muted },
          },
          yAxis: {
            type: 'value',
            name: '累计占比 (%)',
            nameTextStyle: { color: p.muted },
            min: 0,
            max: 100,
            ...axisStyle(p),
            axisLabel: { color: p.muted, formatter: (v: number) => `${v}%` },
          },
          series: [
            {
              type: 'line',
              data: points.map((pt) => [pt.x, pt.y]),
              step: 'end',
              symbol: 'none',
              lineStyle: { color: p.primary, width: 2 },
              itemStyle: { color: p.primary },
              areaStyle: {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: 'rgba(37,99,235,0.25)' },
                    { offset: 1, color: 'rgba(37,99,235,0.02)' },
                  ],
                },
              },
            },
          ],
        } as EChartsOption,
    [points, resolvedTheme],
  );

  return <div ref={option} className={className} style={{ height }} />;
};

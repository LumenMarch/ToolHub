import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, BoxplotChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

import { useTheme } from '../../../context/ThemeContext';
import type {
  Bin,
  ComparisonReferenceLine,
  StationBoxGroup,
} from './lib';
import { formatStationNumericName } from './lib';

echarts.use([
  BarChart,
  LineChart,
  BoxplotChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  TitleComponent,
  DataZoomComponent,
  SVGRenderer,
]);
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

/** 横向柱状图自适应：柱宽与字号随桶数变化 */
const layoutFor = (bins: Bin[], height: number) => {
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
  return { barWidth, barLabelFont, axisLabelFont, showBarLabel };
};

/** 构造分布柱状图的 ECharts option（纯函数） */
const buildHistogramOption = (
  bins: Bin[],
  mode: HistogramMode,
  height: number,
  p: Palette,
): EChartsOption | null => {
  if (bins.length === 0) return null;
  const { barWidth, barLabelFont, axisLabelFont, showBarLabel } = layoutFor(bins, height);
  return {
    animation: false,
    grid: { left: 16, right: 60, top: 16, bottom: 16, containLabel: true },
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
        formatter: (v: number) => (mode === 'percent' ? `${v.toFixed(0)}%` : String(v)),
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
  } as EChartsOption;
};

/** 横向分布柱状图：Y = 测试时间分箱，X = 占比/Count，柱顶标注占比 */
export const TtHistogramChart: React.FC<HistogramProps> = ({
  bins,
  mode,
  className,
  height = 360,
}) => {
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === 'dark' ? DARK : LIGHT;
  const option = useEchart(buildHistogramOption(bins, mode, height, p), [
    bins,
    mode,
    resolvedTheme,
  ]);
  return <div ref={option} className={className} style={{ height }} />;
};

interface PercentCurveProps {
  bins: Bin[];
  className?: string;
  height?: number;
}

/** 构造测试时间占比趋势曲线的 ECharts option（纯函数） */
const buildPercentCurveOption = (
  bins: Bin[],
  p: Palette,
): EChartsOption | null => {
  if (bins.length === 0) return null;
  const categories = bins.map((b) => b.label);
  const data = bins.map((b) => b.percent);

  return {
    animation: false,
    grid: { left: 16, right: 32, top: 24, bottom: 24, containLabel: true },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: p.card,
      borderColor: p.border,
      borderWidth: 1,
      textStyle: { color: p.foreground, fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = params as Array<{ dataIndex: number }>;
        if (!arr || arr.length === 0) return '';
        const idx = arr[0].dataIndex;
        const b = bins[idx];
        if (!b) return '';
        return (
          `<div style="font-weight:bold;margin-bottom:4px">时间区间: ${b.label}</div>` +
          `<div>区间占比: <span style="font-weight:bold;color:#2563eb">${b.percent}%</span></div>` +
          `<div>样本数量: <span style="color:${p.muted}">${b.count}</span></div>`
        );
      },
    },
    xAxis: {
      type: 'category',
      name: '测试时间',
      nameTextStyle: { color: p.muted },
      data: categories,
      ...axisStyle(p),
      axisLabel: {
        color: p.muted,
        interval: categories.length > 15 ? 'auto' : 0,
        rotate: categories.length > 10 ? 30 : 0,
        fontSize: 11,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '占比 (%)',
      nameTextStyle: { color: p.muted },
      min: 0,
      ...axisStyle(p),
      axisLabel: { color: p.muted, formatter: (v: number) => `${v}%` },
      splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
    },
    series: [
      {
        name: '占比',
        type: 'line',
        data: data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: p.primary, width: 2.5 },
        itemStyle: { color: p.primary },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(37,99,235,0.28)' },
              { offset: 1, color: 'rgba(37,99,235,0.02)' },
            ],
          },
        },
      },
    ],
  } as EChartsOption;
};

/** 测试时间占比趋势曲线：X = 时间区间，Y = 占比(%) */
export const TtPercentCurveChart: React.FC<PercentCurveProps> = ({
  bins,
  className,
  height = 320,
}) => {
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === 'dark' ? DARK : LIGHT;
  const option = useEchart(buildPercentCurveOption(bins, p), [bins, resolvedTheme]);
  return <div ref={option} className={className} style={{ height }} />;
};

export interface StationBoxPlotHandle {
  exportPng: (baseName: string) => Promise<void>;
}

interface StationBoxPlotProps {
  groups: StationBoxGroup[];
  lockdownTT?: number | null;
  className?: string;
}
/** 构造单个 10 个机台分页的箱线图 ECharts option */
const buildStationBoxPlotOption = (
  groups: StationBoxGroup[],
  lockdownTT: number | null | undefined,
  p: Palette,
): EChartsOption | null => {
  if (groups.length === 0) return null;
  // X 轴机台分类名称改为纯数字形式
  const categories = groups.map((g) => formatStationNumericName(g.stationId));
  const boxData = groups.map((g) => [
    g.whiskerLow,
    g.q1,
    g.median,
    g.q3,
    g.whiskerHigh,
  ]);

  const outlierData: [number, number][] = [];
  groups.forEach((g, idx) => {
    g.outliers.forEach((val) => {
      outlierData.push([idx, val]);
    });
  });

  // 计算整体平均值作为参考线（绿色）
  const totalCount = groups.reduce((acc, g) => acc + g.count, 0);
  const weightedSum = groups.reduce((acc, g) => acc + g.median * g.count, 0);
  const overallMean = totalCount > 0 ? Number((weightedSum / totalCount).toFixed(1)) : null;

  // 计算数据极值范围，自适应 Y 轴
  let minY = Infinity;
  let maxY = -Infinity;
  for (const g of groups) {
    minY = Math.min(minY, g.min);
    maxY = Math.max(maxY, g.max);
  }
  if (typeof lockdownTT === 'number' && Number.isFinite(lockdownTT)) {
    minY = Math.min(minY, lockdownTT);
    maxY = Math.max(maxY, lockdownTT);
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = 0;
    maxY = 100;
  }
  const span = maxY - minY || 10;
  const yMin = Math.floor(Math.max(0, minY - span * 0.1));
  const yMax = Math.ceil(maxY + span * 0.25); // 给顶部留出文字空间
  return {
    animation: false,
    grid: { left: 160, right: 35, top: 130, bottom: 55, containLabel: false },
    tooltip: {
      confine: true,
      backgroundColor: p.card,
      borderColor: p.border,
      borderWidth: 1,
      textStyle: { color: p.foreground, fontSize: 12 },
      formatter: (params: unknown) => {
        const pt = params as { seriesType: string; dataIndex: number; data: unknown };
        if (pt.seriesType === 'boxplot') {
          const g = groups[pt.dataIndex];
          if (!g) return '';
          return (
            `<b>${g.stationId}</b><br/>` +
            `样本数: ${g.count}<br/>` +
            `最大值 Max: ${g.max} S<br/>` +
            `Q3: ${g.q3} S<br/>` +
            `中位数 Med: ${g.median} S<br/>` +
            `Q1: ${g.q1} S<br/>` +
            `最小值 Min: ${g.min} S<br/>` +
            `IQR: ${g.iqr} S<br/>` +
            `离群点数: ${g.outliers.length}`
          );
        }
        if (pt.seriesType === 'scatter') {
          const [idx, val] = pt.data as [number, number];
          const g = groups[idx];
          return `<b>${g?.stationId ?? ''} 离群点</b><br/>测试时间: ${val} S`;
        }
        return '';
      },
    },
    xAxis: {
      type: 'category',
      name: 'Station ID',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: p.foreground, fontWeight: 'bold' },
      data: categories,
      ...axisStyle(p),
      axisLabel: {
        color: p.foreground,
        fontSize: 11,
        interval: 0,
        rotate: categories.some((c) => c.length > 10) ? 20 : 0,
      },
      splitLine: { show: true, lineStyle: { color: p.grid, type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      name: '测试时间 (S)',
      min: yMin,
      max: yMax,
      nameTextStyle: { color: p.muted, padding: [0, 0, 8, 0] },
      ...axisStyle(p),
      axisTick: {
        show: true,
        length: 20,
        lineStyle: { color: p.foreground, width: 1.5 },
      },
      minorTick: {
        show: true,
        splitNumber: 5,
        length: 10,
        lineStyle: { color: p.muted, width: 1 },
      },
      axisLabel: {
        color: p.muted,
        margin: 24,
        formatter: (v: number) => `${v}S`,
      },
    },
    series: [
      {
        name: 'boxplot',
        type: 'boxplot',
        data: boxData,
        itemStyle: {
          borderColor: p.foreground,
          borderWidth: 1.5,
          color: p.card,
        },
        markLine: {
          symbol: 'none',
          data: [
            ...(overallMean !== null
              ? [
                  {
                    yAxis: overallMean,
                    lineStyle: { color: '#22c55e', width: 2, type: 'solid' as const },
                    label: {
                      show: true,
                      position: 'start' as const,
                      distance: 65,
                      formatter: `平均值 ${overallMean}S`,
                      color: '#22c55e',
                      fontSize: 11,
                      fontWeight: 'bold' as const,
                    },
                  },
                ]
              : []),
            ...(typeof lockdownTT === 'number' && Number.isFinite(lockdownTT)
              ? [
                  {
                    yAxis: lockdownTT,
                    lineStyle: { color: '#ef4444', width: 2, type: 'solid' as const },
                    label: {
                      show: true,
                      position: 'start' as const,
                      distance: 65,
                      formatter: 'lockdown TT',
                      color: '#ef4444',
                      fontSize: 11,
                      fontWeight: 'bold' as const,
                    },
                  },
                ]
              : []),
          ],
        },
      },
      {
        name: 'outliers',
        type: 'scatter',
        data: outlierData,
        symbolSize: 5,
        itemStyle: { color: p.foreground },
      },
      // 顶部五数文字标注系列
      {
        name: 'topStats',
        type: 'scatter',
        data: groups.map((_, idx) => [idx, yMax]),
        symbolSize: 0,
        label: {
          show: true,
          position: 'insideBottom',
          offset: [0, 8],
          color: p.muted,
          fontSize: 10,
          lineHeight: 14,
          formatter: (params: unknown) => {
            const idx = (params as { dataIndex: number }).dataIndex;
            const g = groups[idx];
            if (!g) return '';
            return (
              `最大值 ${g.max}\n` +
              `Q3 ${g.q3}\n` +
              `Med ${g.median}\n` +
              `Q1 ${g.q1}\n` +
              `最小值 ${g.min}`
            );
          },
        },
      },
    ],
  } as EChartsOption;
};

/** 导出 SVG 图表为高清 PNG 文件 */
const exportSvgChartToPng = async (
  chart: echarts.ECharts | null,
  baseName: string,
  bg: string,
): Promise<void> => {
  if (!chart) return;
  const svgChart = chart as unknown as {
    renderToSVGString?: () => string;
    getWidth: () => number;
    getHeight: () => number;
  };
  const width = svgChart.getWidth();
  const height = svgChart.getHeight();
  const svgStr = svgChart.renderToSVGString
    ? svgChart.renderToSVGString()
    : (chart.getDom() as HTMLElement).querySelector('svg')?.outerHTML;
  if (!svgStr) return;

  const pixelRatio = 2;
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * pixelRatio);
          canvas.height = Math.round(height * pixelRatio);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('canvas context error'));
            return;
          }
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('toBlob error'));
              return;
            }
            const pngUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = pngUrl;
            a.download = `${baseName}.png`;
            a.click();
            URL.revokeObjectURL(pngUrl);
            resolve();
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => {
        reject(new Error('img load error'));
      };
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** 单个 10 机台箱线图组件（支持导出 PNG） */
export const TtStationBoxPlotChart = forwardRef<
  StationBoxPlotHandle,
  StationBoxPlotProps
>(({ groups, lockdownTT, className }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === 'dark' ? DARK : LIGHT;

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
    const option = buildStationBoxPlotOption(groups, lockdownTT, p);
    if (option) chartRef.current?.setOption(option, true);
  }, [groups, lockdownTT, p]);

  useImperativeHandle(ref, () => ({
    exportPng: async (baseName: string) => {
      await exportSvgChartToPng(chartRef.current, baseName, p.card);
    },
  }));

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: 'clamp(420px, calc(100vh - 240px), 640px)',
      }}
    />
  );
});

const EMPTY_REF_LINES: ComparisonReferenceLine[] = [];

export interface StationQ3LineChartHandle {
  exportPng: (baseName: string) => Promise<void>;
}

export interface StationQ3LineChartProps {
  groups: StationBoxGroup[];
  referenceLines?: ComparisonReferenceLine[];
  title?: string;
  className?: string;
}

/** 构造机台 Q3 对比折线图 ECharts Option */
const buildStationQ3LineOption = (
  groups: StationBoxGroup[],
  referenceLines: ComparisonReferenceLine[] = EMPTY_REF_LINES,
  title: string | undefined,
  p: Palette,
): EChartsOption | null => {
  if (groups.length === 0) return null;
  // X 轴机台名称改为纯数字形式
  const stations = groups.map((g) => formatStationNumericName(g.stationId));
  const q3Values = groups.map((g) => g.q3);
  // 计算 Y 轴范围边界（结合数据点与参考线）
  const allYVals = [...q3Values, ...referenceLines.map((l) => l.value)].filter(
    Number.isFinite,
  );
  const rawMin = Math.min(...allYVals);
  const rawMax = Math.max(...allYVals);
  const padding = Math.max(2, (rawMax - rawMin) * 0.1);
  const yMin = Math.floor(Math.max(0, rawMin - padding));
  const yMax = Math.ceil(rawMax + padding);

  const markLineData = referenceLines.map((line) => {
    const lineColor = line.color || '#ef4444';
    return {
      yAxis: line.value,
      lineStyle: {
        color: lineColor,
        width: 2,
        type: 'solid' as const,
      },
      label: {
        show: true,
        position: 'insideStartTop' as const,
        distance: 12,
        formatter: line.label ? `${line.label} (${line.value}S)` : `${line.value}S`,
        color: lineColor,
        fontSize: 12,
        fontWeight: 'bold' as const,
      },
    };
  });

  const needZoom = groups.length > 20;

  return {
    title: {
      text: title || '各机台数据对比',
      subtext: '折线展示各机台 Q3 耗时值（单位：秒）',
      left: 'center',
      top: 10,
      textStyle: { color: p.foreground, fontSize: 16, fontWeight: 'bold' },
      subtextStyle: { color: p.muted, fontSize: 12 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: p.card,
      borderColor: p.border,
      textStyle: { color: p.foreground, fontSize: 12 },
      formatter: (params: unknown) => {
        const arr = params as Array<{ dataIndex: number }>;
        if (!arr || arr.length === 0) return '';
        const idx = arr[0].dataIndex;
        const g = groups[idx];
        if (!g) return '';
        return (
          `<div style="font-weight:bold;margin-bottom:4px">机台: ${formatStationNumericName(g.stationId)}${g.stationId !== formatStationNumericName(g.stationId) ? ` (${g.stationId})` : ''}</div>` +
          `<div>Q3 (上四分位): <span style="font-weight:bold;color:#2563eb">${g.q3} S</span></div>` +
          `<div>中位数 Med: ${g.median} S</div>` +
          `<div>Q1 (下四分位): ${g.q1} S</div>` +
          `<div>最大值 Max: ${g.max} S</div>` +
          `<div>最小值 Min: ${g.min} S</div>` +
          `<div>样本量: ${g.count}</div>`
        );
      },
    },
    grid: {
      left: 60,
      right: 50,
      top: 75,
      bottom: needZoom ? 70 : 45,
      containLabel: true,
    },
    dataZoom: needZoom
      ? [
          {
            type: 'slider',
            show: true,
            bottom: 10,
            height: 20,
            borderColor: p.border,
            textStyle: { color: p.muted },
          },
          {
            type: 'inside',
          },
        ]
      : undefined,
    xAxis: {
      type: 'category',
      name: '机台',
      nameTextStyle: { color: p.muted, fontSize: 12 },
      data: stations,
      axisLine: { lineStyle: { color: p.border } },
      axisLabel: {
        color: p.muted,
        interval: 0,
        fontSize: 11,
        rotate: stations.length > 25 ? 45 : 0,
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: '时间 (S)',
      min: yMin,
      max: yMax,
      nameTextStyle: { color: p.muted, fontSize: 12 },
      axisLine: { lineStyle: { color: p.border } },
      axisLabel: {
        color: p.muted,
        formatter: (v: number) => `${v}`,
      },
      splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
    },
    series: [
      {
        name: 'Q3',
        type: 'line',
        data: q3Values,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: {
          color: '#2563eb',
          width: 2,
        },
        itemStyle: {
          color: '#2563eb',
        },
        label: {
          show: true,
          position: 'top',
          distance: 5,
          color: '#2563eb',
          fontWeight: 'bold',
          fontSize: 11,
          formatter: (param: unknown) => {
            const pObj = param as { value: number };
            return String(pObj.value);
          },
        },
        markLine: {
          symbol: 'none',
          data: markLineData,
        },
      },
    ],
  } as EChartsOption;
};

/** 机台 Q3 对比折线图组件（对应第三个图模块） */
export const TtStationQ3LineChart = forwardRef<
  StationQ3LineChartHandle,
  StationQ3LineChartProps
>(({ groups, referenceLines = EMPTY_REF_LINES, title, className }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const p = resolvedTheme === 'dark' ? DARK : LIGHT;

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
    const option = buildStationQ3LineOption(groups, referenceLines, title, p);
    if (option) chartRef.current?.setOption(option, true);
  }, [groups, referenceLines, title, p]);

  useImperativeHandle(ref, () => ({
    exportPng: async (baseName: string) => {
      await exportSvgChartToPng(chartRef.current, baseName, p.card);
    },
  }));

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: 'clamp(460px, calc(100vh - 260px), 680px)',
      }}
    />
  );
});

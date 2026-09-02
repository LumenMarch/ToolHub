import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BoxplotChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

echarts.use([
  BoxplotChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  SVGRenderer,
]);
/** 一个分组的箱线图统计量（与后端 GroupStatModel 对应，camelCase）。 */
export interface BoxGroup {
  name: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  fenceLow: number;
  fenceHigh: number;
  whiskerLow: number;
  whiskerHigh: number;
  outlierCount: number;
  outliers: number[];
}

/** 须线模式：tukey 用 fences 截断并单列离群点；minmax 直达 min/max。 */
export type WhiskerMode = 'tukey' | 'minmax';

interface BoxPlotChartProps {
  groups: BoxGroup[];
  whiskerMode: WhiskerMode;
  showFences?: boolean;
  showValues?: boolean;
  className?: string;
  height?: number;
}

export interface BoxPlotChartHandle {
  exportSvg: (baseName: string) => void;
  exportPng: (baseName: string) => Promise<void>;
}

const CHART_HEIGHT = 440;
const VISIBLE_GROUPS = 12;
const MAX_LABEL_LENGTH = 18;

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-3)) {
    return value.toExponential(2);
  }
  if (abs >= 1000) {
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }
  return Number(value.toPrecision(6)).toString();
};

const shortenTail = (text: string, max: number): string =>
  text.length > max ? `…${text.slice(-(max - 1))}` : text;

/** 分组名常有相同前缀（机台/工位），截尾保留可区分的后缀。 */
const axisLabels = (names: string[]): string[] => {
  if (names.length === 0) return [];
  if (names.length === 1) return [shortenTail(names[0], MAX_LABEL_LENGTH)];

  let prefixLength = names[0].length;
  for (const name of names) {
    let index = 0;
    while (index < prefixLength && index < name.length && name[index] === names[0][index]) {
      index += 1;
    }
    prefixLength = index;
  }
  const prefix = names[0].slice(0, prefixLength);
  const breakAt = Math.max(
    prefix.lastIndexOf('_'),
    prefix.lastIndexOf('-'),
    prefix.lastIndexOf(' '),
  );
  const cut = breakAt >= 3 ? breakAt + 1 : prefixLength;

  return names.map((name) => {
    const rest = cut > 0 && cut < name.length ? name.slice(cut) : name;
    return shortenTail(rest || name, MAX_LABEL_LENGTH);
  });
};

/** ECharts 对 oklch 支持差，读计算后的 rgb() 才能跟主题走。 */
const cssColor = (variable: string): string => {
  const probe = document.createElement('span');
  probe.style.color = `var(${variable})`;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
};

/** 转义用户数据中的 HTML 特殊字符：tooltip.formatter 返回值按 HTML 渲染，分组名必须先转义。 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
  ));

/** 按数据范围加 5% 边距后再取 1/2/5 步长，避免刻度把箱体压在中间。 */
const computeNiceRange = (min: number, max: number) => {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    const pad = Math.abs(max) * 0.08 || 1;
    return { min: max - pad, max: max + pad, interval: undefined as number | undefined };
  }
  const paddedMin = min - span * 0.05;
  const paddedMax = max + span * 0.05;
  const rawStep = (paddedMax - paddedMin) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  return {
    min: Math.floor(paddedMin / step) * step,
    max: Math.ceil(paddedMax / step) * step,
    interval: step,
  };
};

const BoxPlotChart = forwardRef<BoxPlotChartHandle, BoxPlotChartProps>(
  ({ groups, whiskerMode, showFences = false, showValues = false, className, height = CHART_HEIGHT }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<echarts.ECharts | null>(null);
    const { resolvedTheme } = useTheme();

    // 暴露导出能力给父组件
    useImperativeHandle(ref, () => ({
      exportSvg: (baseName: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        // svg 渲染器自带 renderToSVGString，TypeScript 类型未暴露，需用命名别名断言
        const svgChart = chart as unknown as { renderToSVGString?: () => string; getDataURL: (o: unknown) => string };
        const svgStr = svgChart.renderToSVGString?.();
        if (svgStr) {
          const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${baseName}.svg`;
          a.click();
          // 部分浏览器异步启动下载，立即 revoke 可能取消下载；
          // 与 PNG 路径一致延迟释放。
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          return;
        }
        const url2 = svgChart.getDataURL({ type: 'svg' });
        const a = document.createElement('a');
        a.href = url2;
        a.download = `${baseName}.svg`;
        a.click();
      },
      exportPng: async (baseName: string) => {
        const chart = chartRef.current;
        if (!chart) return;
        const svgChart = chart as unknown as {
          renderToSVGString?: () => string;
          getWidth: () => number;
          getHeight: () => number;
          getDataURL: (o: unknown) => string;
        };
        const svgStr = svgChart.renderToSVGString?.();
        if (!svgStr) {
          const url = svgChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: cssColor('--background') });
          const a = document.createElement('a');
          a.href = url;
          a.download = `${baseName}.png`;
          a.click();
          return;
        }
        const width = svgChart.getWidth();
        const height = svgChart.getHeight();
        const pixelRatio = 2;
        const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            // 回调在 Promise executor 返回后才运行：任何异常都必须转为 reject，
            // 否则 Promise 永远 pending，父层 finally 无法复位 exporting。
            try {
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(width * pixelRatio);
              canvas.height = Math.round(height * pixelRatio);
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error('canvas context'));
                return;
              }
              ctx.fillStyle = cssColor('--background');
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              canvas.toBlob(
                (blob) => {
                  try {
                    if (!blob) {
                      URL.revokeObjectURL(url);
                      reject(new Error('toBlob'));
                      return;
                    }
                    const pngUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = pngUrl;
                    a.download = `${baseName}.png`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(pngUrl), 2000);
                    URL.revokeObjectURL(url);
                    resolve();
                  } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error instanceof Error ? error : new Error(String(error)));
                  }
                },
                'image/png',
              );
            } catch (error) {
              URL.revokeObjectURL(url);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          };
          img.onerror = () => {
            try {
              URL.revokeObjectURL(url);
              // 兜底用 getDataURL
              const fallback = svgChart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: cssColor('--background') });
              const a = document.createElement('a');
              a.href = fallback;
              a.download = `${baseName}.png`;
              a.click();
              resolve();
            } catch (error) {
              URL.revokeObjectURL(url);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          };
          img.src = url;
        });
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;
      // 使用 svg 渲染器以支持 SVG 导出，PNG 导出仍通过 getDataURL 转位图
      const chart = echarts.init(containerRef.current, undefined, { renderer: 'svg' });
      chartRef.current = chart;
      const handleResize = () => chart.resize();
      window.addEventListener('resize', handleResize);
      // 父容器宽度变化（如侧栏折叠）不触发 window resize，需用 ResizeObserver 兜底
      const container = containerRef.current;
      const observer = new ResizeObserver(handleResize);
      observer.observe(container);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', handleResize);
        chart.dispose();
        chartRef.current = null;
      };
    }, []);

    useEffect(() => {
      const chart = chartRef.current;
      if (!chart || groups.length === 0) return;

      const categories = groups.map((g) => g.name);
      const labels = axisLabels(categories);
      const rotateLabels = labels.some((label) => label.length > 8) || groups.length > 8;
      const manyGroups = groups.length > VISIBLE_GROUPS;
      const boxData = groups.map((g) => {
        const low = whiskerMode === 'tukey' ? g.whiskerLow : g.min;
        const high = whiskerMode === 'tukey' ? g.whiskerHigh : g.max;
        return [low, g.q1, g.median, g.q3, high];
      });
      const outlierData: [number, number][] = [];
      if (whiskerMode === 'tukey') {
        groups.forEach((g, idx) => {
          g.outliers.forEach((v) => outlierData.push([idx, v]));
        });
      }

      const primary = cssColor('--foreground');
      const border = cssColor('--border');
      const foreground = cssColor('--foreground');
      const muted = cssColor('--muted-foreground');
      const card = cssColor('--card');
      const background = cssColor('--background');
      const success = cssColor('--color-status-success-foreground');
      const danger = cssColor('--color-status-danger-foreground');

      // 自适应 Y 刻度：按当前数据紧凑取整，避免默认 scale=false 把 0 带进来导致箱体被压扁
      let lo = Infinity;
      let hi = -Infinity;
      for (const g of groups) {
        const low = whiskerMode === 'tukey' ? g.whiskerLow : g.min;
        const high = whiskerMode === 'tukey' ? g.whiskerHigh : g.max;
        lo = Math.min(lo, low);
        hi = Math.max(hi, high);
      }
      if (whiskerMode === 'tukey' && outlierData.length > 0) {
        for (const [, v] of outlierData) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      if (showFences) {
        for (const g of groups) {
          lo = Math.min(lo, g.fenceLow);
          hi = Math.max(hi, g.fenceHigh);
        }
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        lo = 0;
        hi = 1;
      }
      const yRange = computeNiceRange(lo, hi);
      const option: EChartsOption = {
        animation: false,
        tooltip: {
          trigger: 'item',
          confine: true,
          backgroundColor: card,
          borderColor: border,
          borderWidth: 1,
          extraCssText: 'border-radius: 8px; box-shadow: none;',
          textStyle: { color: foreground, fontFamily: 'var(--font-sans)', fontSize: 12 },
          formatter: (params: unknown) => {
            const p = params as { seriesIndex: number; seriesName?: string; dataIndex: number; data: unknown };
            // boxplot 的 tooltip
            if (p.seriesName === 'boxplot' || p.seriesIndex === 0) {
              const g = groups[p.dataIndex];
              if (!g) return '';
              return [
                `<b style="color:${primary}">${escapeHtml(g.name)}</b>`,
                `样本数 n: ${g.count}`,
                `${whiskerMode === 'tukey' ? 'Whisker low' : 'MIN'}: ${formatNumber(whiskerMode === 'tukey' ? g.whiskerLow : g.min)}`,
                `Q1: ${formatNumber(g.q1)}`,
                `中位数: ${formatNumber(g.median)}`,
                `Q3: ${formatNumber(g.q3)}`,
                `${whiskerMode === 'tukey' ? 'Whisker high' : 'MAX'}: ${formatNumber(whiskerMode === 'tukey' ? g.whiskerHigh : g.max)}`,
                `IQR: ${formatNumber(g.iqr)}`,
                `Fence low: ${formatNumber(g.fenceLow)}`,
                `Fence high: ${formatNumber(g.fenceHigh)}`,
                `离群点: ${g.outlierCount}`,
              ].join('<br/>');
            }
            if (p.seriesName === 'outlier') {
              const v = (p.data as [number, number])[1];
              return `离群点: ${formatNumber(v)}`;
            }
            if (typeof p.seriesName === 'string' && p.seriesName.endsWith('Label')) {
              const v = (p.data as [number, number])[1];
              return `${p.seriesName}: ${formatNumber(v)}`;
            }
            return '';
          },
        },
        grid: {
          left: 8,
          right: showValues ? 108 : 12,
          top: 16,
          bottom: manyGroups ? 36 : rotateLabels ? 16 : 8,
          containLabel: true,
        },
        dataZoom: manyGroups
          ? [
              {
                type: 'inside',
                xAxisIndex: 0,
                filterMode: 'none',
                zoomOnMouseWheel: 'shift',
              },
              {
                type: 'slider',
                xAxisIndex: 0,
                filterMode: 'none',
                height: 18,
                bottom: 4,
                start: 0,
                end: (VISIBLE_GROUPS / groups.length) * 100,
                brushSelect: false,
                borderColor: border,
                fillerColor: muted,
                handleStyle: { color: card, borderColor: border },
                moveHandleStyle: { color: muted },
                dataBackground: {
                  lineStyle: { color: border },
                  areaStyle: { color: border },
                },
                selectedDataBackground: {
                  lineStyle: { color: muted },
                  areaStyle: { color: muted },
                },
                textStyle: { color: muted, fontSize: 10 },
              },
            ]
          : [],
        xAxis: {
          type: 'category' as const,
          data: categories,
          boundaryGap: true,
          axisLine: { lineStyle: { color: border, width: 1 } },
          axisTick: { show: false },
          axisPointer: { type: 'shadow', shadowStyle: { color: muted, opacity: 0.08 } },
          axisLabel: {
            interval: 0,
            hideOverlap: true,
            rotate: rotateLabels ? 40 : 0,
            color: muted,
            fontSize: 11,
            fontWeight: 500,
            formatter: (_value: string, index: number) => labels[index] ?? _value,
          },
        },
        yAxis: {
          type: 'value' as const,
          min: yRange.min,
          max: yRange.max,
          interval: yRange.interval,
          scale: true,
          splitLine: { lineStyle: { color: border, width: 1, type: 'dashed' } },
          axisLine: { show: false },
          axisLabel: {
            color: muted,
            fontSize: 11,
            formatter: (v: number) => formatNumber(v),
          },
        },
        series: [
          {
            name: 'boxplot',
            type: 'boxplot' as const,
            data: boxData,
            boxWidth: ['48%', 36],
            itemStyle: {
              color: background,
              borderColor: foreground,
              borderWidth: 1.25,
            },
            emphasis: {
              itemStyle: {
                borderColor: primary,
                borderWidth: 1.5,
              },
            },
            label: { show: false },
          },
          ...(showValues
            ? [
                {
                  name: 'q1Label',
                  type: 'scatter' as const,
                  data: groups.map((g, idx) => [idx, g.q1]),
                  symbol: 'circle',
                  symbolSize: 6,
                  itemStyle: { color: success, borderColor: card, borderWidth: 1 },
                  label: {
                    show: true,
                    position: 'right' as const,
                    distance: 14,
                    formatter: (params: unknown) => {
                      const p = params as { dataIndex: number };
                      const g = groups[p.dataIndex];
                      if (!g) return '';
                      return `Q1 ${formatNumber(g.q1)}`;
                    },
                    fontSize: 8,
                    color: success,
                    backgroundColor: card,
                    padding: [1, 3],
                    borderRadius: 2,
                  },
                  tooltip: { show: false },
                  labelLayout: { hideOverlap: false },
                } as unknown as Record<string, unknown>,
                {
                  name: 'medianLabel',
                  type: 'scatter' as const,
                  data: groups.map((g, idx) => [idx, g.median]),
                  symbol: 'circle',
                  symbolSize: 6,
                  itemStyle: { color: primary, borderColor: card, borderWidth: 1 },
                  label: {
                    show: true,
                    position: 'right' as const,
                    distance: 14,
                    formatter: (params: unknown) => {
                      const p = params as { dataIndex: number };
                      const g = groups[p.dataIndex];
                      if (!g) return '';
                      return `中位数 ${formatNumber(g.median)}`;
                    },
                    fontSize: 8.5,
                    fontWeight: 'bold' as const,
                    color: primary,
                    backgroundColor: card,
                    padding: [1, 3],
                    borderRadius: 2,
                  },
                  tooltip: { show: false },
                  labelLayout: { hideOverlap: false },
                } as unknown as Record<string, unknown>,
                {
                  name: 'q3Label',
                  type: 'scatter' as const,
                  data: groups.map((g, idx) => [idx, g.q3]),
                  symbol: 'circle',
                  symbolSize: 6,
                  itemStyle: { color: danger, borderColor: card, borderWidth: 1 },
                  label: {
                    show: true,
                    position: 'right' as const,
                    distance: 14,
                    formatter: (params: unknown) => {
                      const p = params as { dataIndex: number };
                      const g = groups[p.dataIndex];
                      if (!g) return '';
                      return `Q3 ${formatNumber(g.q3)}`;
                    },
                    fontSize: 8,
                    color: danger,
                    backgroundColor: card,
                    padding: [1, 3],
                    borderRadius: 2,
                  },
                  tooltip: { show: false },
                  labelLayout: { hideOverlap: false },
                } as unknown as Record<string, unknown>,
                {
                  name: 'minLabel',
                  type: 'scatter' as const,
                  data: groups.map((g, idx) => [idx, whiskerMode === 'tukey' ? g.whiskerLow : g.min]),
                  symbol: 'rect',
                  symbolSize: [8, 3],
                  itemStyle: { color: muted },
                  label: {
                    show: true,
                    position: 'right' as const,
                    distance: 14,
                    formatter: (params: unknown) => {
                      const p = params as { dataIndex: number };
                      const g = groups[p.dataIndex];
                      if (!g) return '';
                      const v = whiskerMode === 'tukey' ? g.whiskerLow : g.min;
                      // Tukey 模式下该点是须线端点而非原始极值，标签必须如实命名
                      return whiskerMode === 'tukey'
                        ? `Whisker low ${formatNumber(v)}`
                        : `Min ${formatNumber(v)}`;
                    },
                    fontSize: 7.5,
                    color: muted,
                    backgroundColor: card,
                    padding: [1, 3],
                    borderRadius: 2,
                  },
                  tooltip: { show: false },
                  labelLayout: { hideOverlap: false },
                } as unknown as Record<string, unknown>,
                {
                  name: 'maxLabel',
                  type: 'scatter' as const,
                  data: groups.map((g, idx) => [idx, whiskerMode === 'tukey' ? g.whiskerHigh : g.max]),
                  symbol: 'rect',
                  symbolSize: [8, 3],
                  itemStyle: { color: muted },
                  label: {
                    show: true,
                    position: 'right' as const,
                    distance: 14,
                    formatter: (params: unknown) => {
                      const p = params as { dataIndex: number };
                      const g = groups[p.dataIndex];
                      if (!g) return '';
                      const v = whiskerMode === 'tukey' ? g.whiskerHigh : g.max;
                      return whiskerMode === 'tukey'
                        ? `Whisker high ${formatNumber(v)}`
                        : `Max ${formatNumber(v)}`;
                    },
                    fontSize: 7.5,
                    color: muted,
                    backgroundColor: card,
                    padding: [1, 3],
                    borderRadius: 2,
                  },
                  tooltip: { show: false },
                  labelLayout: { hideOverlap: false },
                } as unknown as Record<string, unknown>,
              ]
            : []),
          ...(showFences
            ? [
                {
                  name: 'fence',
                  type: 'scatter' as const,
                  data: groups.flatMap((g, idx) => [
                    [idx, g.fenceLow],
                    [idx, g.fenceHigh],
                  ]),
                  symbol: 'rect',
                  symbolSize: [28, 2],
                  itemStyle: { color: muted },
                  tooltip: {
                    formatter: (params: unknown) => {
                      const p = params as { data: [number, number]; dataIndex: number }
                      const group = groups[p.data[0]]
                      if (!group) return ''
                      const isLow = p.data[1] === group.fenceLow
                      return `${isLow ? 'Fence low' : 'Fence high'}: ${formatNumber(p.data[1])}`
                    },
                  },
                  z: 5,
                } as unknown as Record<string, unknown>,
              ]
            : []),
          ...(outlierData.length > 0
            ? [
                {
                  name: 'outlier',
                  type: 'scatter' as const,
                  data: outlierData,
                  symbolSize: 5,
                  itemStyle: { color: primary, opacity: 0.85 },
                  tooltip: { trigger: 'item' as const },
                } as unknown as Record<string, unknown>,
              ]
            : []),
        ],
      };

      chart.setOption(option, { notMerge: true });

      chart.resize();
    }, [groups, whiskerMode, showFences, showValues, resolvedTheme]);

    // 高度可由父容器控制，这里固定为传入 height
    return (
      <div className={cn('relative min-w-0', className)}>
        <div
          ref={containerRef}
          style={{ width: '100%', height }}
          role="img"
          aria-label={`箱线图：${groups.length} 组${whiskerMode === 'tukey' ? '（Tukey 须线）' : '（min-max 须线）'}分布对比`}
        />
      </div>
    );
  },
);

BoxPlotChart.displayName = 'BoxPlotChart';
export default BoxPlotChart;

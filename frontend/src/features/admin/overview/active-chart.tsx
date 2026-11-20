import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { theme } from 'antd'

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

interface ActiveChartProps {
  data: Array<{ date: string; count: number }>
  height?: number
}

export function ActiveChart({ data, height = 280 }: ActiveChartProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { token } = theme.useToken()

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const chart = echarts.init(element)
    const option: EChartsOption = {
      animationDuration: 420,
      grid: { left: 8, right: 14, top: 18, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: token.colorBgElevated,
        borderColor: token.colorBorderSecondary,
        textStyle: { color: token.colorText, fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: data.map((point) => point.date.slice(5)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: token.colorBorderSecondary } },
        axisLabel: { color: token.colorTextTertiary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        splitLine: { lineStyle: { color: token.colorBorderSecondary } },
        axisLabel: { color: token.colorTextTertiary, fontSize: 11 },
      },
      series: [
        {
          name: '活跃用户',
          type: 'line',
          smooth: 0.35,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          data: data.map((point) => point.count),
          lineStyle: { width: 2.5, color: token.colorPrimary },
          itemStyle: { color: token.colorPrimary },
          areaStyle: { color: token.colorPrimary, opacity: 0.12 },
        },
      ],
    }
    chart.setOption(option)
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [
    data,
    token.colorBgElevated,
    token.colorBorderSecondary,
    token.colorPrimary,
    token.colorText,
    token.colorTextTertiary,
  ])

  return <div ref={ref} style={{ width: '100%', height }} />
}

/**
 * 重测率统计 — 客户端报告导出（CSV / HTML）。
 *
 * 文件名沿用桌面版约定：report_{站名}_{版本}_{时间戳}；
 * 站名/版本为多值时仅取第一行参与命名。原因分析随导出内容一并写入。
 */

import {
  formatRate,
  OVERVIEW_LABELS,
  RETEST_STAT_LABELS,
  TIME_LABELS,
  type AnalyzeResult,
  type DefectItemDetail,
  type RetestItemDetail,
} from './types'

/** 原因分析编辑状态：key = `${kind}:${测试项}:${SN}` */
export type ReasonMap = Record<string, string>

export const reasonKey = (kind: 'retest' | 'defect', name: string, sn: string) =>
  `${kind}:${name}:${sn}`

const sanitize = (value: string) => {
  const first = value.split('\n')[0].trim()
  const cleaned = first.replace(/[\\/:*?"<>|]/g, '_')
  return cleaned || 'NA'
}

const timestamp = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

export const reportBaseName = (result: AnalyzeResult) =>
  `report_${sanitize(result.station_info)}_${sanitize(result.version_info)}_${timestamp()}`

const download = (content: string, filename: string, mime: string) => {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const csvEscape = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

const reasonOf = (reasons: ReasonMap, kind: 'retest' | 'defect', item: RetestItemDetail | DefectItemDetail, sn: string) =>
  reasons[reasonKey(kind, item.name, sn)] || '待分析'

/** 生成分节 CSV 文本（含 BOM，便于 Excel 打开） */
export const buildCsvReport = (result: AnalyzeResult, reasons: ReasonMap): string => {
  const rows: string[][] = []
  const push = (...cells: (string | number)[]) =>
    rows.push(cells.map((cell) => String(cell ?? '')))

  push('测试站信息')
  push('站名', result.station_info)
  push('版本', result.version_info)
  push('文件格式', result.csv_format)
  push('文件数', result.file_count, '数据总行数', result.total_rows)
  push('')

  push('数据概览')
  push('指标', '数量', '占比')
  for (const row of result.overview) {
    push(OVERVIEW_LABELS[row.key] ?? row.key, row.value, formatRate(row.rate))
  }
  push('')

  push('测试时间统计（仅 PASS 记录，单位：秒）')
  push('指标', '秒', 'SN', '状态')
  for (const row of result.time_stats) {
    push(
      TIME_LABELS[row.key] ?? row.key,
      row.seconds.toFixed(2),
      row.sn ?? '',
      row.status ?? '',
    )
  }
  push('')

  push('重测次数统计')
  push('档位', '数量', '占比', 'SN 列表')
  for (const row of result.retest_stats) {
    push(
      RETEST_STAT_LABELS[row.key] ?? row.key,
      row.count,
      formatRate(row.rate),
      row.sn_list.join(' '),
    )
  }
  push('')

  push('Station 和 Slot 分析（按不良率降序）')
  push('机台', '穴位', '投入 SN', '重测 SN', '重测率', '不良 SN', '不良率')
  for (const row of result.station_slot) {
    push(
      row.station_id,
      row.slot_id,
      row.total_sn,
      row.retest_sn,
      formatRate(row.retest_rate),
      row.pure_fail_sn,
      formatRate(row.pure_fail_rate),
    )
  }
  push('')

  push('重测项目详细分析（最终 PASS 的 SN，按测试项分组）')
  push(
    '测试项', '数量', '项内占比', '规格',
    'SN', '第一次FAIL值', '机台', '穴位',
    '第二次FAIL值', '机台', '穴位',
    '最终PASS值', '机台', '穴位', '原因分析',
  )
  for (const item of result.retest_details) {
    for (const row of item.rows) {
      push(
        item.name, item.count, formatRate(item.rate), item.spec,
        row.sn, row.first_fail_value, row.first_fail_station, row.first_fail_slot,
        row.second_fail_value, row.second_fail_station, row.second_fail_slot,
        row.pass_value, row.pass_station, row.pass_slot,
        reasonOf(reasons, 'retest', item, row.sn),
      )
    }
  }
  push('')

  push('不良项目详细分析（从未 PASS 的 SN，按测试项分组）')
  push(
    '测试项', '数量', '项内占比', '规格',
    'SN', '第一次FAIL值', '机台', '穴位',
    '第二次测试值', '机台', '穴位',
    '第三次测试值', '机台', '穴位', '原因分析',
  )
  for (const item of result.defect_details) {
    for (const row of item.rows) {
      push(
        item.name, item.count, formatRate(item.rate), item.spec,
        row.sn, row.first_fail_value, row.first_fail_station, row.first_fail_slot,
        row.second_test_value, row.second_test_station, row.second_test_slot,
        row.third_test_value, row.third_test_station, row.third_test_slot,
        reasonOf(reasons, 'defect', item, row.sn),
      )
    }
  }

  return (
    '\ufeff' +
    rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')
  )
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const table = (headers: string[], body: string[][]): string => {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const rows = body
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('\n')
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

const section = (title: string, content: string): string =>
  `<h2>${escapeHtml(title)}</h2>${content}`

/** 生成完整 HTML 报告（零依赖，带内联样式，可直接浏览器打开） */
export const buildHtmlReport = (result: AnalyzeResult, reasons: ReasonMap): string => {
  const overviewTable = table(
    ['指标', '数量', '占比'],
    result.overview.map((row) => [
      OVERVIEW_LABELS[row.key] ?? row.key,
      String(row.value),
      formatRate(row.rate),
    ]),
  )

  const timeTable = table(
    ['指标', '秒', 'SN', '状态'],
    result.time_stats.map((row) => [
      TIME_LABELS[row.key] ?? row.key,
      row.seconds.toFixed(2),
      row.sn ?? '',
      row.status ?? '',
    ]),
  )

  const retestStatTable = table(
    ['档位', '数量', '占比', 'SN 列表'],
    result.retest_stats.map((row) => [
      RETEST_STAT_LABELS[row.key] ?? row.key,
      String(row.count),
      formatRate(row.rate),
      row.sn_list.join(' '),
    ]),
  )

  const stationTable = table(
    ['机台', '穴位', '投入 SN', '重测 SN', '重测率', '不良 SN', '不良率'],
    result.station_slot.map((row) => [
      row.station_id,
      row.slot_id,
      String(row.total_sn),
      String(row.retest_sn),
      formatRate(row.retest_rate),
      String(row.pure_fail_sn),
      formatRate(row.pure_fail_rate),
    ]),
  )

  const retestTables = result.retest_details
    .map((item) =>
      section(
        `${item.name}（${item.count}，${formatRate(item.rate)}，规格 ${item.spec}）`,
        table(
          ['SN', '第一次FAIL值', '机台', '穴位', '第二次FAIL值', '机台', '穴位', '最终PASS值', '机台', '穴位', '原因分析'],
          item.rows.map((row) => [
            row.sn,
            row.first_fail_value, row.first_fail_station, row.first_fail_slot,
            row.second_fail_value, row.second_fail_station, row.second_fail_slot,
            row.pass_value, row.pass_station, row.pass_slot,
            reasonOf(reasons, 'retest', item, row.sn),
          ]),
        ),
      ),
    )
    .join('\n')

  const defectTables = result.defect_details
    .map((item) =>
      section(
        `${item.name}（${item.count}，${formatRate(item.rate)}，规格 ${item.spec}）`,
        table(
          ['SN', '第一次FAIL值', '机台', '穴位', '第二次测试值', '机台', '穴位', '第三次测试值', '机台', '穴位', '原因分析'],
          item.rows.map((row) => [
            row.sn,
            row.first_fail_value, row.first_fail_station, row.first_fail_slot,
            row.second_test_value, row.second_test_station, row.second_test_slot,
            row.third_test_value, row.third_test_station, row.third_test_slot,
            reasonOf(reasons, 'defect', item, row.sn),
          ]),
        ),
      ),
    )
    .join('\n')

  const empty = (content: string) => (content ? content : '<p>无数据</p>')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>重测率统计报告</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 32px auto; max-width: 1200px; color: #1f2937; }
  h1 { font-size: 22px; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 28px; color: #1d4ed8; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 13px; }
  th, td { border: 1px solid #d1d5db; padding: 5px 9px; text-align: left; }
  th { background: #eff6ff; }
  .meta { color: #6b7280; font-size: 13px; }
</style>
</head>
<body>
<h1>重测率统计报告</h1>
<p class="meta">站名：${escapeHtml(result.station_info)}　版本：${escapeHtml(result.version_info)}　格式：${escapeHtml(result.csv_format)}　文件数：${result.file_count}　数据行数：${result.total_rows}</p>
${section('数据概览', overviewTable)}
${section('测试时间统计（仅 PASS 记录，单位：秒）', timeTable)}
${section('重测次数统计', retestStatTable)}
${section('Station 和 Slot 分析', empty(stationTable))}
${section('重测项目详细分析', empty(retestTables))}
${section('不良项目详细分析', empty(defectTables))}
</body>
</html>`
}

export const exportCsvReport = (result: AnalyzeResult, reasons: ReasonMap) => {
  download(buildCsvReport(result, reasons), `${reportBaseName(result)}.csv`, 'text/csv;charset=utf-8')
}

export const exportHtmlReport = (result: AnalyzeResult, reasons: ReasonMap) => {
  download(buildHtmlReport(result, reasons), `${reportBaseName(result)}.html`, 'text/html;charset=utf-8')
}

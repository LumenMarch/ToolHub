/**
 * 重测率统计 — 与后端 app/schemas/retest_rate.py 对应的类型与展示文案。
 *
 * API 契约（POST /api/v1/tools/retest-rate/analyze）：
 *   body { upload_ids: string[] }（tus 上传后的 ID 列表，顺序即分析顺序，
 *   首个文件用于识别格式与解析测试项规格）
 *   → 完整统计结果（见 AnalyzeResult）。
 * 报告导出（CSV / HTML）在本模块与 report.ts 中客户端完成。
 */

export interface OverviewRow {
  key: string
  value: number
  rate: number | null
}

export interface TimeStatRow {
  key: string
  seconds: number
  sn: string | null
  status: string | null
}

export interface RetestStatRow {
  key: string
  count: number
  rate: number
  sn_list: string[]
}

export interface StationSlotRow {
  station_id: string
  slot_id: string
  total_sn: number
  retest_sn: number
  retest_rate: number
  pure_fail_sn: number
  pure_fail_rate: number
}

export interface RetestDetailRow {
  sn: string
  first_fail_value: string
  first_fail_station: string
  first_fail_slot: string
  second_fail_value: string
  second_fail_station: string
  second_fail_slot: string
  pass_value: string
  pass_station: string
  pass_slot: string
}

export interface RetestItemDetail {
  name: string
  count: number
  rate: number
  spec: string
  rows: RetestDetailRow[]
}

export interface DefectDetailRow {
  sn: string
  first_fail_value: string
  first_fail_station: string
  first_fail_slot: string
  second_test_value: string
  second_test_station: string
  second_test_slot: string
  third_test_value: string
  third_test_station: string
  third_test_slot: string
}

export interface DefectItemDetail {
  name: string
  count: number
  rate: number
  spec: string
  rows: DefectDetailRow[]
}

export interface AnalyzeResult {
  csv_format: string
  station_info: string
  version_info: string
  total_rows: number
  file_count: number
  overview: OverviewRow[]
  time_stats: TimeStatRow[]
  retest_stats: RetestStatRow[]
  station_slot: StationSlotRow[]
  retest_details: RetestItemDetail[]
  defect_details: DefectItemDetail[]
}

/** 概览行 key → 中文标签 */
export const OVERVIEW_LABELS: Record<string, string> = {
  ov_file_count: '文件数',
  ov_total_rows: '数据总行数',
  ov_input_count: '投入数（SN）',
  ov_pass_sn: 'PASS SN 数',
  ov_first_pass_rate: '首次即 PASS',
  ov_second_pass_rate: '重测 1 次后 PASS',
  ov_third_pass_rate: '重测 2 次后 PASS',
  ov_three_plus_rate: '重测 ≥3 次后 PASS',
  ov_total_fail: 'FAIL SN 数',
  ov_retest_rate: '重测 SN 数',
  ov_defect_rate: '不良 SN 数',
}

/** 测试时间统计行 key → 中文标签 */
export const TIME_LABELS: Record<string, string> = {
  tt_total: '总测试时间',
  tt_avg: '平均',
  tt_max: '最大',
  tt_min: '最小',
  tt_median: '中位数',
  tt_p80: 'P80',
}

/** 重测次数分档行 key → 中文标签 */
export const RETEST_STAT_LABELS: Record<string, string> = {
  rs_first_pass: '首次即 PASS',
  rs_once: '重测 1 次后 PASS',
  rs_twice: '重测 2 次后 PASS',
  rs_three_plus: '重测 ≥3 次后 PASS',
}

/** 占比格式化：0-1 小数 → "xx.xx%"，空值返回空串 */
export const formatRate = (rate: number | null | undefined): string =>
  rate == null ? '' : `${(rate * 100).toFixed(2)}%`

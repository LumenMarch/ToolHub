import type { AssetDifferenceType, AssetInputKey, AssetJobStatus, AssetModuleKey } from '../../../api/asset'

export interface AssetInputField {
  key: AssetInputKey
  label: string
}

export interface AssetInputGroup {
  key: string
  label: string
  hint: string
  fields: AssetInputField[]
}

export const ASSET_INPUT_GROUPS: AssetInputGroup[] = [
  {
    key: 'finance',
    label: '财务',
    hint: '本期 / 上期',
    fields: [
      { key: 'thisFinance', label: '本期财务' },
      { key: 'lastFinance', label: '上期财务' },
    ],
  },
  {
    key: 'sfc',
    label: 'SFC',
    hint: '本期 / 上期',
    fields: [
      { key: 'thisSFC', label: '本期 SFC' },
      { key: 'lastSFC', label: '上期 SFC' },
    ],
  },
  {
    key: 'notes',
    label: 'Notes',
    hint: '本期 / 上期',
    fields: [
      { key: 'thisNotes', label: '本期 Notes' },
      { key: 'lastNotes', label: '上期 Notes' },
    ],
  },
  {
    key: 'customer',
    label: '客户',
    hint: '本期 / 上期',
    fields: [
      { key: 'thisCustomer', label: '本期客户' },
      { key: 'lastCustomer', label: '上期客户' },
    ],
  },
  {
    key: 'config',
    label: '配置',
    hint: '部门 / 保管人 / DRI',
    fields: [
      { key: 'departmentData', label: '保管部门配置' },
      { key: 'custodianData', label: '保管人配置' },
      { key: 'driData', label: '客户 DRI 配置' },
    ],
  },
]

export const ASSET_INPUT_FIELDS = ASSET_INPUT_GROUPS.flatMap((group) => group.fields)
export const ASSET_REQUIRED_COUNT = ASSET_INPUT_FIELDS.length

export const ASSET_MODULE_LABELS: Record<AssetModuleKey, string> = {
  ff: '财务-财务',
  nn: 'Notes-Notes',
  sfc: 'SFC-SFC',
  cc: '客户-客户',
  fn: '财务-Notes',
  ns: 'Notes-SFC',
  cn: '客户-Notes',
}

export const ASSET_MODULE_KEYS: AssetModuleKey[] = ['ff', 'nn', 'sfc', 'cc', 'fn', 'ns', 'cn']

export const ASSET_DIFFERENCE_TYPE_LABELS: Record<AssetDifferenceType, string> = {
  all: '全部',
  new: '新增',
  removed: '移除',
  anomaly: '异常',
  custodianNew: '保管人新增',
  custodianRemoved: '保管人移除',
  deptNew: '部门新增',
  deptRemoved: '部门移除',
}

export const ASSET_REVIEW_OPTIONS = ['差異確認OK', '待跟进', '異常'].map((value) => ({
  label: value,
  value,
}))

export const ASSET_JOB_STATUS_META: Record<
  AssetJobStatus,
  { label: string; color: string; active: boolean }
> = {
  queued: { label: '排队中', color: 'default', active: true },
  validating: { label: '校验输入', color: 'processing', active: true },
  running: { label: '核对中', color: 'processing', active: true },
  base_ready: { label: '待复核', color: 'gold', active: false },
  finalizing: { label: '生成归档', color: 'processing', active: true },
  complete: { label: '已完成', color: 'success', active: false },
  partial_failed: { label: '部分失败', color: 'warning', active: false },
  failed: { label: '失败', color: 'error', active: false },
  cancel_requested: { label: '取消中', color: 'warning', active: true },
  cancelled: { label: '已取消', color: 'default', active: false },
  expired: { label: '已过期', color: 'default', active: false },
}

export const ASSET_ARTIFACT_LABELS: Record<string, string> = {
  module_ff: '模块文件 · 财务-财务',
  module_nn: '模块文件 · Notes-Notes',
  module_sfc: '模块文件 · SFC-SFC',
  module_cc: '模块文件 · 客户-客户',
  module_fn: '模块文件 · 财务-Notes',
  module_ns: '模块文件 · Notes-SFC',
  module_cn: '模块文件 · 客户-Notes',
  raw_data_xlsx: '原始数据汇总',
  final_bundle: '完整归档包',
}

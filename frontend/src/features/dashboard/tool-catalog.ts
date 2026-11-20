import type { ComponentType } from 'react'
import {
  BarChartOutlined,
  BgColorsOutlined,
  ClockCircleOutlined,
  FilePdfOutlined,
  FileSearchOutlined,
  MergeCellsOutlined,
  QrcodeOutlined,
  RetweetOutlined,
  UploadOutlined,
} from '@ant-design/icons'

export type ToolCategory = '数据处理' | '质量分析' | '文件工具'
export type ToolMigrationStatus = 'ready' | 'migrating'

export interface ToolDefinition {
  id: string
  permission: string
  path: string
  name: string
  description: string
  category: ToolCategory
  icon: ComponentType
  accent: string
  status: ToolMigrationStatus
}

export const TOOL_CATALOG: ToolDefinition[] = [
  {
    id: 'qrcode',
    permission: 'tool:qrcode:use',
    path: '/tools/qrcode',
    name: '二维码生成',
    description: '将文本生成可下载的二维码图片。',
    category: '文件工具',
    icon: QrcodeOutlined,
    accent: '#10b981',
    status: 'ready',
  },
  {
    id: 'asset-comparison',
    permission: 'tool:asset-comparison:use',
    path: '/tools/asset-comparison',
    name: '资产核对',
    description: '对比财务、SFC、Notes 与客户账目，定位保管人与部门差异。',
    category: '质量分析',
    icon: FileSearchOutlined,
    accent: '#4f46e5',
    status: 'migrating',
  },
  {
    id: 'attendance-organizer',
    permission: 'tool:attendance-organizer:use',
    path: '/tools/attendance-organizer',
    name: '出勤资料整理',
    description: '整理通行记录，标记离岗、用餐、超时与数据异常。',
    category: '数据处理',
    icon: UploadOutlined,
    accent: '#0ea5e9',
    status: 'migrating',
  },
  {
    id: 'atlas-merge',
    permission: 'tool:atlas-merge:use',
    path: '/tools/atlas-merge',
    name: 'AtlasLog Merge',
    description: '合并 unit-archive 测试日志为统一 CSV 结果。',
    category: '数据处理',
    icon: MergeCellsOutlined,
    accent: '#14b8a6',
    status: 'migrating',
  },
  {
    id: 'cpk-charts',
    permission: 'tool:cpk-charts:use',
    path: '/tools/cpk-charts',
    name: 'OPP / CPK',
    description: '导入测试导出数据，查看直方图、CDF、时序与相关性。',
    category: '质量分析',
    icon: BarChartOutlined,
    accent: '#f59e0b',
    status: 'migrating',
  },
  {
    id: 'image-to-pdf',
    permission: 'tool:image-to-pdf:use',
    path: '/tools/image-to-pdf',
    name: '图片转 PDF',
    description: '将多张图片按顺序合并为单个 A4 PDF 文件。',
    category: '文件工具',
    icon: FilePdfOutlined,
    accent: '#f97316',
    status: 'ready',
  },
  {
    id: 'box-plot',
    permission: 'tool:box-plot:use',
    path: '/tools/box-plot',
    name: '箱线图',
    description: '按分组对比五数分布、离群点与时间桶趋势。',
    category: '质量分析',
    icon: BgColorsOutlined,
    accent: '#ec4899',
    status: 'migrating',
  },
  {
    id: 'tt-time',
    permission: 'tool:tt-time:use',
    path: '/tools/tt-time',
    name: '测试时间分析',
    description: '统计测试时间分布、机台箱线图与各机台数据对比。',
    category: '质量分析',
    icon: ClockCircleOutlined,
    accent: '#8b5cf6',
    status: 'migrating',
  },
  {
    id: 'retest-rate',
    permission: 'tool:retest-rate:use',
    path: '/tools/retest-rate',
    name: '重测率统计',
    description: '按 SN 统计重测率、不良率、机台穴位与明细。',
    category: '质量分析',
    icon: RetweetOutlined,
    accent: '#ef4444',
    status: 'migrating',
  },
]

export const TOOL_BY_ID = new Map(TOOL_CATALOG.map((tool) => [tool.id, tool]))

import React from 'react'
import {
  BarChart3,
  Calendar,
  ChartColumn,
  FolderTree,
  Images,
  QrCode,
  RotateCcw,
  Search,
  Timer,
  Upload,
  type LucideIcon,
} from 'lucide-react'

export interface ToolDefinition {
  id: string
  /** 该工具对应的权限 codename（tool:<id>:use），权限数据唯一来源 */
  permission: string
  name: string
  icon: LucideIcon
  path: string
  description: string
  component: React.LazyExoticComponent<React.FC>
}

const QrcodeGenerator = React.lazy(() => import('../pages/tools/qrcode/index'))
const AssetComparison = React.lazy(() => import('../pages/tools/asset-comparison/index'))
const AttendanceOrganizer = React.lazy(
  () => import('../pages/tools/attendance-organizer/index'),
)
const AtlasMerge = React.lazy(() => import('../pages/tools/atlas-merge/index'))
const CpkCharts = React.lazy(() => import('../pages/tools/cpk-charts/index'))
const ImageToPdf = React.lazy(() => import('../pages/tools/image-to-pdf/index'))
const BoxPlot = React.lazy(() => import('../pages/tools/box-plot/index'))
const CalendarTool = React.lazy(() => import('../pages/tools/calendar/index'))
const TtTime = React.lazy(() => import('../pages/tools/tt-time/index'))
const RetestRate = React.lazy(() => import('../pages/tools/retest-rate/index'))

export const toolsConfig: ToolDefinition[] = [
  {
    id: 'qrcode',
    permission: 'tool:qrcode:use',
    name: '二维码生成',
    icon: QrCode,
    path: '/tools/qrcode',
    description: '将文本生成可下载的二维码图片。',
    component: QrcodeGenerator,
  },
  {
    id: 'asset-comparison',
    permission: 'tool:asset-comparison:use',
    name: '资产核对',
    icon: Search,
    path: '/tools/asset-comparison',
    description: '对比并核实财务数据与部门及保管人账目明细。',
    component: AssetComparison,
  },
  {
    id: 'attendance-organizer',
    permission: 'tool:attendance-organizer:use',
    name: '出勤资料整理',
    icon: Upload,
    path: '/tools/attendance-organizer',
    description: '整理通行记录并标记离岗、用餐、超时及数据异常。',
    component: AttendanceOrganizer,
  },
  {
    id: 'atlas-merge',
    permission: 'tool:atlas-merge:use',
    name: 'AtlasLog Merge',
    icon: FolderTree,
    path: '/tools/atlas-merge',
    description: '合并 unit-archive 测试日志为统一 CSV 结果。',
    component: AtlasMerge,
  },
  {
    id: 'cpk-charts',
    permission: 'tool:cpk-charts:use',
    name: 'OPP',
    icon: BarChart3,
    path: '/tools/cpk-charts',
    description: '导入测试导出 CSV，点选测试项查看 CPK 过程能力直方图。',
    component: CpkCharts,
  },
  {
    id: 'calendar',
    permission: 'tool:calendar:use',
    name: '日历',
    icon: Calendar,
    path: '/tools/calendar',
    description: '农历黄历、节气宜忌与假期倒计时。',
    component: CalendarTool,
  },
  {
    id: 'image-to-pdf',
    permission: 'tool:image-to-pdf:use',
    name: '图片转 PDF',
    icon: Images,
    path: '/tools/image-to-pdf',
    description: '将单张或多张图片按顺序合并为单个 PDF 文件。',
    component: ImageToPdf,
  },
  {
    id: 'box-plot',
    permission: 'tool:box-plot:use',
    name: '箱线图',
    icon: ChartColumn,
    path: '/tools/box-plot',
    description: '上传 CSV/Excel 数据，按分组对比五数分布与离群点。',
    component: BoxPlot,
  },
  {
    id: 'tt-time',
    permission: 'tool:tt-time:use',
    name: '测试时间分析',
    icon: Timer,
    path: '/tools/tt-time',
    description: '测试日志时间分析：包含测试时间分布、机台箱线图与各机台数据对比。',
    component: TtTime,
  },
  {
    id: 'retest-rate',
    permission: 'tool:retest-rate:use',
    name: '重测率统计',
    icon: RotateCcw,
    path: '/tools/retest-rate',
    description: '汇总 insight/DCR/Atlas/Summary/Unit Archive 测试 CSV，按 SN 统计重测率、不良率与明细。',
    component: RetestRate,
  },
]

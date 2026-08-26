import React from 'react';
import {
  CalendarBlank,
  ChartBarHorizontal,
  FileArrowUp,
  FileImage,
  FileMagnifyingGlass,
  Heartbeat,
  Key,
  Newspaper,
  Palette,
  QrCode,
  TextT,
  TreeStructure,
} from '@phosphor-icons/react';
import type { IconProps } from '@phosphor-icons/react';

// Tool Definition Interface
export interface ToolDefinition {
  id: string;
  /** 该工具对应的权限 codename（tool:<id>:use），权限数据唯一来源 */
  permission: string;
  name: string;
  icon: React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>>;
  path: string;
  description: string;
  component: React.LazyExoticComponent<React.FC>;
}

// Lazy loaded components for automatic code splitting
const PwdGenerator = React.lazy(() => import('../pages/tools/pwd-generator/index'));
const StringAnalyzer = React.lazy(() => import('../pages/tools/string-analyzer/index'));
const ColorPicker = React.lazy(() => import('../pages/tools/color-picker/index'));
const QrcodeGenerator = React.lazy(() => import('../pages/tools/qrcode/index'));
const AssetComparison = React.lazy(() => import('../pages/tools/asset-comparison/index'));
const AttendanceOrganizer = React.lazy(
  () => import('../pages/tools/attendance-organizer/index')
);
const AtlasMerge = React.lazy(() => import('../pages/tools/atlas-merge/index'));
const ImageToPdf = React.lazy(() => import('../pages/tools/image-to-pdf/index'));
const BoxPlot = React.lazy(() => import('../pages/tools/box-plot/index'));

const Health = React.lazy(() => import('../pages/tools/health/index'));
const Calendar = React.lazy(() => import('../pages/tools/calendar/index'));
const SixtySeconds = React.lazy(() => import('../pages/tools/sixty-seconds/index'));

export const toolsConfig: ToolDefinition[] = [
  {
    id: 'pwd-generator',
    permission: 'tool:pwd-generator:use',
    name: '密钥生成器',
    icon: Key,
    path: '/tools/pwd-generator',
    description: '在本地生成具有确定性参数的高熵密钥。',
    component: PwdGenerator,
  },
  {
    id: 'string-analyzer',
    permission: 'tool:string-analyzer:use',
    name: '字符处理器',
    icon: TextT,
    path: '/tools/string-analyzer',
    description: '检查字符串属性并执行 Base64 编码解码周期。',
    component: StringAnalyzer,
  },
  {
    id: 'color-picker',
    permission: 'tool:color-picker:use',
    name: '颜色工具',
    icon: Palette,
    path: '/tools/color-picker',
    description: '颜色格式转换与配色方案生成。',
    component: ColorPicker,
  },
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
    icon: FileMagnifyingGlass,
    path: '/tools/asset-comparison',
    description: '对比并核实财务数据与部门及保管人账目明细。',
    component: AssetComparison,
  },
  {
    id: 'attendance-organizer',
    permission: 'tool:attendance-organizer:use',
    name: '出勤资料整理',
    icon: FileArrowUp,
    path: '/tools/attendance-organizer',
    description: '整理通行记录并标记离岗、用餐、超时及数据异常。',
    component: AttendanceOrganizer,
  },
  {
    id: 'atlas-merge',
    permission: 'tool:atlas-merge:use',
    name: 'AtlasLog Merge',
    icon: TreeStructure,
    path: '/tools/atlas-merge',
    description: '合并 unit-archive 测试日志为统一 CSV 结果。',
    component: AtlasMerge,
  },
  {
    id: 'health',
    permission: 'tool:health:use',
    name: '健康指标',
    icon: Heartbeat,
    path: '/tools/health',
    description: '计算 BMI、基础代谢与推荐热量。',
    component: Health,
  },
  {
    id: 'calendar',
    permission: 'tool:calendar:use',
    name: '日历',
    icon: CalendarBlank,
    path: '/tools/calendar',
    description: '农历黄历、节气宜忌与摸鱼倒计时。',
    component: Calendar,
  },
  {
    id: 'sixty-seconds',
    permission: 'tool:sixty-seconds:use',
    name: '60s 每日新闻',
    icon: Newspaper,
    path: '/tools/sixty-seconds',
    description: '每天 60 秒读懂世界。',
    component: SixtySeconds,
  },
  {
    id: 'image-to-pdf',
    permission: 'tool:image-to-pdf:use',
    name: '图片转 PDF',
    icon: FileImage,
    path: '/tools/image-to-pdf',
    description: '将单张或多张图片按顺序合并为单个 PDF 文件。',
    component: ImageToPdf,
  },
  {
    id: 'box-plot',
    permission: 'tool:box-plot:use',
    name: '箱线图',
    icon: ChartBarHorizontal,
    path: '/tools/box-plot',
    description: '上传 CSV/Excel 数据，按分组对比五数分布与离群点。',
    component: BoxPlot,
  },
];

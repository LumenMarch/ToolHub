import React from 'react';
import {
  FileArrowUp,
  FileMagnifyingGlass,
  Key,
  Palette,
  QrCode,
  TextT,
  TreeStructure,
} from '@phosphor-icons/react';
import type { IconProps } from '@phosphor-icons/react';

// Tool Definition Interface
export interface ToolDefinition {
  id: string;
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

export const toolsConfig: ToolDefinition[] = [
  {
    id: 'pwd-generator',
    name: '密钥生成器',
    icon: Key,
    path: '/tools/pwd-generator',
    description: '在本地生成具有确定性参数的高熵密钥。',
    component: PwdGenerator
  },
  {
    id: 'string-analyzer',
    name: '字符处理器',
    icon: TextT,
    path: '/tools/string-analyzer',
    description: '检查字符串属性并执行 Base64 编码解码周期。',
    component: StringAnalyzer
  },
  {
    id: 'color-picker',
    name: '颜色工具',
    icon: Palette,
    path: '/tools/color-picker',
    description: '颜色格式转换与配色方案生成。',
    component: ColorPicker
  },
  {
    id: 'qrcode',
    name: '二维码生成',
    icon: QrCode,
    path: '/tools/qrcode',
    description: '将文本生成可下载的二维码图片。',
    component: QrcodeGenerator
  },
  {
    id: 'asset-comparison',
    name: '资产核对',
    icon: FileMagnifyingGlass,
    path: '/tools/asset-comparison',
    description: '对比并核实财务数据与部门及保管人账目明细。',
    component: AssetComparison
  },
  {
    id: 'attendance-organizer',
    name: '出勤资料整理',
    icon: FileArrowUp,
    path: '/tools/attendance-organizer',
    description: '整理通行记录并标记离岗、用餐、超时及数据异常。',
    component: AttendanceOrganizer
  },
  {
    id: 'atlas-merge',
    name: 'AtlasLog Merge',
    icon: TreeStructure,
    path: '/tools/atlas-merge',
    description: '合并 unit-archive 测试日志为统一 CSV 结果。',
    component: AtlasMerge
  }
];

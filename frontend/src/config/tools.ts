import React from 'react';
import { Key, TextT } from '@phosphor-icons/react';
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
const PwdGenerator = React.lazy(() => import('../pages/tools/PwdGenerator'));
const StringAnalyzer = React.lazy(() => import('../pages/tools/StringAnalyzer'));

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
  }
];

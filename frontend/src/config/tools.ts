import { Key, TextT } from '@phosphor-icons/react';

export const toolsConfig = [
  {
    id: 'pwd-generator',
    name: '密钥生成器',
    icon: Key,
    path: '/tools/pwd-generator',
    description: '在本地生成具有确定性参数的高熵密钥。',
  },
  {
    id: 'string-analyzer',
    name: '字符处理器',
    icon: TextT,
    path: '/tools/string-analyzer',
    description: '检查字符串属性并执行 Base64 编码解码周期。',
  }
];

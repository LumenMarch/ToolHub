import React, { useMemo } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LlmCapabilities } from '../../../types/llm';
import { EXPLICIT_EMPTY, INHERIT, INHERIT_OPTION } from './fields';

interface Props {
  id: string;
  /** 表单里的原始值：INHERIT=继承 env，EXPLICIT_EMPTY=不发该字段，其余是档位 */
  value: string;
  envDefault: string;
  capabilities: LlmCapabilities | null;
  onChange: (value: string) => void;
}

/** 分档档位。能不能用、有哪些，由服务端上报决定，不在这里猜。 */
const LEVELS = ['none', 'low', 'medium', 'high', 'max'];

const LEVEL_LABELS: Record<string, string> = {
  none: 'none（关闭思考）',
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
};

/**
 * 思考模式与等级。
 *
 * 为什么不让界面自己列档位：实测同一台 llama.cpp（b11067）上，
 * chat_template_caps.supports_reasoning_effort=false 的模型选 low / high 会
 * 静默无效，而 reasoning_effort=none 确实能关掉思考（正文直接出，没有
 * reasoning_content）。把「能选什么」交给服务端上报，界面只负责把不支持的
 * 选项收掉并说明原因。
 */
export const LlmThinkingField: React.FC<Props> = ({
  id,
  value,
  envDefault,
  capabilities,
  onChange,
}) => {
  /** 服务端明确说支持分档才放开等级；没说时保持可用（保底不误伤）。 */
  const levelsUsable = capabilities?.reasoningEffort !== false;
  const serverSays = capabilities !== null;

  const options = useMemo(() => {
    const base = [
      { value: INHERIT_OPTION, label: '继承 env' },
      { value: EXPLICIT_EMPTY, label: '不发送该字段（模型默认）' },
    ];
    if (levelsUsable) {
      return [...base, ...LEVELS.map((level) => ({ value: level, label: LEVEL_LABELS[level] }))];
    }
    // 不支持分档时只留真正有意义的两态：跟随模型 / 关掉
    return [...base, { value: 'none', label: '关闭思考' }];
  }, [levelsUsable]);

  // 之前存过档位、现在服务端说不支持：不静默改写用户配置，而是把它显式列出来
  const staleLevel = !levelsUsable && value !== INHERIT && value !== EXPLICIT_EMPTY && value !== 'none';
  const shownValue = staleLevel ? value : value === INHERIT ? INHERIT_OPTION : value;

  const note = !serverSays
    ? '服务端未上报能力，按 OpenAI 兼容约定列出档位；实际是否生效取决于模型模板。'
    : levelsUsable
      ? '服务端上报模板支持分档。'
      : '服务端上报模板不支持分档：选 low / high 会静默无效，只能整体开关。';

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={shownValue}
        onValueChange={(next) => onChange(next === INHERIT_OPTION ? INHERIT : next)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="继承 env" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {staleLevel ? (
            <SelectItem value={value} disabled>
              当前值 {value}（服务端不支持）
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{note}</p>
      {envDefault ? (
        <p className="text-xs text-muted-foreground">env 默认：{envDefault || '不发送'}</p>
      ) : null}
    </div>
  );
};

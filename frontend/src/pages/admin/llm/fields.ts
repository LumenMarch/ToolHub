import type { LlmCapabilities, LlmOverrides } from '../../../types/llm';

/** 覆盖层里「继承 env」的哨兵值：表单里用空串表示，提交时转成不下发。 */
export const INHERIT = '';
/** Radix 不允许 SelectItem 的 value 为空串，下拉框里用这个哨兵代表「继承」。 */
export const INHERIT_OPTION = '__inherit__';
/** 显式发送空值的哨兵（例如 reasoning_effort 需要发 ""，表示不带这个字段）。 */
export const EXPLICIT_EMPTY = '__empty__';

export type FieldKey = keyof LlmOverrides;

export interface FieldSpec {
  key: FieldKey;
  label: string;
  hint: string;
  /** envDefaults 里对应的 camelCase 键，用作 placeholder 展示默认值 */
  envKey: string;
  kind: 'text' | 'number' | 'select' | 'secret' | 'model' | 'thinking';
  options?: Array<{ value: string; label: string }>;
  group: 'connection' | 'generation' | 'reliability' | 'cache';
}

export const PROVIDER_OPTIONS = [
  { value: 'openai_compat', label: 'OpenAI 兼容（llama.cpp / vLLM / Ollama /v1）' },
  { value: 'ollama', label: 'Ollama 原生 /api/chat' },
];

const INHERIT_OPTION_ENTRY = { value: INHERIT_OPTION, label: '继承 env' };

export const FIELD_SPECS: FieldSpec[] = [
  {
    key: 'enabled',
    label: '服务开关',
    hint: '停用后所有工具立即不可用',
    envKey: 'enabled',
    kind: 'select',
    options: [INHERIT_OPTION_ENTRY, { value: 'true', label: '启用' }, { value: 'false', label: '停用' }],
    group: 'connection',
  },
  {
    key: 'provider',
    label: '协议',
    hint: 'Ollama 原生协议才支持逐请求 num_ctx/think',
    envKey: 'provider',
    kind: 'select',
    options: [INHERIT_OPTION_ENTRY, ...PROVIDER_OPTIONS],
    group: 'connection',
  },
  {
    key: 'base_url',
    label: '服务地址',
    hint: '需带 http:// 前缀；Ollama 协议不用带 /v1',
    envKey: 'baseUrl',
    kind: 'text',
    group: 'connection',
  },
  {
    key: 'api_key',
    label: 'API Key',
    hint: '本地服务通常留空',
    envKey: 'apiKeySet',
    kind: 'secret',
    group: 'connection',
  },
  {
    key: 'model',
    label: '模型名',
    hint: '需与 /v1/models 返回的名字一致',
    envKey: 'model',
    kind: 'model',
    group: 'connection',
  },
  {
    key: 'max_tokens',
    label: 'max_tokens',
    hint: '思考内容也吃这份预算，太小会得到空正文',
    envKey: 'maxTokens',
    kind: 'number',
    group: 'generation',
  },
  {
    key: 'temperature',
    label: 'temperature',
    hint: '结论要可复现就取低温',
    envKey: 'temperature',
    kind: 'number',
    group: 'generation',
  },
  {
    key: 'reasoning_effort',
    label: '思考模式与等级',
    hint: '可选档位由服务端上报的模板能力决定',
    envKey: 'reasoningEffort',
    kind: 'thinking',
    group: 'generation',
  },
  {
    key: 'num_ctx',
    label: '上下文窗口',
    hint: '0 = 由服务端决定；服务端实际上报值见上方运行状态',
    envKey: 'numCtx',
    kind: 'number',
    group: 'generation',
  },
  {
    key: 'connect_timeout_seconds',
    label: '连接超时(秒)',
    hint: '只管建连，与推理耗时无关',
    envKey: 'connectTimeoutSeconds',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'timeout_seconds',
    label: '读超时(秒)',
    hint: '本地模型跑一分钟很正常，别调太小',
    envKey: 'timeoutSeconds',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'max_concurrency',
    label: '并发容量',
    hint: '本地单卡 1~2；超发只会排到超时',
    envKey: 'maxConcurrency',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'max_queued',
    label: '排队上限',
    hint: '超出立即 429 带 Retry-After',
    envKey: 'maxQueued',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'max_retries',
    label: '重试次数',
    hint: '只重试连接失败/超时/429/5xx',
    envKey: 'maxRetries',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'retry_base_delay_seconds',
    label: '重试退避(秒)',
    hint: '重试前的等待时长',
    envKey: 'retryBaseDelaySeconds',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'allowed_failures',
    label: '熔断阈值(次)',
    hint: '连续失败达到此数进入冷却',
    envKey: 'allowedFailures',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'cooldown_seconds',
    label: '冷却时长(秒)',
    hint: '期间直接拒绝；改配置立即解除',
    envKey: 'cooldownSeconds',
    kind: 'number',
    group: 'reliability',
  },
  {
    key: 'cache_ttl_seconds',
    label: '结果缓存(秒)',
    hint: '重复点击直接命中；0 = 关闭',
    envKey: 'cacheTtlSeconds',
    kind: 'number',
    group: 'cache',
  },
  {
    key: 'cache_max_entries',
    label: '缓存条目上限',
    hint: 'LRU 容量，超出淘汰最旧',
    envKey: 'cacheMaxEntries',
    kind: 'number',
    group: 'cache',
  },
  {
    key: 'health_cache_ttl_seconds',
    label: '探活复用(秒)',
    hint: '状态页探活结果的复用时长',
    envKey: 'healthCacheTtlSeconds',
    kind: 'number',
    group: 'cache',
  },
];

export interface FieldGroup {
  id: FieldSpec['group'];
  title: string;
  description: string;
  fields: FieldSpec[];
}

/** 分组在模块加载时一次算完：渲染期不再 filter+map 双层迭代。 */
export const FIELD_GROUPS: FieldGroup[] = (() => {
  const groups: FieldGroup[] = [
    { id: 'connection', title: '连接', description: '模型服务在哪、用什么协议、叫什么名字', fields: [] },
    {
      id: 'generation',
      title: '生成参数',
      description: '这些值会进入结果缓存键，改动即失效旧缓存',
      fields: [],
    },
    {
      id: 'reliability',
      title: '并发与容错',
      description: '多人共用一台模型机时的关键',
      fields: [],
    },
    { id: 'cache', title: '结果缓存', description: '进程内 TTL + LRU，不落盘', fields: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const spec of FIELD_SPECS) {
    byId.get(spec.group)?.fields.push(spec);
  }
  return groups;
})();

export function toInputValue(raw: unknown): string {
  if (raw === null || raw === undefined) return INHERIT;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

/** 把输入框文本转成后端字段值；INHERIT = 不下发，EXPLICIT_EMPTY = 下发空串。 */
export function toPayloadValue(spec: FieldSpec, text: string): unknown {
  if (text === INHERIT) return undefined;
  if (text === EXPLICIT_EMPTY) return '';
  if (spec.kind === 'number') return Number(text);
  if (spec.key === 'enabled') return text === 'true';
  return text;
}

/** 初始表单值：密钥字段永远不回显，其余按覆盖层原值回填。 */
export function initialFormValues(overrides: LlmOverrides): Partial<Record<FieldKey, string>> {
  const values: Partial<Record<FieldKey, string>> = {};
  for (const spec of FIELD_SPECS) {
    const raw = overrides[spec.key];
    if (spec.kind === 'secret') {
      values[spec.key] = INHERIT;
    } else if (spec.kind === 'thinking' && raw === '') {
      // 覆盖层的空串对 thinking 是「显式不发送」，与继承撞在 '' 上，必须分开
      values[spec.key] = EXPLICIT_EMPTY;
    } else {
      values[spec.key] = toInputValue(raw);
    }
  }
  return values;
}

/**
 * 计算要下发的 PATCH 体。
 *
 * 三态语义必须原样递给后端：
 * - 与覆盖层当前值相同 → 不下发；
 * - 从「有覆盖」被清空 → 显式下发 null（恢复继承 env）；
 * - 有新值 → 下发新值。
 */
export function buildPatchPayload(args: {
  overrides: LlmOverrides;
  values: Partial<Record<FieldKey, string>>;
  clearApiKey: boolean;
}): Record<string, unknown> {
  const { overrides, values, clearApiKey } = args;
  const payload: Record<string, unknown> = {};
  for (const spec of FIELD_SPECS) {
    const text = values[spec.key] ?? INHERIT;
    if (spec.kind === 'secret') {
      if (text !== INHERIT) payload.api_key = text;
      else if (clearApiKey) payload.api_key = null;
      continue;
    }
    const next = toPayloadValue(spec, text);
    if (next === undefined) {
      // 输入框为空：原本有覆盖才需要下发 null 去继承
      if (overrides[spec.key] !== null) payload[spec.key] = null;
      continue;
    }
    if (next !== overrides[spec.key]) payload[spec.key] = next;
  }
  return payload;
}

/**
 * 服务端上报的思考相关能力摘要，用于状态面板与表单说明。
 *
 * 只说服务端确实给了的东西；「不支持」与「没上报」不能混为一谈。
 */
export function describeThinkingCaps(caps: LlmCapabilities | null): string {
  if (!caps) return '服务端未上报思考能力';
  const bits: string[] = [];
  if (caps.reasoningEffort === true) bits.push('支持分档');
  else if (caps.reasoningEffort === false) bits.push('不支持分档');
  if (caps.thinkingToggle === true) bits.push('可整体开关');
  else if (caps.thinkingToggle === false) bits.push('无思考开关');
  if (caps.preserveReasoning) bits.push('可回传思考内容');
  if (caps.reasoningInContent) bits.push('思考混在正文里');
  return bits.length ? bits.join(' · ') : '未上报';
}

/** 有多少字段相对当前覆盖层发生了变化（用于「保存（N）」按钮文案）。 */
export function countDirtyFields(
  overrides: LlmOverrides,
  values: Partial<Record<FieldKey, string>>,
  clearApiKey: boolean,
): number {
  return Object.keys(buildPatchPayload({ overrides, values, clearApiKey })).length;
}

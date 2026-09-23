/**
 * 全局模型服务（LLM 网关）的前端契约类型。
 *
 * 与后端 app/schemas/llm.py 对应。两个视图分工不同：
 * - LlmStatus 给工具页做可用性门控（登录即可读，字段刻意收窄）；
 * - LlmConfigResponse 给管理台，含覆盖层原值与 env 默认值。
 */

/**
 * 服务端自报能力（llama.cpp /props、Ollama /api/show）。
 *
 * null 表示服务端没说这一项，与 false（明确不支持）必须区分：
 * 一个不报能力的 OpenAI 兼容端点不该被当成不支持思考。
 */
export interface LlmCapabilities {
  source: string;
  buildInfo: string | null;
  nCtx: number | null;
  totalSlots: number | null;
  reasoningEffort: boolean | null;
  preserveReasoning: boolean | null;
  thinkingToggle: boolean | null;
  reasoningInContent: boolean | null;
  modelFtype: string | null;
}

export interface LlmStatus {
  enabled: boolean;  configured: boolean;
  /** 唯一该看的字段：按钮可点还是置灰 */
  available: boolean;
  cooldownActive: boolean;
  lastError: string | null;
  model: string;
  provider: string;
  lastProbe: {
    ok: boolean;
    reachable: boolean;
    models: string[];
    error: string | null;
    capabilities: LlmCapabilities | null;
  } | null;
  modelListed: boolean | null;
  supportedProviders: string[];
  gate: {
    capacity: number;
    maxQueued: number;
    inflight: number;
    queued: number;
  };
  cache: {
    entries: number;
    capacity: number;
    ttlSeconds: number;
    hits: number;
    misses: number;
    evictions: number;
    hitPercent: number;
  };
  metrics: {
    requests: number;
    ok: number;
    cached: number;
    errors: number;
    rejections: number;
    errorPercent: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
    promptTokens: number;
    completionTokens: number;
    inflight: number;
    queued: number;
    peakQueued: number;
    errorCodes: Record<string, number>;
    cooldownActive: boolean;
    uptimeSeconds: number;
    bySource: Record<string, Record<string, number>>;
  };
}

export interface LlmEffectiveConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  connectTimeoutSeconds: number;
  maxTokens: number;
  temperature: number;
  reasoningEffort: string;
  numCtx: number;
  maxConcurrency: number;
  maxQueued: number;
  maxRetries: number;
  retryBaseDelaySeconds: number;
  allowedFailures: number;
  cooldownSeconds: number;
  cacheTtlSeconds: number;
  cacheMaxEntries: number;
  healthCacheTtlSeconds: number;
  apiKeySet: boolean;
  apiKeyMask: string;
  source: 'env' | 'db';
}

/** 覆盖层原值：null = 该项继承 env。 */
export interface LlmOverrides {
  enabled: boolean | null;
  provider: string | null;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  timeout_seconds: number | null;
  connect_timeout_seconds: number | null;
  max_tokens: number | null;
  temperature: number | null;
  reasoning_effort: string | null;
  num_ctx: number | null;
  max_concurrency: number | null;
  max_queued: number | null;
  max_retries: number | null;
  retry_base_delay_seconds: number | null;
  allowed_failures: number | null;
  cooldown_seconds: number | null;
  cache_ttl_seconds: number | null;
  cache_max_entries: number | null;
  health_cache_ttl_seconds: number | null;
}

export interface LlmConfigResponse {
  effective: LlmEffectiveConfig;
  overrides: LlmOverrides;
  overriddenFields: string[];
  envDefaults: Record<string, unknown>;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
}

/** 管理台提交体：字段不下发 = 不动；显式 null = 恢复继承 env。 */
export type LlmConfigUpdateInput = Partial<Record<keyof LlmOverrides, unknown>> & {
  [key: string]: unknown;
};

export interface LlmProbeResult {
  ok: boolean;
  reachable: boolean;
  models: string[];
  error: string | null;
  expectedModel: string;
  modelListed: boolean | null;
  supportedProviders: string[];
  capabilities: LlmCapabilities | null;
}

/** 后端统一错误契约（app/services/llm/errors.py）在前端的镜像。 */
export interface LlmErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

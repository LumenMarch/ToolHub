"""LLM 网关的 API 数据结构。

约定：管理台侧沿用后端 snake_case（与 ToolMeta 一致），工具侧与状态接口用
camelCase（与前端其它工具接口一致）。api_key 一律只回掩码。
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

LlmProviderName = Literal["openai_compat", "ollama"]


class LlmChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class LlmConfigUpdate(BaseModel):
    """覆盖层更新请求。

    语义是显式三态，管理台必须按这个来：
    - 字段不出现在请求体里 = 不动这一项；
    - 字段值为 null   = 删除该项覆盖，恢复继承 env；
    - 字段有值        = 写入覆盖值。
    因此端点必须用 model_dump(exclude_unset=True)，不能 exclude_none。
    """

    enabled: bool | None = None
    provider: LlmProviderName | None = None
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=300)
    timeout_seconds: float | None = Field(default=None, gt=0, le=3600)
    connect_timeout_seconds: float | None = Field(default=None, gt=0, le=120)
    max_tokens: int | None = Field(default=None, ge=16, le=32768)
    temperature: float | None = Field(default=None, ge=0, le=2)
    reasoning_effort: str | None = Field(default=None, max_length=20)
    num_ctx: int | None = Field(default=None, ge=0, le=1_048_576)
    max_concurrency: int | None = Field(default=None, ge=1, le=32)
    max_queued: int | None = Field(default=None, ge=0, le=256)
    max_retries: int | None = Field(default=None, ge=0, le=5)
    retry_base_delay_seconds: float | None = Field(default=None, ge=0, le=30)
    allowed_failures: int | None = Field(default=None, ge=1, le=20)
    cooldown_seconds: float | None = Field(default=None, gt=0, le=3600)
    cache_ttl_seconds: int | None = Field(default=None, ge=0, le=86_400)
    cache_max_entries: int | None = Field(default=None, ge=1, le=10_000)
    health_cache_ttl_seconds: float | None = Field(default=None, ge=0, le=3600)

    @field_validator("base_url")
    @classmethod
    def _require_absolute_url(cls, value: str | None) -> str | None:
        """拦下「192.168.2.3:8888/v1」这种漏写协议的写法。

        不补协议、只报错：默默补 http:// 会把一个手误变成明文传输，
        这种事应该让人看见。
        """
        if value is None:
            return None
        stripped = value.strip()
        if not stripped.startswith(("http://", "https://")):
            raise ValueError("服务地址必须以 http:// 或 https:// 开头")
        return stripped


class LlmEffectiveConfig(BaseModel):
    """env 与覆盖层合并后的实际生效值（api_key 只有掩码）。"""

    enabled: bool
    provider: str
    baseUrl: str
    model: str
    timeoutSeconds: float
    connectTimeoutSeconds: float
    maxTokens: int
    temperature: float
    reasoningEffort: str
    numCtx: int
    maxConcurrency: int
    maxQueued: int
    maxRetries: int
    retryBaseDelaySeconds: float
    allowedFailures: int
    cooldownSeconds: float
    cacheTtlSeconds: int
    cacheMaxEntries: int
    healthCacheTtlSeconds: float
    apiKeySet: bool
    apiKeyMask: str
    source: Literal["env", "db"]


class LlmConfigResponse(BaseModel):
    """管理台一次拿全：生效值 + 覆盖层原值 + 来源标记 + 变更元信息。"""

    effective: LlmEffectiveConfig
    overrides: dict[str, object | None]
    # 哪些字段当前由覆盖层决定（管理台据此标「已覆盖」徽标）
    overriddenFields: list[str]
    envDefaults: dict[str, object]
    version: int
    updated_at: datetime | None
    updated_by: str | None


class LlmStatusResponse(BaseModel):
    """工具页可用性门控 + 管理台观测面板共用。"""

    enabled: bool
    configured: bool
    available: bool
    cooldownActive: bool
    lastError: str | None
    model: str
    provider: str
    lastProbe: dict[str, object] | None
    modelListed: bool | None
    supportedProviders: list[str]
    gate: dict[str, int]
    cache: dict[str, object]
    metrics: dict[str, object]

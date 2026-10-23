"""LLM 网关的 API 数据结构。

约定：管理台侧沿用后端 snake_case（与 ToolMeta 一致），工具侧与状态接口用
camelCase（与前端其它工具接口一致）。api_key 一律只回掩码。
"""

from __future__ import annotations

import ipaddress
import socket
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator

from app.core.config import settings

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
        """校验协议、凭据、目标主机与传输安全。

        管理台覆盖值只能指向运维批准的目标：``LLM_ALLOWED_HOSTS`` 为空时
        仅允许回环地址；远程主机必须使用 HTTPS 且解析结果不得落在内网/
        回环/链路本地/保留地址。白名单命中时跳过地址段检查，但仍禁止
        在 URL 中携带凭据、禁止对远程主机使用明文 HTTP。
        """
        if value is None:
            return None
        stripped = value.strip()
        parts = urlsplit(stripped)
        if parts.scheme not in {"http", "https"} or not parts.hostname:
            raise ValueError("服务地址必须以 http:// 或 https:// 开头且包含主机名")
        if parts.username or parts.password:
            raise ValueError("服务地址不得包含用户名或密码")
        try:
            port = parts.port
        except ValueError as exc:
            raise ValueError("服务地址端口无效") from exc

        host = parts.hostname.lower()
        loopback_hosts = {"localhost", "127.0.0.1", "::1"}
        try:
            loopback_host = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback_host = host in loopback_hosts
        allowed = {
            item.strip().lower()
            for item in settings.LLM_ALLOWED_HOSTS.split(",")
            if item.strip()
        }
        approved = host in allowed or (port is not None and f"{host}:{port}" in allowed)
        if not approved:
            if not loopback_host and parts.scheme != "https":
                raise ValueError("远程模型服务地址必须使用 https")
            if loopback_host:
                return stripped
            try:
                infos = socket.getaddrinfo(
                    host,
                    port or (443 if parts.scheme == "https" else 80),
                    type=socket.SOCK_STREAM,
                )
            except OSError as exc:
                raise ValueError("服务地址无法解析") from exc
            for info in infos:
                address = info[4][0].split("%", 1)[0]
                ip = ipaddress.ip_address(address)
                if (
                    ip.is_private
                    or ip.is_loopback
                    or ip.is_link_local
                    or ip.is_reserved
                    or ip.is_multicast
                    or ip.is_unspecified
                ):
                    raise ValueError(
                        "服务地址解析到内网/回环/链路本地地址，"
                        "需由运维加入 LLM_ALLOWED_HOSTS"
                    )
        elif not loopback_host and parts.scheme != "https":
            raise ValueError("远程模型服务地址必须使用 https")
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
    """管理台观测面板：配置、探活、队列、缓存与指标。"""

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


class LlmAvailabilityResponse(BaseModel):
    """工具页可用性门控：只暴露按钮态所需的最小字段。"""

    enabled: bool
    configured: bool
    available: bool
    cooldownActive: bool
    lastError: str | None

"""运行时配置解析：env 默认层 + 数据库覆盖层 → 生效快照。

每次请求读一次覆盖层（SQLite 主键单行读，微秒级），不做进程内缓存：
- 多 worker 下自动一致，不需要跨实例的配置失效广播；
- 与一次要跑几秒到几分钟的推理相比，这一行的读取成本可以忽略。

字段合并规则：覆盖层字段为 None 才回落到 env；空字符串是有效值
（例如把 reasoning_effort 设成 "" 表示「显式不发这个字段」），
但 base_url / model 的空串会被视为「未配置」，由 LlmProfile.configured 判定。
"""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.crud.crud_llm_config import read_overrides
from app.services.llm.types import LlmProfile, _mask_secret


def _pick(overrides: dict[str, Any], field: str, env_value: Any) -> Any:
    value = overrides.get(field)
    return env_value if value is None else value


def resolve_profile(db: Session) -> LlmProfile:
    """把两层配置合并成一次调用实际生效的快照。"""
    overrides = read_overrides(db)
    return LlmProfile(
        enabled=bool(_pick(overrides, "enabled", settings.LLM_ENABLED)),
        provider=str(_pick(overrides, "provider", settings.LLM_PROVIDER)).strip()
        or "openai_compat",
        base_url=str(_pick(overrides, "base_url", settings.LLM_BASE_URL)).strip(),
        api_key=str(_pick(overrides, "api_key", settings.LLM_API_KEY)),
        model=str(_pick(overrides, "model", settings.LLM_MODEL)).strip(),
        timeout_seconds=float(
            _pick(overrides, "timeout_seconds", settings.LLM_TIMEOUT_SECONDS)
        ),
        connect_timeout_seconds=float(
            _pick(
                overrides,
                "connect_timeout_seconds",
                settings.LLM_CONNECT_TIMEOUT_SECONDS,
            )
        ),
        max_tokens=int(_pick(overrides, "max_tokens", settings.LLM_MAX_TOKENS)),
        temperature=float(_pick(overrides, "temperature", settings.LLM_TEMPERATURE)),
        reasoning_effort=str(
            _pick(overrides, "reasoning_effort", settings.LLM_REASONING_EFFORT)
        ),
        num_ctx=int(_pick(overrides, "num_ctx", settings.LLM_NUM_CTX)),
        max_concurrency=int(
            _pick(overrides, "max_concurrency", settings.LLM_MAX_CONCURRENCY)
        ),
        max_queued=int(_pick(overrides, "max_queued", settings.LLM_MAX_QUEUED)),
        max_retries=int(_pick(overrides, "max_retries", settings.LLM_MAX_RETRIES)),
        retry_base_delay_seconds=float(
            _pick(
                overrides,
                "retry_base_delay_seconds",
                settings.LLM_RETRY_BASE_DELAY_SECONDS,
            )
        ),
        allowed_failures=int(
            _pick(overrides, "allowed_failures", settings.LLM_ALLOWED_FAILURES)
        ),
        cooldown_seconds=float(
            _pick(overrides, "cooldown_seconds", settings.LLM_COOLDOWN_SECONDS)
        ),
        cache_ttl_seconds=int(
            _pick(overrides, "cache_ttl_seconds", settings.LLM_CACHE_TTL_SECONDS)
        ),
        cache_max_entries=int(
            _pick(overrides, "cache_max_entries", settings.LLM_CACHE_MAX_ENTRIES)
        ),
        health_cache_ttl_seconds=float(
            _pick(
                overrides,
                "health_cache_ttl_seconds",
                settings.LLM_HEALTH_CACHE_TTL_SECONDS,
            )
        ),
        config_version=int(read_version(db)),
        # read_overrides 只含非 None 字段，其键集合即「被显式覆盖」的字段
        overridden_fields=frozenset(overrides),
        source="db" if overrides else "env",
    )


def read_version(db: Session) -> int:
    """覆盖层版本号；从未配置过时为 0，表示「纯 env」。"""
    from app.crud.crud_llm_config import get_config

    row = get_config(db)
    return row.version if row is not None and row.version else 0


def env_defaults_view() -> dict[str, Any]:
    """env 默认层的自描述视图（camelCase，不含 api_key 原文）。

    管理台需要它来区分「这一项现在用的就是 env 值」与「已被覆盖」；
    只交默认值，密钥本身永不外流。
    """
    return {
        "enabled": settings.LLM_ENABLED,
        "provider": settings.LLM_PROVIDER,
        "baseUrl": settings.LLM_BASE_URL,
        "model": settings.LLM_MODEL,
        "timeoutSeconds": settings.LLM_TIMEOUT_SECONDS,
        "connectTimeoutSeconds": settings.LLM_CONNECT_TIMEOUT_SECONDS,
        "maxTokens": settings.LLM_MAX_TOKENS,
        "temperature": settings.LLM_TEMPERATURE,
        "reasoningEffort": settings.LLM_REASONING_EFFORT,
        "numCtx": settings.LLM_NUM_CTX,
        "maxConcurrency": settings.LLM_MAX_CONCURRENCY,
        "maxQueued": settings.LLM_MAX_QUEUED,
        "maxRetries": settings.LLM_MAX_RETRIES,
        "retryBaseDelaySeconds": settings.LLM_RETRY_BASE_DELAY_SECONDS,
        "allowedFailures": settings.LLM_ALLOWED_FAILURES,
        "cooldownSeconds": settings.LLM_COOLDOWN_SECONDS,
        "cacheTtlSeconds": settings.LLM_CACHE_TTL_SECONDS,
        "cacheMaxEntries": settings.LLM_CACHE_MAX_ENTRIES,
        "healthCacheTtlSeconds": settings.LLM_HEALTH_CACHE_TTL_SECONDS,
        "apiKeySet": bool(settings.LLM_API_KEY),
    }


def overrides_view(db: Session) -> dict[str, Any]:
    """覆盖层整行视图（含 None，便于管理台把输入框清空恢复继承）。"""
    from app.crud.crud_llm_config import OVERRIDABLE_FIELDS, get_config

    row = get_config(db)
    if row is None:
        return {field: None for field in OVERRIDABLE_FIELDS}
    view = {field: getattr(row, field) for field in OVERRIDABLE_FIELDS}
    # 密钥原文不进管理台响应：None（未覆盖）与空串（显式清空）保留语义，非空回掩码
    if view["api_key"]:
        view["api_key"] = _mask_secret(view["api_key"])
    return view


async def resolve_profile_async() -> LlmProfile:
    """在事件循环外读配置，避免同步 DB 调用卡住循环。"""
    from app.db.session import SessionLocal

    def _load() -> LlmProfile:
        db = SessionLocal()
        try:
            return resolve_profile(db)
        finally:
            db.close()

    return await asyncio.to_thread(_load)

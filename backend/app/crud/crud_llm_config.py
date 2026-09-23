"""LLM 覆盖层配置的单行读写。

只有一行（id=1），因此不提供列表/分页；写操作统一走 apply_update，
由它负责「只改提交字段 + 递增 version」，保证网关能感知变更。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.llm_config import LlmConfig

# 单行表的固定主键
CONFIG_ROW_ID = 1

# 可覆盖字段（同时也是 PATCH 能接受的字段集合）
OVERRIDABLE_FIELDS: tuple[str, ...] = (
    "enabled",
    "provider",
    "base_url",
    "api_key",
    "model",
    "timeout_seconds",
    "connect_timeout_seconds",
    "max_tokens",
    "temperature",
    "reasoning_effort",
    "num_ctx",
    "max_concurrency",
    "max_queued",
    "max_retries",
    "retry_base_delay_seconds",
    "allowed_failures",
    "cooldown_seconds",
    "cache_ttl_seconds",
    "cache_max_entries",
    "health_cache_ttl_seconds",
)


def get_config(db: Session) -> LlmConfig | None:
    """读取覆盖层行；从未配置过时返回 None（表示完全继承 env）。"""
    return db.get(LlmConfig, CONFIG_ROW_ID)


def get_or_create(db: Session) -> LlmConfig:
    """取覆盖层行，不存在则插入裸行（全字段为空 = 全继承 env）。

    并发启动时两个进程可能同时插入 id=1，后提交者命中主键冲突；
    这里按「读不到就再读一次」处理，不向上抛。
    """
    row = db.get(LlmConfig, CONFIG_ROW_ID)
    if row is not None:
        return row
    row = LlmConfig(id=CONFIG_ROW_ID, version=1)
    db.add(row)
    try:
        db.commit()
    except Exception:
        db.rollback()
        fresh = db.get(LlmConfig, CONFIG_ROW_ID)
        if fresh is not None:
            return fresh
        raise
    db.refresh(row)
    return row


def read_overrides(db: Session) -> dict[str, Any]:
    """返回非空覆盖字段；无行时为空 dict。"""
    row = get_config(db)
    if row is None:
        return {}
    return {
        field: getattr(row, field)
        for field in OVERRIDABLE_FIELDS
        if getattr(row, field) is not None
    }


def apply_update(
    db: Session, changes: dict[str, Any], *, actor: str | None = None
) -> LlmConfig:
    """按字段写入覆盖层并递增 version。

    changes 里值为 None 的字段表示「删除该项覆盖、恢复继承 env」。
    未出现在 changes 里的字段保持原值不变。
    """
    row = get_or_create(db)
    touched = False
    for field, value in changes.items():
        if field not in OVERRIDABLE_FIELDS:
            continue
        if getattr(row, field) != value:
            setattr(row, field, value)
            touched = True
    if touched:
        row.version = (row.version or 0) + 1
        row.updated_at = datetime.utcnow()
        row.updated_by = actor
        db.commit()
        db.refresh(row)
    return row


def clear_overrides(db: Session, *, actor: str | None = None) -> LlmConfig:
    """清空全部覆盖项，回到纯 env 状态。"""
    row = get_or_create(db)
    touched = any(getattr(row, field) is not None for field in OVERRIDABLE_FIELDS)
    if touched:
        for field in OVERRIDABLE_FIELDS:
            setattr(row, field, None)
        row.version = (row.version or 0) + 1
        row.updated_at = datetime.utcnow()
        row.updated_by = actor
        db.commit()
        db.refresh(row)
    return row

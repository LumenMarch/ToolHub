"""模型服务配置的管理员端点。

配置分两层（见 app/services/llm/settings.py）：env 是默认层，本组端点只写
数据库覆盖层，逐字段可留空表示继承 env。改完即生效，不需要重启 —— 这正是
把模型调用做成全局服务之后才可能做到的事：所有在途与后续请求都从同一个
网关读配置。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission
from app.crud.crud_llm_config import apply_update, clear_overrides, get_config
from app.models.user import User
from app.schemas.llm import LlmConfigResponse, LlmConfigUpdate
from app.services.audit import log_action
from app.services.llm import llm_gateway
from app.services.llm.providers import supported_providers
from app.services.llm.settings import env_defaults_view, overrides_view, resolve_profile
from app.services.realtime.events import llm_config_updated_event
from app.services.realtime.hub import realtime_hub

router = APIRouter()


def _config_response(db: Session) -> dict[str, Any]:
    """组装「生效值 + 覆盖原值 + 哪些字段被覆盖 + env 默认」。"""
    profile = resolve_profile(db)
    overrides = overrides_view(db)
    row = get_config(db)
    effective = profile.describe()
    return {
        "effective": {
            key: effective[key]
            for key in (
                "enabled",
                "provider",
                "baseUrl",
                "model",
                "timeoutSeconds",
                "connectTimeoutSeconds",
                "maxTokens",
                "temperature",
                "reasoningEffort",
                "numCtx",
                "maxConcurrency",
                "maxQueued",
                "maxRetries",
                "retryBaseDelaySeconds",
                "allowedFailures",
                "cooldownSeconds",
                "cacheTtlSeconds",
                "cacheMaxEntries",
                "healthCacheTtlSeconds",
                "apiKeySet",
                "apiKeyMask",
                "source",
            )
        },
        "overrides": overrides,
        "overriddenFields": sorted(
            key for key, value in overrides.items() if value is not None
        ),
        "envDefaults": env_defaults_view(),
        "version": row.version if row else 0,
        "updated_at": row.updated_at if row else None,
        "updated_by": row.updated_by if row else None,
    }


def _after_config_change(gateway_changed: bool) -> None:
    """配置落库后的统一收尾：退避熔断、失效探活缓存、广播刷新。"""
    if gateway_changed:
        # 新配置可能正是「修好了那个连不上的地址」，别让冷却期拦住验证
        llm_gateway.reset_breaker()
    realtime_hub.publish(llm_config_updated_event())


@router.get("/config", response_model=LlmConfigResponse)
def get_llm_config(
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("llm_config:read")),
) -> Any:
    """查看当前生效配置与覆盖层原值。"""
    return _config_response(db)


@router.patch("/config", response_model=LlmConfigResponse)
def patch_llm_config(
    payload: LlmConfigUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("llm_config:write")),
) -> Any:
    """按字段更新覆盖层；值为 null 表示恢复继承 env。"""
    changes = payload.model_dump(exclude_unset=True)
    row = apply_update(db, changes, actor=admin.username)
    log_action(
        db,
        request=request,
        user=admin,
        action="llm.config.update",
        target_type="llm",
        target_id="config",
        # api_key 只记录「是否设置」，永不落原文
        detail={
            **{k: v for k, v in changes.items() if k != "api_key"},
            "apiKeyUpdated": "api_key" in changes,
            "version": row.version,
        },
    )
    _after_config_change(gateway_changed=True)
    return _config_response(db)


@router.delete("/config", response_model=LlmConfigResponse)
def delete_llm_config(
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("llm_config:write")),
) -> Any:
    """清空全部覆盖项，回到纯 env 状态。"""
    row = clear_overrides(db, actor=admin.username)
    log_action(
        db,
        request=request,
        user=admin,
        action="llm.config.reset",
        target_type="llm",
        target_id="config",
        detail={"version": row.version},
    )
    _after_config_change(gateway_changed=True)
    return _config_response(db)


@router.post("/probe")
async def probe_llm(
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("llm_config:read")),
) -> Any:
    """强制探活一次，供管理台「测试连接」按钮使用。"""
    outcome = await llm_gateway.probe(force=True)
    profile = resolve_profile(db)
    return {
        **outcome.as_dict(),
        "expectedModel": profile.model,
        "modelListed": profile.model in outcome.models if outcome.models else None,
        "supportedProviders": list(supported_providers()),
    }

"""模型服务状态端点（登录即可）。

工具页在渲染之前先问一次这里，决定「生成建议」按钮是可点还是置灰并提示
「模型未配置」—— 而不是让用户填完所有参数、点下去之后才收到 503。
这里不外泄任何密钥，也不接受任意提示词：真正的调用入口仍然在各工具端点里，
由工具自己的权限守卫把关。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.core.auth import require_any_tool_permission, require_permission
from app.models.user import User
from app.schemas.llm import LlmAvailabilityResponse, LlmStatusResponse
from app.services.llm import llm_gateway

router = APIRouter()


@router.get("/status", response_model=LlmStatusResponse)
async def get_llm_status(
    probe: bool = Query(
        default=False, description="是否顺带探活上游（结果按 TTL 复用）"
    ),
    _: User = Depends(require_permission("llm_config:read")),
) -> Any:
    """返回模型服务的配置摘要、队列深度、指标与探活结果（仅配置管理员）。"""
    return await llm_gateway.status(probe=probe)


@router.get("/availability", response_model=LlmAvailabilityResponse)
async def get_llm_availability(
    _: User = Depends(require_any_tool_permission()),
) -> Any:
    """工具页可读的最小可用性视图：不含探活详情、模型清单、队列与指标。"""
    status = await llm_gateway.status(probe=False)
    return {
        "enabled": status["enabled"],
        "configured": status["configured"],
        "available": status["available"],
        "cooldownActive": status["cooldownActive"],
        "lastError": status["lastError"],
    }

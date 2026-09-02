"""TT 时间分析建议端点。

前端把当前筛选下算好的统计结构 POST 到本端点，调本地 llama.cpp 生成中文结论。
路由前缀由 api_router 设置为 /tools/tt-time。
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.core.config import settings
from app.models.user import User
from app.schemas.tt_time import (
    TtTimeAnalyzeRequest,
    TtTimeAnalyzeResponse,
)
from app.services.audit import log_action
from app.services.tt_time_llm import (
    LLM_UNAVAILABLE_STATUS,
    LlmUnavailableError,
    build_analysis_prompt,
    call_llama,
)

router = APIRouter()


@router.post("/analyze", response_model=TtTimeAnalyzeResponse)
def analyze_tt_time(
    req: TtTimeAnalyzeRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("tt-time")),
) -> TtTimeAnalyzeResponse:
    """基于统计摘要调用本地大模型生成测试时间分析结论。"""
    if not settings.LLM_BASE_URL or not settings.LLM_MODEL:
        raise HTTPException(
            status_code=LLM_UNAVAILABLE_STATUS,
            detail="本地大模型未配置（LLM_BASE_URL / LLM_MODEL）",
        )

    if req.totalRows <= 0:
        raise HTTPException(status_code=400, detail="当前筛选下没有可分析的数据")

    data = req.model_dump()
    prompt = build_analysis_prompt(data)

    started = time.monotonic()
    try:
        advice = call_llama(prompt)
    except LlmUnavailableError as exc:
        log_action(
            db,
            request=request,
            user=current_user,
            action="tool.tt_time.analyze",
            target_type="tool",
            target_id="tt-time",
            detail={"ok": False, "reason": str(exc)},
        )
        raise HTTPException(
            status_code=LLM_UNAVAILABLE_STATUS, detail=str(exc)
        ) from exc
    elapsed_ms = int((time.monotonic() - started) * 1000)

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.tt_time.analyze",
        target_type="tool",
        target_id="tt-time",
        detail={"ok": True, "rows": req.totalRows, "elapsed_ms": elapsed_ms},
    )
    logger.info("tt-time analyze ok: rows={} elapsed={}ms", req.totalRows, elapsed_ms)

    return TtTimeAnalyzeResponse(
        advice=advice,
        model=settings.LLM_MODEL,
        elapsedMs=elapsed_ms,
    )

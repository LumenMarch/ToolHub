"""TT 时间分析建议端点。

前端把当前筛选下算好的统计结构 POST 到本端点，经全局 LLM 网关调本地模型生成
中文结论。路由前缀由 api_router 设置为 /tools/tt-time。

两个调用入口共用同一条网关管道：
- POST /analyze：一次性返回完整结论（兼容现有前端，行为与改造前一致）；
- POST /analyze/stream：SSE 逐段返回，思考类模型下用户不必干等十几秒。
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.schemas.tt_time import (
    CdfPointModel,
    HistogramBinModel,
    StationBoxGroupModel,
    StationComparisonRowModel,
    StationComparisonTableModel,
    TtTimeAnalyzeRequest,
    TtTimeAnalyzeResponse,
    TtTimeProcessRequest,
    TtTimeProcessResponse,
    TtTimeStats,
    TtTimeTail,
)
from app.services.audit import log_action
from app.services.llm import LlmError, LlmResult, llm_gateway
from app.services.tt_time.prompt import build_analysis_request
from app.services.tt_time.service import (
    TtTimeValidationError,
    calculate_tt_summary,
    load_tt_dataframe,
)
from app.services.upload.store import (
    UploadNotCompleteError,
    UploadNotFoundError,
    UploadOwnershipError,
    UploadStore,
)

router = APIRouter()

store = UploadStore()


def _get_owned_file_path(upload_id: str, user_id: int) -> tuple[Path, str]:
    """校验上传归属并返回 (文件路径, 原始文件名)。"""
    try:
        info = store.get_owned_info(upload_id, user_id)
    except UploadOwnershipError as exc:
        raise HTTPException(status_code=403, detail="无权访问此上传") from exc
    except UploadNotFoundError as exc:
        raise HTTPException(status_code=404, detail="上传不存在") from exc
    except UploadNotCompleteError as exc:
        raise HTTPException(status_code=409, detail="上传尚未完成") from exc
    return store.get_owned_file_path(upload_id, user_id), info.get("filename", "")


@router.post("/process", response_model=TtTimeProcessResponse)
def process_tt_time(
    req: TtTimeProcessRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("tt-time")),
) -> TtTimeProcessResponse:
    """基于 Tus 上传的原始日志文件，使用 Polars 高性能多线程计算测试时间统计。"""
    file_path, filename = _get_owned_file_path(req.upload_id, current_user.id)

    started = time.monotonic()
    try:
        df = load_tt_dataframe(file_path, filename)
        summary = calculate_tt_summary(
            df,
            bin_width=req.bin_width,
            station_filter=req.station_filter,
            exclude_fail=req.exclude_fail,
        )
    except TtTimeValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("tt-time process failed: {}", exc)
        raise HTTPException(status_code=500, detail=f"计算服务异常: {exc}") from exc

    elapsed_ms = int((time.monotonic() - started) * 1000)

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.tt_time.process",
        target_type="tool",
        target_id="tt-time",
        detail={
            "ok": True,
            "total": summary.total_rows,
            "filtered": summary.filtered_rows,
            "elapsed_ms": elapsed_ms,
        },
    )

    return TtTimeProcessResponse(
        filename=filename,
        totalRows=summary.total_rows,
        filteredRows=summary.filtered_rows,
        stations=summary.stations,
        stats=TtTimeStats(
            count=summary.stats.count,
            min=summary.stats.min,
            max=summary.stats.max,
            q1=summary.stats.q1,
            q2=summary.stats.q2,
            q3=summary.stats.q3,
            mean=summary.stats.mean,
        ),
        bins=[
            HistogramBinModel(
                label=b.label,
                lo=b.lo,
                hi=b.hi,
                count=b.count,
                percent=b.percent,
            )
            for b in summary.bins
        ],
        cdf=[CdfPointModel(x=p.x, y=p.y) for p in summary.cdf],
        stationBoxGroups=[
            StationBoxGroupModel(
                stationId=g.station_id,
                stationNumeric=g.station_numeric,
                count=g.count,
                min=g.min,
                q1=g.q1,
                median=g.median,
                q3=g.q3,
                max=g.max,
                iqr=g.iqr,
                whiskerLow=g.whisker_low,
                whiskerHigh=g.whisker_high,
                outliers=g.outliers,
            )
            for g in summary.station_box_groups
        ],
        comparisonTable=StationComparisonTableModel(
            stations=summary.comparison_table.stations,
            stationNumerics=summary.comparison_table.station_numerics,
            rows=[
                StationComparisonRowModel(label=r.label, values=r.values)
                for r in summary.comparison_table.rows
            ],
        ),
        percentiles=summary.percentiles,
        tail=TtTimeTail(
            iqrThreshold=summary.tail.iqr_threshold,
            outlierCount=summary.tail.outlier_count,
            outlierPercent=summary.tail.outlier_percent,
        ),
        elapsedMs=elapsed_ms,
    )


def _audit_analyze(
    db: Session,
    request: Request,
    user: User,
    *,
    ok: bool,
    rows: int,
    error: LlmError | None = None,
    result: LlmResult | None = None,
) -> None:
    """把一次分析调用的成败写进审计。

    只记错误码与面向用户的文案，不记提示词全文与上游响应原文：审计日志
    是给管理员读的，不该成为业务数据的副本。
    """
    detail: dict[str, Any] = {"ok": ok, "rows": rows}
    if error is not None:
        detail.update({"code": error.code, "reason": error.message})
    if result is not None:
        detail.update(
            {
                "provider": result.provider,
                "cached": result.cached,
                "elapsed_ms": result.elapsed_ms,
                "tokens": result.usage.total_tokens,
            }
        )
    log_action(
        db,
        request=request,
        user=user,
        action="tool.tt_time.analyze",
        target_type="tool",
        target_id="tt-time",
        detail=detail,
    )


def _audit_analyze_detached(
    request: Request,
    user: User,
    *,
    ok: bool,
    rows: int,
    error: LlmError | None = None,
    result: LlmResult | None = None,
) -> None:
    """流式响应里用独立会话写审计。

    推流可以持续几十秒到几分钟，请求级会话的存活期不该被指望覆盖这么久；
    这里另开一条短会话，写完即关。
    """
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        _audit_analyze(db, request, user, ok=ok, rows=rows, error=error, result=result)
    finally:
        db.close()


@router.post("/analyze", response_model=TtTimeAnalyzeResponse)
async def analyze_tt_time(
    req: TtTimeAnalyzeRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("tt-time")),
) -> TtTimeAnalyzeResponse:
    """基于统计摘要调用全局 LLM 网关，生成测试时间分析结论。

    必须是 async def：一次模型调用要吃掉数秒到数分钟，写成同步端点就会占用
    全站共享的 40 个 anyio 线程，把上传、登录等无关接口一起拖住。
    「未配置 / 已关闭 / 排队满 / 熔断中」这些判定都在网关里完成，本端点只把
    LlmError 翻译成带错误码的 HTTP 响应。
    """
    if req.totalRows <= 0:
        raise HTTPException(status_code=400, detail="当前筛选下没有可分析的数据")

    llm_request = build_analysis_request(req.model_dump())
    started = time.monotonic()
    try:
        result = await llm_gateway.complete(llm_request)
    except LlmError as exc:
        _audit_analyze(
            db, request, current_user, ok=False, rows=req.totalRows, error=exc
        )
        raise exc.to_http_exception() from exc

    elapsed_ms = int((time.monotonic() - started) * 1000)
    _audit_analyze(
        db, request, current_user, ok=True, rows=req.totalRows, result=result
    )
    logger.info(
        "tt-time analyze ok: rows={} cached={} provider={} elapsed={}ms",
        req.totalRows,
        result.cached,
        result.provider,
        elapsed_ms,
    )
    return TtTimeAnalyzeResponse(
        advice=result.content,
        model=result.model,
        elapsedMs=elapsed_ms,
    )


@router.post("/analyze/stream")
async def analyze_tt_time_stream(
    req: TtTimeAnalyzeRequest,
    request: Request,
    current_user: User = Depends(require_tool_permission("tt-time")),
) -> EventSourceResponse:
    """SSE 版分析：delta 逐段推正文，done 带完整结果，error 带错误码。

    思考类模型（如实测的 K2-Horizon）要先思考几百 token 才吐正文，一次性
    返回意味着用户干等十几秒；流式让正文一边生成一边渲染。
    开始推流后 HTTP 状态码已经发出，失败只能靠 error 事件传达 —— 包括
    「未配置」「排队满」这类本可以用 4xx/5xx 表达的情况，前端只认事件即可。
    """
    if req.totalRows <= 0:
        raise HTTPException(status_code=400, detail="当前筛选下没有可分析的数据")

    llm_request = build_analysis_request(req.model_dump())

    async def events() -> AsyncIterator[dict[str, str]]:
        started = time.monotonic()
        try:
            async for chunk in llm_gateway.stream(llm_request):
                # 缓存命中的那一帧同时带 delta 与 result：正文必须先发给前端。
                # 按 is_final 分派会让命中路径只发出 done，整段结论静默丢失。
                if chunk.delta:
                    yield {
                        "event": "delta",
                        "data": json.dumps({"text": chunk.delta}, ensure_ascii=False),
                    }
                if not chunk.is_final or chunk.result is None:
                    continue
                result = chunk.result
                elapsed_ms = int((time.monotonic() - started) * 1000)
                _audit_analyze_detached(
                    request,
                    current_user,
                    ok=True,
                    rows=req.totalRows,
                    result=result,
                )
                yield {
                    "event": "done",
                    "data": json.dumps(
                        {
                            "model": result.model,
                            "provider": result.provider,
                            "cached": result.cached,
                            "elapsedMs": elapsed_ms,
                        },
                        ensure_ascii=False,
                    ),
                }
        except LlmError as exc:
            _audit_analyze_detached(
                request, current_user, ok=False, rows=req.totalRows, error=exc
            )
            yield {
                "event": "error",
                "data": json.dumps(
                    {
                        "code": exc.code,
                        "message": exc.message,
                        "retryable": exc.retryable,
                    },
                    ensure_ascii=False,
                ),
            }

    # ping 保活：思考阶段可能十几秒没有正文，中间代理会把静默连接掐掉
    return EventSourceResponse(events(), ping=10)

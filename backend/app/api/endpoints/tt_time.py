"""TT 时间分析建议端点。

前端把当前筛选下算好的统计结构 POST 到本端点，调本地 llama.cpp 生成中文结论。
路由前缀由 api_router 设置为 /tools/tt-time。
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.core.config import settings
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
from app.services.tt_time.service import (
    TtTimeValidationError,
    calculate_tt_summary,
    load_tt_dataframe,
)
from app.services.tt_time_llm import (
    LLM_UNAVAILABLE_STATUS,
    LlmUnavailableError,
    build_analysis_prompt,
    call_llama,
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

"""箱线图（box-plot）端点。

流程：tus 上传数据文件（CSV / Excel）→ POST /columns 获取列类型 →
可选 POST /group-values 列出分组水平 → POST /analyze 同步返回各组统计量
（毫秒级，无 job 轮询）；图表渲染与 SVG/PNG 导出均在客户端完成。

路由前缀由 api_router 设置为 /tools/box-plot。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.schemas.box_plot import (
    AnalyzeResponse,
    BoxPlotAnalyzeRequest,
    BoxPlotColumnsRequest,
    BoxPlotGroupValuesRequest,
    ColumnMeta,
    ColumnsResponse,
    GroupStatModel,
    GroupValuesResponse,
)
from app.services.audit import log_action
from app.services.boxplot.service import (
    PREVIEW_ROWS,
    QUARTILE_METHOD_LABELS,
    SAMPLE_ROWS,
    BoxPlotValidationError,
    compute_groups,
    exclude_atlas_meta_rows,
    filter_fail_rows,
    find_fail_status_column,
    list_group_values,
    read_tabular,
    scan_columns,
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


def _parse_or_400(exc: BoxPlotValidationError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@router.post("/columns", response_model=ColumnsResponse)
def preview_columns(
    req: BoxPlotColumnsRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("box-plot")),
) -> ColumnsResponse:
    """读取数据文件并推断列类型（大文件仅采样前 SAMPLE_ROWS 行）。"""
    path, filename = _get_owned_file_path(req.upload_id, current_user.id)
    try:
        df = read_tabular(path, filename)
    except BoxPlotValidationError as exc:
        raise _parse_or_400(exc) from exc

    df, excluded_rows = exclude_atlas_meta_rows(df)
    sample = df.head(SAMPLE_ROWS)
    columns = [
        ColumnMeta(
            name=info.name,
            kind=info.kind,
            non_null_count=info.non_null_count,
            distinct_count=info.distinct_count,
        )
        for info in scan_columns(sample)
    ]

    preview = sample.head(PREVIEW_ROWS)
    preview_rows = [
        ["" if value is None else str(value) for value in row]
        for row in preview.iter_rows()
    ]

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.box_plot.columns",
        target_type="tool",
        target_id="box-plot",
        detail={
            "rows": df.height,
            "columns": len(columns),
            "sampled": df.height > SAMPLE_ROWS,
        },
    )
    return ColumnsResponse(
        filename=filename,
        rows=df.height,
        sampled=df.height > SAMPLE_ROWS,
        columns=columns,
        preview_columns=sample.columns,
        preview_rows=preview_rows,
        excluded_rows=excluded_rows,
    )


@router.post("/group-values", response_model=GroupValuesResponse)
def preview_group_values(
    req: BoxPlotGroupValuesRequest,
    current_user: User = Depends(require_tool_permission("box-plot")),
) -> GroupValuesResponse:
    """读取分组列的唯一值，供列配置筛选。"""
    path, filename = _get_owned_file_path(req.upload_id, current_user.id)
    try:
        df = read_tabular(path, filename)
    except BoxPlotValidationError as exc:
        raise _parse_or_400(exc) from exc

    df, _ = exclude_atlas_meta_rows(df)
    try:
        values, total, truncated = list_group_values(df, req.group_col, req.time_unit)
    except BoxPlotValidationError as exc:
        raise _parse_or_400(exc) from exc
    return GroupValuesResponse(values=values, total=total, truncated=truncated)


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_box_plot(
    req: BoxPlotAnalyzeRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("box-plot")),
) -> AnalyzeResponse:
    """按数值列（+可选分组列）计算各分组箱线图统计量，同步返回。"""
    path, filename = _get_owned_file_path(req.upload_id, current_user.id)
    try:
        df = read_tabular(path, filename)
    except BoxPlotValidationError as exc:
        raise _parse_or_400(exc) from exc

    df, _ = exclude_atlas_meta_rows(df)

    fail_column = find_fail_status_column(df)
    analysis_df = df
    excluded_fail_rows = 0
    if req.exclude_fail and fail_column is not None:
        analysis_df, excluded_fail_rows = filter_fail_rows(df, fail_column)

    try:
        stats, used_rows, skipped_rows = compute_groups(
            analysis_df,
            req.value_col,
            req.group_col,
            quartile_method=req.quartile_method,
            group_values=req.group_values,
            time_unit=req.time_unit,
        )
    except BoxPlotValidationError as exc:
        raise _parse_or_400(exc) from exc

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.box_plot.analyze",
        target_type="tool",
        target_id="box-plot",
        detail={
            "quartile_method": req.quartile_method,
            "grouped": req.group_col is not None,
            "time_unit": req.time_unit,
            "groups": len(stats),
            "used_rows": used_rows,
            "exclude_fail": req.exclude_fail,
            "excluded_fail_rows": excluded_fail_rows,
        },
    )
    logger.info(
        f"box-plot analyze 完成: filename={filename} value={req.value_col} "
        f"groups={len(stats)} used_rows={used_rows}"
    )

    return AnalyzeResponse(
        filename=filename,
        value_column=req.value_col,
        group_column=req.group_col,
        group_time_unit=req.time_unit,
        quartile_method=QUARTILE_METHOD_LABELS[req.quartile_method],
        total_rows=df.height,
        used_rows=used_rows,
        skipped_rows=skipped_rows,
        excluded_fail_rows=excluded_fail_rows,
        fail_column=fail_column,
        groups=[
            GroupStatModel(
                name=stat.name,
                count=stat.count,
                min=stat.min,
                q1=stat.q1,
                median=stat.median,
                q3=stat.q3,
                max=stat.max,
                iqr=stat.iqr,
                fence_low=stat.fence_low,
                fence_high=stat.fence_high,
                whisker_low=stat.whisker_low,
                whisker_high=stat.whisker_high,
                outlier_count=stat.outlier_count,
                outliers=stat.outliers,
            )
            for stat in stats
        ],
    )

"""重测率统计（retest-rate）端点。

流程：tus 上传若干份测试 CSV → POST /analyze 同步返回重测率统计结果；
报告导出（CSV / HTML）由前端在客户端生成。分析逻辑移植自 insight
数据重测率统计工具 v1.6，见 app/services/retest_rate/service.py。

路由前缀由 api_router 设置为 /tools/retest-rate。
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.schemas.retest_rate import AnalyzeRequest, AnalyzeResponse
from app.services.audit import log_action
from app.services.retest_rate.service import (
    RetestRateValidationError,
    analyze_files,
)
from app.services.upload.store import (
    UploadNotCompleteError,
    UploadNotFoundError,
    UploadOwnershipError,
    UploadStore,
)

router = APIRouter()

store = UploadStore()


def _get_owned_file_path(upload_id: str, user_id: int) -> Path:
    """校验上传归属并返回文件路径。"""
    try:
        store.get_owned_info(upload_id, user_id)
    except UploadOwnershipError as exc:
        raise HTTPException(status_code=403, detail="无权访问此上传") from exc
    except UploadNotFoundError as exc:
        raise HTTPException(status_code=404, detail="上传不存在") from exc
    except UploadNotCompleteError as exc:
        raise HTTPException(status_code=409, detail="上传尚未完成") from exc
    return store.get_owned_file_path(upload_id, user_id)


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_retest_rate(
    req: AnalyzeRequest,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("retest-rate")),
) -> AnalyzeResponse:
    """按 SN 汇总多份测试 CSV，返回重测率/不良率统计与明细。"""
    paths = [
        _get_owned_file_path(upload_id, current_user.id) for upload_id in req.upload_ids
    ]

    try:
        result = analyze_files(paths)
    except RetestRateValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.retest_rate.analyze",
        target_type="tool",
        target_id="retest-rate",
        detail={
            "files": len(paths),
            "rows": result["total_rows"],
            "format": result["csv_format"],
        },
    )
    return AnalyzeResponse(**result)

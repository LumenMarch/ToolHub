"""测试日志合并（atlas-merge）端点。

流程：tus 上传 unit-archive zip → POST analyze 立即 202 + job_id（后台线程合并）→
GET jobs/{job_id} 轮询进度（done 时带完整结果载荷）→ download/delete 结果。
完整产物（四行范式 CSV）走 download 端点，job 载荷只带表格骨架预览。

路由前缀由 api_router 设置为 /tools/atlas-merge。
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
from app.schemas.atlas_merge import AnalyzeAcceptedResponse, JobResponse
from app.services.atlas_merge import (
    AtlasMergeResultExpiredError,
    AtlasMergeResultNotFoundError,
    atlas_merge_result_cache,
)
from app.services.atlas_merge.jobs import atlas_merge_jobs
from app.services.audit import log_action
from app.services.upload.store import (
    UploadNotCompleteError,
    UploadNotFoundError,
    UploadOwnershipError,
    UploadStore,
)

router = APIRouter()

CSV_CONTENT_TYPE = "text/csv; charset=utf-8"

store = UploadStore()


class AtlasMergeAnalyzeRequest(BaseModel):
    """测试日志合并分析请求，引用已完成的 tus 上传（unit-archive zip）。"""

    upload_id: str = Field(..., min_length=1, description="unit-archive zip 上传 ID")


def _build_download_file_response(file_path: Path, filename: str) -> FileResponse:
    encoded_filename = quote(filename)
    content_disposition = (
        f"attachment; filename=\"{filename}\"; filename*=UTF-8''{encoded_filename}"
    )
    return FileResponse(
        path=file_path,
        media_type=CSV_CONTENT_TYPE,
        headers={"Content-Disposition": content_disposition},
    )


@router.post("/analyze", status_code=202, response_model=AnalyzeAcceptedResponse)
def analyze_atlas_merge(
    request: Request,
    req: AtlasMergeAnalyzeRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("atlas-merge")),
) -> AnalyzeAcceptedResponse:
    """提交合并任务：立即返回 202 + job_id，进度走 GET /jobs/{job_id} 轮询。

    提交时仅校验上传归属（不读内容）；zip 内容错误（非 zip、zip-slip、超限等）
    在任务执行期产生 error 状态，由 job 携带。
    """
    try:
        store.get_owned_info(req.upload_id, current_user.id)
    except UploadOwnershipError as exc:
        raise HTTPException(status_code=403, detail="无权访问此上传") from exc
    except UploadNotFoundError as exc:
        raise HTTPException(status_code=404, detail="上传不存在") from exc
    except UploadNotCompleteError as exc:
        raise HTTPException(status_code=409, detail="上传尚未完成") from exc

    job_id = atlas_merge_jobs.submit(
        user_id=current_user.id,
        upload_id=req.upload_id,
        request=request,
    )
    logger.info(f"atlas-merge analyze 已提交 job_id={job_id}")
    return AnalyzeAcceptedResponse(job_id=job_id)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_atlas_merge_job(
    job_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> JobResponse:
    """轮询合并任务进度/结果。job 不存在或非本人 → 404。"""
    payload = atlas_merge_jobs.get_serialized(job_id, current_user.id)
    if payload is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return JobResponse(**payload)


@router.get("/results/{result_id}/download")
def download_atlas_merge_result(
    result_id: str,
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    try:
        cached_result = atlas_merge_result_cache.get(result_id, current_user.id)
    except AtlasMergeResultExpiredError as exc:
        raise HTTPException(
            status_code=410, detail="分析结果已过期，请重新分析"
        ) from exc
    except AtlasMergeResultNotFoundError as exc:
        raise HTTPException(status_code=404, detail="分析结果不存在") from exc

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.atlas_merge.download",
        target_type="tool",
        target_id="atlas-merge",
        detail={"result_id": result_id},
    )
    return _build_download_file_response(
        cached_result.content_path,
        cached_result.filename,
    )


@router.delete("/results/{result_id}", status_code=204)
def delete_atlas_merge_result(
    result_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    atlas_merge_result_cache.delete(result_id, current_user.id)
    return Response(status_code=204)

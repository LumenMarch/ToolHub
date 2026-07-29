from dataclasses import asdict
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
from app.schemas.attendance import (
    AttendanceAnalyzeResponse,
    AttendanceRowResponse,
    AttendanceSheetResponse,
    AttendanceSummaryResponse,
)
from app.services.attendance import (
    OUTPUT_HEADERS,
    AttendanceResultExpiredError,
    AttendanceResultNotFoundError,
    AttendanceService,
    AttendanceValidationError,
    attendance_result_cache,
    validate_upload_extensions,
)
from app.services.audit import log_action
from app.services.upload.store import UploadStore

router = APIRouter()

EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


store = UploadStore()


class AttendanceUploadRequest(BaseModel):
    """出勤分析上传请求，引用已完成的 tus 上传。"""

    attendance_upload_id: str = Field(..., min_length=1, description="通行记录上传 ID")
    shift_upload_id: str = Field(..., min_length=1, description="班别文件上传 ID")


def _build_download_response(content: bytes, filename: str) -> Response:
    encoded_filename = quote(filename)
    ascii_filename = f"attendance_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    content_disposition = (
        f'attachment; filename="{ascii_filename}"; '
        f"filename*=UTF-8''{encoded_filename}"
    )
    return Response(
        content=content,
        media_type=EXCEL_CONTENT_TYPE,
        headers={"Content-Disposition": content_disposition},
    )


@router.post("/process")
def process_attendance(
    request: Request,
    req: AttendanceUploadRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("attendance-organizer")),
) -> Response:
    try:
        attendance_info = store.get_info(req.attendance_upload_id)
        shift_info = store.get_info(req.shift_upload_id)
        attendance_suffix = validate_upload_extensions(
            attendance_info["filename"],
            shift_info["filename"],
        )
        attendance_content = store.read_bytes(req.attendance_upload_id)
        shift_content = store.read_bytes(req.shift_upload_id)
        output = AttendanceService().process(
            attendance_content,
            attendance_suffix,
            shift_content,
        )
    except AttendanceValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.attendance.process",
        target_type="tool",
        target_id="attendance",
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"出勤整理_完整_{timestamp}.xlsx"
    return _build_download_response(output, filename)


@router.post("/analyze", response_model=AttendanceAnalyzeResponse)
def analyze_attendance(
    request: Request,
    req: AttendanceUploadRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("attendance-organizer")),
) -> AttendanceAnalyzeResponse:
    try:
        attendance_info = store.get_info(req.attendance_upload_id)
        shift_info = store.get_info(req.shift_upload_id)
        attendance_suffix = validate_upload_extensions(
            attendance_info["filename"],
            shift_info["filename"],
        )
        attendance_content = store.read_bytes(req.attendance_upload_id)
        shift_content = store.read_bytes(req.shift_upload_id)
        service = AttendanceService()
        analysis = service.analyze(
            attendance_content,
            attendance_suffix,
            shift_content,
        )
        output = service.export(analysis)
    except AttendanceValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"出勤整理_完整_{timestamp}.xlsx"
    cached_result = attendance_result_cache.put(
        user_id=current_user.id,
        filename=filename,
        content=output,
    )

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.attendance.analyze",
        target_type="tool",
        target_id="attendance",
        detail={"result_id": cached_result.result_id},
    )

    return AttendanceAnalyzeResponse(
        result_id=cached_result.result_id,
        download_filename=filename,
        expires_at=cached_result.expires_at,
        columns=list(OUTPUT_HEADERS),
        summary=AttendanceSummaryResponse(**asdict(analysis.summary)),
        sheets=[
            AttendanceSheetResponse(
                name=sheet.name,
                row_count=len(sheet.rows),
                rows=[
                    AttendanceRowResponse(
                        key=row.key,
                        values=list(row.display_values),
                        status_text=row.status_text,
                        anomaly_text=row.anomaly_text,
                        flags=list(row.flags),
                        tone=row.tone,
                        attention=row.attention,
                    )
                    for row in sheet.rows
                ],
            )
            for sheet in analysis.sheets
        ],
    )


@router.get("/results/{result_id}/download")
def download_attendance_result(
    result_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    try:
        cached_result = attendance_result_cache.get(result_id, current_user.id)
    except AttendanceResultExpiredError as exc:
        raise HTTPException(
            status_code=410,
            detail="分析结果已过期，请重新分析",
        ) from exc
    except AttendanceResultNotFoundError as exc:
        raise HTTPException(status_code=404, detail="分析结果不存在") from exc

    return _build_download_response(
        cached_result.content,
        cached_result.filename,
    )


@router.delete("/results/{result_id}", status_code=204)
def delete_attendance_result(
    result_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    attendance_result_cache.delete(result_id, current_user.id)
    return Response(status_code=204)

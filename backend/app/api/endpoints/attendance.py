from dataclasses import asdict
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.auth import get_current_user
from app.models.user import User
from app.schemas.attendance import (
    AttendanceAnalyzeResponse,
    AttendanceRowResponse,
    AttendanceSheetResponse,
    AttendanceSummaryResponse,
)
from app.services.attendance import (
    OUTPUT_HEADERS,
    AttendanceService,
    AttendanceValidationError,
    validate_upload_extensions,
)
from app.services.attendance_cache import (
    AttendanceResultExpiredError,
    AttendanceResultNotFoundError,
    attendance_result_cache,
)

router = APIRouter()

EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _read_uploads(
    attendance_file: UploadFile,
    shift_file: UploadFile,
) -> tuple[bytes, str, bytes]:
    attendance_filename = attendance_file.filename or ""
    shift_filename = shift_file.filename or ""
    attendance_suffix = validate_upload_extensions(
        attendance_filename,
        shift_filename,
    )
    attendance_content = attendance_file.file.read()
    shift_content = shift_file.file.read()
    if not attendance_content:
        raise AttendanceValidationError("通行记录文件为空")
    if not shift_content:
        raise AttendanceValidationError("班别文件为空")
    return attendance_content, attendance_suffix, shift_content


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
    attendance_file: UploadFile = File(...),
    shift_file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
) -> Response:
    try:
        attendance_content, attendance_suffix, shift_content = _read_uploads(
            attendance_file,
            shift_file,
        )
        output = AttendanceService().process(
            attendance_content,
            attendance_suffix,
            shift_content,
        )
    except AttendanceValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        attendance_file.file.close()
        shift_file.file.close()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"出勤整理_完整_{timestamp}.xlsx"
    return _build_download_response(output, filename)


@router.post("/analyze", response_model=AttendanceAnalyzeResponse)
def analyze_attendance(
    attendance_file: UploadFile = File(...),
    shift_file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> AttendanceAnalyzeResponse:
    try:
        attendance_content, attendance_suffix, shift_content = _read_uploads(
            attendance_file,
            shift_file,
        )
        service = AttendanceService()
        analysis = service.analyze(
            attendance_content,
            attendance_suffix,
            shift_content,
        )
        output = service.export(analysis)
    except AttendanceValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        attendance_file.file.close()
        shift_file.file.close()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"出勤整理_完整_{timestamp}.xlsx"
    cached_result = attendance_result_cache.put(
        user_id=current_user.id,
        filename=filename,
        content=output,
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
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
) -> Response:
    attendance_result_cache.delete(result_id, current_user.id)
    return Response(status_code=204)

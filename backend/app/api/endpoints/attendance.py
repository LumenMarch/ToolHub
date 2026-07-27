from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.auth import get_current_user
from app.models.user import User
from app.services.attendance import (
    AttendanceService,
    AttendanceValidationError,
    validate_upload_extensions,
)

router = APIRouter()

EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/process")
def process_attendance(
    attendance_file: UploadFile = File(...),
    shift_file: UploadFile = File(...),
    _current_user: User = Depends(get_current_user),
) -> Response:
    try:
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
    encoded_filename = quote(filename)
    content_disposition = (
        f'attachment; filename="attendance_{timestamp}.xlsx"; '
        f"filename*=UTF-8''{encoded_filename}"
    )
    return Response(
        content=output,
        media_type=EXCEL_CONTENT_TYPE,
        headers={"Content-Disposition": content_disposition},
    )

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
from app.services.qrcode_tools.service import (
    _LEVEL_MAP,
    MAX_SIZE,
    MIN_SIZE,
    generate_qrcode,
)

router = APIRouter()


class QRCodeRequest(BaseModel):
    text: str
    size: int = 256  # 输出 PNG 像素尺寸
    level: str = "M"  # 纠错级别 L/M/Q/H


@router.post("")
def create_qrcode(
    request: QRCodeRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("qrcode")),
):
    """生成二维码 PNG 并返回 base64 与 data URI。Requires authentication."""
    if not request.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    level = request.level.upper()
    if level not in _LEVEL_MAP:
        raise HTTPException(
            status_code=400, detail="Invalid level, must be one of L/M/Q/H"
        )

    if not MIN_SIZE <= request.size <= MAX_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size, must be between {MIN_SIZE} and {MAX_SIZE}",
        )

    return {"result": generate_qrcode(request.text, size=request.size, level=level)}

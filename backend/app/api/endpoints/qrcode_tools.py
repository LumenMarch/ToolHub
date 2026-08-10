from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.services.audit import log_action
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
    request: Request,
    req: QRCodeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("qrcode")),
):
    """生成二维码 PNG 并返回 base64 与 data URI。Requires authentication."""
    if not req.text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    level = req.level.upper()
    if level not in _LEVEL_MAP:
        raise HTTPException(
            status_code=400, detail="Invalid level, must be one of L/M/Q/H"
        )

    if not MIN_SIZE <= req.size <= MAX_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size, must be between {MIN_SIZE} and {MAX_SIZE}",
        )

    try:
        result = generate_qrcode(req.text, size=req.size, level=level)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.qrcode.generate",
        target_type="tool",
        target_id="qrcode",
        # 摘要记录生成参数，不落二维码内容（可能含敏感信息）
        detail={"size": req.size, "level": level},
    )
    return {"result": result}

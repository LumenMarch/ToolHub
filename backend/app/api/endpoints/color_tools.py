from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.services.audit import log_action
from app.services.color_tools.service import (
    build_palette_data,
    convert_color_formats,
    generate_random_color,
    is_valid_hex,
    normalize_hex,
)

router = APIRouter()


class ColorRequest(BaseModel):
    color: str | None = None  # 为空时生成随机颜色


@router.post("/convert")
def convert_color(
    request: Request,
    req: ColorRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("color-picker")),
):
    """颜色格式转换；未提供 color 时生成随机颜色。Requires authentication."""
    if req.color:
        normalized_hex = normalize_hex(req.color)
        if not is_valid_hex(normalized_hex):
            raise HTTPException(
                status_code=400,
                detail="无效的颜色编码。请提供有效的 HEX 颜色编码，例如：#FF5733 或 FF5733",
            )
        hex_value = normalized_hex
    else:
        hex_value = generate_random_color()

    result = convert_color_formats(hex_value)
    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.color.convert",
        target_type="tool",
        target_id="color-picker",
        detail={"color": hex_value},
    )
    return {"result": result}


@router.post("/palette")
def color_palette(
    request: Request,
    req: ColorRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("color-picker")),
):
    """基于色彩理论生成配色方案；未提供 color 时生成随机颜色。Requires authentication."""
    hex_input = req.color or generate_random_color()
    normalized_hex = normalize_hex(hex_input)

    if not is_valid_hex(normalized_hex):
        raise HTTPException(
            status_code=400,
            detail="color 参数不是有效的 HEX 颜色编码。请提供有效的 6 位或 3 位 HEX 编码，例如：#FF5733 或 FF5733",
        )

    result = build_palette_data(normalized_hex)
    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.color.palette",
        target_type="tool",
        target_id="color-picker",
        detail={"color": normalized_hex},
    )
    return {"result": result}

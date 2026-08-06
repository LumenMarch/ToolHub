from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
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
    request: ColorRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("color-picker")),
):
    """颜色格式转换；未提供 color 时生成随机颜色。Requires authentication."""
    if request.color:
        normalized_hex = normalize_hex(request.color)
        if not is_valid_hex(normalized_hex):
            raise HTTPException(
                status_code=400,
                detail="无效的颜色编码。请提供有效的 HEX 颜色编码，例如：#FF5733 或 FF5733",
            )
        hex_value = normalized_hex
    else:
        hex_value = generate_random_color()

    return {"result": convert_color_formats(hex_value)}


@router.post("/palette")
def color_palette(
    request: ColorRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("color-picker")),
):
    """基于色彩理论生成配色方案；未提供 color 时生成随机颜色。Requires authentication."""
    hex_input = request.color or generate_random_color()
    normalized_hex = normalize_hex(hex_input)

    if not is_valid_hex(normalized_hex):
        raise HTTPException(
            status_code=400,
            detail="color 参数不是有效的 HEX 颜色编码。请提供有效的 6 位或 3 位 HEX 编码，例如：#FF5733 或 FF5733",
        )

    return {"result": build_palette_data(normalized_hex)}

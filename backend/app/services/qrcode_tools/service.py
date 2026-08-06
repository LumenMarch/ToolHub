"""二维码生成服务。

基于 Python qrcode 库生成 PNG 二维码，对齐 60s 项目的 qrcode 模块：
level 取值 L/M/Q/H（对应 qrcode 的 ERROR_CORRECT_L/M/Q/H）。
"""

import base64
import io

import qrcode
from PIL import Image
from qrcode.constants import (
    ERROR_CORRECT_H,
    ERROR_CORRECT_L,
    ERROR_CORRECT_M,
    ERROR_CORRECT_Q,
)
from qrcode.exceptions import DataOverflowError

# level 取值 → qrcode 纠错级别映射
_LEVEL_MAP = {
    "L": ERROR_CORRECT_L,
    "M": ERROR_CORRECT_M,
    "Q": ERROR_CORRECT_Q,
    "H": ERROR_CORRECT_H,
}

# 尺寸限制
MIN_SIZE = 64
MAX_SIZE = 1024

MIME_TYPE = "image/png"


def generate_qrcode(text: str, size: int = 256, level: str = "M") -> dict:
    """生成二维码并返回 {mime_type, text, base64, data_uri}。

    size 为输出 PNG 的像素尺寸（正方形），level 为纠错级别（L/M/Q/H）。
    """
    error_correction = _LEVEL_MAP[level]

    # 生成二维码图像（box_size=1、border=4 为基础网格），再放大到目标尺寸。
    # 使用最近邻插值，避免模块边缘模糊影响扫码。
    try:
        img = qrcode.make(
            text,
            error_correction=error_correction,
            box_size=1,
            border=4,
        )
    except (DataOverflowError, ValueError):
        # 内容超过 version 40 容量：显式版本拟合失败抛 DataOverflowError；
        # 自动拟合时 version setter 的 check_version(41) 抛 ValueError。
        # 两种都表示内容过长，转 ValueError 由端点转 400（服务层不依赖 fastapi）。
        raise ValueError("内容过长，超出二维码容量上限") from None
    img = img.resize((size, size), Image.Resampling.NEAREST)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    base64_text = base64.b64encode(buffer.getvalue()).decode("ascii")

    return {
        "mime_type": MIME_TYPE,
        "text": text,
        "base64": base64_text,
        "data_uri": f"data:{MIME_TYPE};base64,{base64_text}",
    }

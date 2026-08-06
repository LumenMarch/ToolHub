"""日历服务：合并农历黄历（lunar）与摸鱼日历（moyu）。

lunar 提供历法深度信息（农历/干支/宜忌/节气/月相/八字），moyu 提供
工作状态与倒计时（节假日/周末/进度），两者数据源同源（lunar_python）。
合并后单次请求返回完整信息，单页展示。

响应为「原 lunar 16 块 + 原 moyu 8 块」字段的并集，字段名与
lunar_tools / moyu_tools 两个内部服务实现逐一保持一致，直接复用其
构建函数，避免重复代码。
"""

from datetime import date as Date

from app.services.lunar_tools.service import build_lunar_info
from app.services.moyu_tools.service import build_moyu_calendar


def build_calendar_info(
    year: int,
    month: int,
    day: int,
    hour: int = 0,
    minute: int = 0,
    second: int = 0,
) -> dict:
    """构建日历响应：lunar 全部块 + moyu 全部块（字段名保持不变）。"""
    result = build_lunar_info(year, month, day, hour, minute, second)
    result.update(build_moyu_calendar(Date(year, month, day)))
    return result

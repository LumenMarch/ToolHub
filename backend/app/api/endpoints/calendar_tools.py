"""calendar 工具端点：日历（农历黄历 + 摸鱼日历）。Requires authentication + tool:use。"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
from app.services.calendar_tools.service import build_calendar_info

router = APIRouter()


class CalendarRequest(BaseModel):
    """日历请求参数；date 缺省为服务器本地今天。"""

    date: str | None = None


def _parse_date(date_str: str | None) -> tuple[int, int, int, int, int, int]:
    """解析 YYYY-MM-DD；缺省取服务器本地当前时间（含时分秒）。"""
    if date_str is None:
        now = datetime.now()
        return now.year, now.month, now.day, now.hour, now.minute, now.second
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="日期格式错误：请使用 YYYY-MM-DD 格式，例如 2026-08-08",
        )
    return dt.year, dt.month, dt.day, 0, 0, 0


@router.post("/info")
def calendar_info(
    request: CalendarRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("calendar")),
):
    """查询指定日期（或今天）的完整日历信息（农历黄历 + 摸鱼日历）。Requires authentication."""
    year, month, day, hour, minute, second = _parse_date(request.date)
    return {"result": build_calendar_info(year, month, day, hour, minute, second)}

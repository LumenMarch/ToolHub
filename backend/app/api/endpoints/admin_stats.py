from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_admin_user
from app.crud.crud_audit_log import (
    count_daily_active_users,
    count_logs_since,
    count_tool_calls_by_action,
)
from app.crud.crud_user import count_users, get_users
from app.models.user import User

router = APIRouter()


class OverviewStats(BaseModel):
    total_users: int
    active_users_7d: int
    total_tools: int
    audit_logs_today: int


class ToolCallStat(BaseModel):
    action: str
    count: int


class DailyActiveStat(BaseModel):
    date: str
    count: int


@router.get("/overview", response_model=OverviewStats)
def get_overview(
    db: Session = Depends(deps.get_db),
    _: User = Depends(get_current_admin_user),
):
    """统计概览：用户数、活跃用户数、工具数、今日审计条数。"""
    now = datetime.now(UTC)
    seven_days_ago = now - timedelta(days=7)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_users = count_users(db)
    # 最近 7 天有登录记录的用户视为活跃用户。
    active_users_7d = (
        db.query(User)
        .filter(User.last_login_at.isnot(None), User.last_login_at >= seven_days_ago)
        .count()
    )
    # 工具数 = 数据库中已配置的 ToolMeta 条目数（初始为 0，管理员配置后增长）。
    from app.models.tool_meta import ToolMeta

    total_tools = db.query(ToolMeta).count()
    audit_logs_today = count_logs_since(db, today_start)

    return OverviewStats(
        total_users=total_users,
        active_users_7d=active_users_7d,
        total_tools=total_tools,
        audit_logs_today=audit_logs_today,
    )


@router.get("/tools", response_model=list[ToolCallStat])
def get_tool_calls(
    db: Session = Depends(deps.get_db),
    _: User = Depends(get_current_admin_user),
):
    """各工具调用次数排行。"""
    rows = count_tool_calls_by_action(db)
    return [ToolCallStat(action=action, count=count) for action, count in rows]


@router.get("/active-users", response_model=list[DailyActiveStat])
def get_daily_active_users(
    days: int = 7,
    db: Session = Depends(deps.get_db),
    _: User = Depends(get_current_admin_user),
):
    """最近 N 天每日活跃用户数（基于审计日志）。"""
    now = datetime.now(UTC)
    date_from = (now - timedelta(days=days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    rows = count_daily_active_users(db, date_from, now)
    # SQLite 的 func.date() 返回字符串（如 "2026-07-28"），直接用作 key。
    by_day = {str(day): count for day, count in rows}

    # 补齐空日期，前端折线图才有连续 X 轴。
    result = []
    cursor = date_from.date()
    end = now.date()
    while cursor <= end:
        key = cursor.isoformat()
        result.append(DailyActiveStat(date=key, count=by_day.get(key, 0)))
        cursor += timedelta(days=1)
    return result

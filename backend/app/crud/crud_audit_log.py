from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


def create_log(
    db: Session,
    *,
    user_id: int | None,
    username: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: str | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    log = AuditLog(
        user_id=user_id,
        username=username,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
        ip_address=ip_address,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_logs(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    user_id: int | None = None,
    username: str | None = None,
    action: str | None = None,
    action_prefix: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> tuple[list[AuditLog], int]:
    """返回 (日志列表, 总条数)。"""
    query = select(AuditLog)
    if user_id is not None:
        query = query.where(AuditLog.user_id == user_id)
    if username is not None:
        query = query.where(AuditLog.username.ilike(f"%{username}%"))
    if action is not None:
        query = query.where(AuditLog.action == action)
    if action_prefix is not None:
        query = query.where(AuditLog.action.like(f"{action_prefix}%"))
    if date_from is not None:
        query = query.where(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(AuditLog.created_at <= date_to)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(
        query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit)
    ).all()
    return items, total


def count_logs_since(db: Session, since: datetime) -> int:
    return db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.created_at >= since)
    )


def count_tool_calls_by_action(
    db: Session, since: datetime | None = None
) -> list[tuple[str, int]]:
    """聚合各工具调用次数（action like 'tool.%'，排除 tool.meta.* 管理操作）。

    返回 [(action, count), ...]，按 count 降序。
    since 非 None 时只统计 created_at >= since 的审计日志；None 表示全量。
    """
    query = select(AuditLog.action, func.count(AuditLog.id).label("cnt")).where(
        AuditLog.action.like("tool.%"),
        ~AuditLog.action.like("tool.meta.%"),
    )
    if since is not None:
        query = query.where(AuditLog.created_at >= since)
    return db.execute(
        query.group_by(AuditLog.action).order_by(func.count(AuditLog.id).desc())
    ).all()


def count_daily_active_users(
    db: Session, date_from: datetime, date_to: datetime
) -> list[tuple[datetime, int]]:
    """按天聚合去重活跃用户数（基于审计日志的 user_id）。

    返回 [(day, count), ...]，day 为 UTC 日期 00:00:00。
    """
    day = func.date(AuditLog.created_at)
    return db.execute(
        select(day, func.count(func.distinct(AuditLog.user_id)))
        .where(
            AuditLog.user_id.isnot(None),
            AuditLog.created_at >= date_from,
            AuditLog.created_at < date_to,
        )
        .group_by(day)
        .order_by(day)
    ).all()

from datetime import datetime

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
    query = db.query(AuditLog)
    if user_id is not None:
        query = query.filter(AuditLog.user_id == user_id)
    if username is not None:
        query = query.filter(AuditLog.username.ilike(f"%{username}%"))
    if action is not None:
        query = query.filter(AuditLog.action == action)
    if action_prefix is not None:
        query = query.filter(AuditLog.action.like(f"{action_prefix}%"))
    if date_from is not None:
        query = query.filter(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.filter(AuditLog.created_at <= date_to)
    total = query.count()
    items = query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return items, total


def count_logs_since(db: Session, since: datetime) -> int:
    return db.query(AuditLog).filter(AuditLog.created_at >= since).count()


def count_tool_calls_by_action(db: Session) -> list[tuple[str, int]]:
    """聚合各工具调用次数（action like 'tool.%'）。

    返回 [(action, count), ...]，按 count 降序。
    """
    from sqlalchemy import func

    return (
        db.query(AuditLog.action, func.count(AuditLog.id).label("cnt"))
        .filter(AuditLog.action.like("tool.%"))
        .group_by(AuditLog.action)
        .order_by(func.count(AuditLog.id).desc())
        .all()
    )


def count_daily_active_users(
    db: Session, date_from: datetime, date_to: datetime
) -> list[tuple[datetime, int]]:
    """按天聚合去重活跃用户数（基于审计日志的 user_id）。

    返回 [(day, count), ...]，day 为 UTC 日期 00:00:00。
    """
    from sqlalchemy import func

    day = func.date(AuditLog.created_at)
    return (
        db.query(day, func.count(func.distinct(AuditLog.user_id)))
        .filter(
            AuditLog.user_id.isnot(None),
            AuditLog.created_at >= date_from,
            AuditLog.created_at < date_to,
        )
        .group_by(day)
        .order_by(day)
        .all()
    )

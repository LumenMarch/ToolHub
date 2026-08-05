"""通知中心 CRUD。"""

import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.notification import Notification


def create_notification(
    db: Session,
    *,
    user_id: int,
    type: str,
    title: str,
    payload: dict[str, Any] | None = None,
) -> Notification:
    """写一条站内通知。"""
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        payload=json.dumps(payload or {}, ensure_ascii=False),
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def create_notifications(
    db: Session, entries: list[dict[str, Any]]
) -> list[Notification]:
    """批量写通知：一次 add_all + 一次 commit（通知 fan-out 场景）。

    entries 形如 [{"user_id": int, "type": str, "title": str, "payload": dict}]。
    单次事务避免逐条 commit 的 N 次往返；任一失败整体回滚（调用方决定
    是否容错）。
    """
    notifications = [
        Notification(
            user_id=entry["user_id"],
            type=entry["type"],
            title=entry["title"],
            payload=json.dumps(entry.get("payload") or {}, ensure_ascii=False),
        )
        for entry in entries
    ]
    db.add_all(notifications)
    db.commit()
    return notifications


def get_notification_by_id(db: Session, notification_id: int) -> Notification | None:
    return db.query(Notification).filter(Notification.id == notification_id).first()


def get_notifications(
    db: Session,
    user_id: int,
    skip: int = 0,
    limit: int = 50,
    unread_only: bool = False,
) -> tuple[list[Notification], int]:
    """当前用户通知列表（创建时间倒序），返回 (items, total)。"""
    query = db.query(Notification).filter(Notification.user_id == user_id)
    if unread_only:
        query = query.filter(Notification.read_at.is_(None))
    total = query.count()
    items = (
        query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()
    )
    return items, total


def get_unread_notification_count(db: Session, user_id: int) -> int:
    return (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
        .count()
    )


def mark_notification_read(db: Session, notification: Notification) -> Notification:
    """标记单条已读（幂等）。"""
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        db.add(notification)
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_notifications_read(db: Session, user_id: int) -> int:
    """标记当前用户全部通知已读，返回受影响行数。"""
    result = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
        .update({"read_at": datetime.utcnow()}, synchronize_session=False)
    )
    db.commit()
    return result


def delete_expired_notifications(db: Session, cutoff: datetime) -> int:
    """删除 read_at 早于 cutoff 的已读通知，返回受影响行数。"""
    result = (
        db.query(Notification)
        .filter(
            Notification.read_at.isnot(None),
            Notification.read_at < cutoff,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    return result

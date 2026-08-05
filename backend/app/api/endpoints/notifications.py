"""通知中心端点（登录即可）。

WS 事件只负责提醒，通知详情统一从这里 REST 拉取。
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_user
from app.crud.crud_notification import (
    get_notification_by_id,
    get_notifications,
    get_unread_notification_count,
    mark_all_notifications_read,
    mark_notification_read,
)
from app.models.user import User
from app.schemas.notification import NotificationResponse

router = APIRouter()


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int


class UnreadCountResponse(BaseModel):
    count: int


@router.get("", response_model=NotificationListResponse)
def list_notifications(
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    unread_only: bool = False,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(get_current_user),
):
    """当前用户通知列表（创建时间倒序），payload 已解析为对象。"""
    items, total = get_notifications(
        db,
        user_id=int(current_user.id),
        skip=skip,
        limit=limit,
        unread_only=unread_only,
    )
    return {"items": items, "total": total}


@router.get("/unread-count", response_model=UnreadCountResponse)
def unread_count(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(get_current_user),
):
    """当前用户未读通知数（前端刷新计数用）。"""
    return {"count": get_unread_notification_count(db, int(current_user.id))}


@router.post("/{notification_id}/read", status_code=status.HTTP_200_OK)
def mark_read(
    notification_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(get_current_user),
):
    """标记单条通知已读（幂等）；只能操作自己的通知，跨用户返回 404。"""
    notification = get_notification_by_id(db, notification_id)
    if notification is None or notification.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found"
        )
    mark_notification_read(db, notification)
    return {"status": "ok"}


@router.post("/read-all", status_code=status.HTTP_200_OK)
def mark_read_all(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(get_current_user),
):
    """标记当前用户全部通知已读。"""
    mark_all_notifications_read(db, int(current_user.id))
    return {"status": "ok"}

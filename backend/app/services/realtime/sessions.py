"""会话吊销与权限变更实时通知辅助。

REST 仍是真相源；此处只递增 token_version 并 publish 轻量事件。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.user import User
from app.services.realtime.events import (
    permissions_updated_event,
    session_revoked_event,
)
from app.services.realtime.hub import realtime_hub


def revoke_user_sessions(db: Session, user: User) -> User:
    """递增 token_version 使旧 JWT 失效，并推送 session.revoked。

    用于：管理员停用、重置密码、删除用户前踢下线等安全相关操作。
    普通登出（清 cookie）不应调用本函数，以保留其它设备会话。
    """
    user.token_version = int(user.token_version or 0) + 1
    db.add(user)
    db.commit()
    db.refresh(user)
    realtime_hub.publish(
        session_revoked_event(user_id=int(user.id)),
        user_id=int(user.id),
    )
    return user


def notify_permissions_updated(user_id: int) -> None:
    """推送 permissions.updated，客户端应重新 GET /users/me。

    不递增 token_version，避免强制重新登录；仅刷新前端权限/角色。
    """
    realtime_hub.publish(
        permissions_updated_event(user_id=int(user_id)),
        user_id=int(user_id),
    )


def notify_role_permissions_updated(db: Session, role_id: int) -> None:
    """角色权限变更后，通知持有该角色的全部在线用户刷新权限。"""
    from app.models.role import Role

    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        return
    # selectin 已加载 users；逐用户定向推送
    seen: set[int] = set()
    for user in role.users:
        uid = int(user.id)
        if uid in seen:
            continue
        seen.add(uid)
        notify_permissions_updated(uid)

"""会话吊销与权限变更实时通知辅助。

REST 仍是真相源；此处只递增 token_version / 标记会话吊销并 publish 轻量事件。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.crud.crud_session import (
    revoke_all_user_sessions,
    revoke_user_session,
)
from app.models.user import User
from app.models.user_session import UserSession
from app.services.realtime.events import (
    permissions_updated_event,
    session_revoked_event,
    user_pending_event,
    user_status_updated_event,
)
from app.services.realtime.hub import realtime_hub


def revoke_user_sessions(db: Session, user: User) -> User:
    """全局吊销：递增 token_version 使旧 JWT 失效，并同步吊销全部会话。

    推送单个 session.revoked（不含 sid 键，表示全部会话被吊销）；
    客户端比对 current_session_id，事件无 sid 或命中本设备即登出。
    用于：管理员停用、重置密码、删除用户前踢下线、审批驳回等安全相关操作。
    普通登出（清 cookie）不应调用本函数，以保留其它设备会话。
    """
    revoke_all_user_sessions(db, int(user.id))
    user.token_version = int(user.token_version or 0) + 1
    db.add(user)
    db.commit()
    db.refresh(user)
    realtime_hub.publish(
        session_revoked_event(user_id=int(user.id)),
        user_id=int(user.id),
    )
    return user


def revoke_single_user_session(db: Session, user_session: UserSession) -> UserSession:
    """单会话吊销：标记 revoked_at 并定向推送带 sid 的 session.revoked。

    幂等：已吊销的会话不重复推送；不递增 token_version，其余会话不受影响。
    推送后主动关闭该 sid 的全部 WS 连接（兜底僵尸连接），
    客户端收到 session.revoked 后自行登出。
    """
    was_active = user_session.revoked_at is None
    user_session = revoke_user_session(db, user_session)
    if was_active:
        realtime_hub.publish(
            session_revoked_event(
                user_id=int(user_session.user_id),
                sid=user_session.jti,
            ),
            user_id=int(user_session.user_id),
        )
        realtime_hub.close_user_session(user_session.jti)
    return user_session


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


def notify_user_status_updated(user_id: int, status: str) -> None:
    """审批通过/驳回后定向通知目标用户，客户端刷新 /users/me。"""
    realtime_hub.publish(
        user_status_updated_event(user_id=int(user_id), status=status),
        user_id=int(user_id),
    )


def notify_user_pending(user_id: int) -> None:
    """新注册待审批广播（hub 无角色过滤，管理员端自行刷新计数）。"""
    realtime_hub.publish(user_pending_event(user_id=int(user_id)))

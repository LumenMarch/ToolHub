"""用户会话 CRUD（方案 A 会话管理）。"""

from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.user_session import UserSession


def _online_cutoff() -> datetime:
    """在线判定截止时间：now - SESSION_ONLINE_WINDOW_MINUTES。"""
    from app.core.config import settings

    return datetime.utcnow() - timedelta(minutes=settings.SESSION_ONLINE_WINDOW_MINUTES)


def get_online_user_ids(db: Session, cutoff: datetime | None = None) -> set[int]:
    """最近窗口内有活跃会话的用户 id 集合（在线判定，批量）。

    活跃 = 未吊销 且 coalesce(last_seen_at, created_at) >= cutoff；
    last_seen_at 为 NULL 的会话按 created_at 算（刚登录的会话也在窗口内）。
    """
    cutoff = cutoff or _online_cutoff()
    rows = db.execute(
        select(UserSession.user_id)
        .where(
            UserSession.revoked_at.is_(None),
            func.coalesce(UserSession.last_seen_at, UserSession.created_at) >= cutoff,
        )
        .distinct()
    ).all()
    return {row[0] for row in rows}


def is_user_online(db: Session, user_id: int, cutoff: datetime | None = None) -> bool:
    """单个用户是否在线（单用户响应场景）。"""
    cutoff = cutoff or _online_cutoff()
    row = db.execute(
        select(UserSession.id).where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
            func.coalesce(UserSession.last_seen_at, UserSession.created_at) >= cutoff,
        )
    ).first()
    return row is not None


def create_user_session(
    db: Session,
    *,
    user_id: int,
    jti: str,
    ip: str | None = None,
    user_agent: str | None = None,
) -> UserSession:
    """登录成功时登记新会话。"""
    user_session = UserSession(
        user_id=user_id,
        jti=jti,
        ip=ip,
        user_agent=user_agent,
    )
    db.add(user_session)
    db.commit()
    db.refresh(user_session)
    return user_session


def get_user_session_by_jti(db: Session, jti: str) -> UserSession | None:
    """按 JWT 的 sid 声明查会话（鉴权路径使用）。"""
    return db.scalars(select(UserSession).where(UserSession.jti == jti)).first()


def get_user_session_by_id(db: Session, session_id: int) -> UserSession | None:
    return db.scalars(select(UserSession).where(UserSession.id == session_id)).first()


def get_user_sessions(db: Session, user_id: int) -> list[UserSession]:
    """用户全部会话（含已吊销），按创建时间倒序。"""
    return db.scalars(
        select(UserSession)
        .where(UserSession.user_id == user_id)
        .order_by(UserSession.created_at.desc())
    ).all()


def revoke_user_session(db: Session, user_session: UserSession) -> UserSession:
    """吊销单个会话（幂等：已吊销不重复置位）。"""
    if user_session.revoked_at is None:
        user_session.revoked_at = datetime.utcnow()
        db.add(user_session)
        db.commit()
        db.refresh(user_session)
    return user_session


def revoke_all_user_sessions(db: Session, user_id: int) -> int:
    """吊销用户全部未吊销会话，返回受影响行数。"""
    result = db.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
        .values({"revoked_at": datetime.utcnow()}),
        execution_options={"synchronize_session": False},
    )
    db.commit()
    return result.rowcount

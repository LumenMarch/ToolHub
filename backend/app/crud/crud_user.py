from datetime import datetime

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.crud.crud_role import get_roles_by_ids
from app.models.user import (
    USER_STATUS_APPROVED,
    USER_STATUS_PENDING,
    USER_STATUS_REJECTED,
    User,
)
from app.schemas.user import UserCreate, UserCreateByAdmin, UserUpdate


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_users(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    statuses: list[str] | None = None,
) -> tuple[list[User], int, set[int]]:
    """按条件查询用户，返回 (列表, 总数, 在线用户 id 集合)。

    statuses 为允许的审批状态列表（多选），None 表示不过滤。
    online_ids 通过单次批量查询获得（见 crud_session.get_online_user_ids），
    避免每用户 N+1 次会话查询。
    """
    query = db.query(User)
    if search:
        query = query.filter(User.username.ilike(f"%{search}%"))
    if statuses:
        query = query.filter(User.status.in_(statuses))
    total = query.count()
    items = query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()
    online_ids: set[int] = set()
    if items:
        from app.crud.crud_session import get_online_user_ids

        online_ids = get_online_user_ids(db)
    return items, total, online_ids


def count_users(db: Session) -> int:
    return db.query(User).count()


def create_user(db: Session, user_in: UserCreate) -> User:
    """自助注册：新用户一律 pending，不分配任何角色。"""
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        username=user_in.username,
        hashed_password=hashed_password,
        status=USER_STATUS_PENDING,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def create_user_by_admin(db: Session, user_in: UserCreateByAdmin) -> User:
    """管理员创建用户，可指定初始角色；管理员显式创建即视为已审批。"""
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        username=user_in.username,
        hashed_password=hashed_password,
        status=USER_STATUS_APPROVED,
    )
    if user_in.role_ids:
        roles = get_roles_by_ids(db, user_in.role_ids)
        db_user.roles = roles
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def get_unapproved_users_older_than(db: Session, cutoff: datetime) -> list[User]:
    """查询创建时间早于 cutoff 且仍未审批（pending/rejected）的用户。"""
    return (
        db.query(User)
        .filter(
            User.status.in_([USER_STATUS_PENDING, USER_STATUS_REJECTED]),
            User.created_at < cutoff,
        )
        .order_by(User.id)
        .all()
    )


def update_user(db: Session, user: User, user_in: UserUpdate) -> User:
    """按需更新用户字段。"""
    if user_in.is_active is not None:
        user.is_active = user_in.is_active
    if user_in.password is not None:
        user.hashed_password = get_password_hash(user_in.password)
    if user_in.role_ids is not None:
        roles = get_roles_by_ids(db, user_in.role_ids)
        user.roles = roles
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()


def update_last_login(db: Session, user: User) -> None:
    user.last_login_at = datetime.utcnow()
    db.commit()

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.crud.crud_role import get_roles_by_ids
from app.models.audit_log import AuditLog
from app.models.permission import Permission
from app.models.user import (
    USER_STATUS_APPROVED,
    USER_STATUS_PENDING,
    USER_STATUS_REJECTED,
    User,
)
from app.schemas.user import UserCreate, UserCreateByAdmin, UserUpdate


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.scalars(select(User).where(User.username == username)).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.scalars(select(User).where(User.id == user_id)).first()


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
    query = select(User)
    if search:
        query = query.where(User.username.ilike(f"%{search}%"))
    if statuses:
        query = query.where(User.status.in_(statuses))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(
        query.order_by(User.created_at.desc()).offset(skip).limit(limit)
    ).all()
    online_ids: set[int] = set()
    if items:
        from app.crud.crud_session import get_online_user_ids

        online_ids = get_online_user_ids(db)
    return items, total, online_ids


def count_users(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User))


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
    return db.scalars(
        select(User)
        .where(
            User.status.in_([USER_STATUS_PENDING, USER_STATUS_REJECTED]),
            User.created_at < cutoff,
        )
        .order_by(User.id)
    ).all()


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
    """删除用户。

    审计日志按设计保留（AuditLog 冗余 username 字段，保证删号后日志仍可读）：
    先把引用该用户的 audit_logs.user_id 置空——audit_logs 外键未声明
    ON DELETE CASCADE，直接删 user 会触发 SQLite 外键约束错误（500）。
    其余引用表（user_roles / user_permissions / user_sessions / notifications）
    均声明了 ON DELETE CASCADE，由数据库级联清理。
    """
    db.execute(update(AuditLog).where(AuditLog.user_id == user.id).values(user_id=None))
    db.delete(user)
    db.commit()


def update_last_login(db: Session, user: User) -> None:
    user.last_login_at = datetime.utcnow()
    db.commit()


def validate_direct_tool_permissions(
    db: Session, permission_ids: list[int]
) -> list[Permission]:
    """校验并解析用户直接工具权限 ID，返回 Permission 列表。

    - 去重（与 approve 的 role_ids 处理一致）；
    - 权限必须存在（防止无效 ID 被静默丢弃）；
    - 仅接受 tool:*:use 权限——管理权限（user:read 等）只走角色，
      防止绕过层级保护直接提权。
    校验失败抛 ValueError（由端点转为 400）。
    供端点在持久化之前预校验，避免校验失败造成部分提交。
    """
    unique_ids = list(dict.fromkeys(permission_ids))
    permissions = db.scalars(
        select(Permission).where(Permission.id.in_(unique_ids))
    ).all()
    found = {p.id: p for p in permissions}
    if len(found) != len(unique_ids):
        raise ValueError("包含不存在的权限 ID")
    for pid in unique_ids:
        perm = found[pid]
        if not perm.codename.startswith("tool:"):
            raise ValueError(f"权限 {perm.codename} 不是工具使用权限")
    return permissions


def set_user_direct_permissions(
    db: Session, user: User, permission_ids: list[int]
) -> User:
    """覆盖式设置用户直接持有的工具权限（仅接受 tool:*:use）。

    permission_ids=[] 表示清空全部直接工具权限；
    校验失败抛 ValueError，且不做任何写入。
    """
    permissions = validate_direct_tool_permissions(db, permission_ids)
    user.direct_permissions = permissions
    db.commit()
    db.refresh(user)
    return user


def get_user_direct_tool_permissions(db: Session, user: User) -> list[str]:
    """返回用户直接持有的工具权限 codename，按 codename 排序。"""
    return sorted(p.codename for p in user.direct_permissions)

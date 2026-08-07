from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.permission import Permission
from app.models.role import Role, role_permissions, user_roles
from app.models.user import User


def get_all_roles(db: Session) -> list[Role]:
    return db.scalars(select(Role).order_by(Role.id)).all()


def get_role_by_id(db: Session, role_id: int) -> Role | None:
    return db.scalars(select(Role).where(Role.id == role_id)).first()


def get_role_by_name(db: Session, name: str) -> Role | None:
    return db.scalars(select(Role).where(Role.name == name)).first()


def get_roles_by_ids(db: Session, ids: list[int]) -> list[Role]:
    return db.scalars(select(Role).where(Role.id.in_(ids))).all()


def create_role(db: Session, name: str, description: str = "") -> Role:
    role = Role(name=name, description=description)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def update_role(
    db: Session, role: Role, name: str | None, description: str | None
) -> Role:
    if name is not None:
        role.name = name
    if description is not None:
        role.description = description
    db.commit()
    db.refresh(role)
    return role


def delete_role(db: Session, role: Role) -> None:
    db.delete(role)
    db.commit()


def set_role_permissions(db: Session, role: Role, permission_ids: list[int]) -> Role:
    permissions = db.scalars(
        select(Permission).where(Permission.id.in_(permission_ids))
    ).all()
    role.permissions = permissions
    db.commit()
    db.refresh(role)
    return role


def get_user_permissions(db: Session, user: User) -> set[str]:
    """返回用户所有角色的权限 codename 并集。"""
    permissions: set[str] = set()
    for role in user.roles:
        for perm in role.permissions:
            permissions.add(perm.codename)
    return permissions


def get_user_ids_with_permission(db: Session, codename: str) -> list[int]:
    """返回拥有指定权限（codename）的全部用户 id（去重）。

    用于注册待审批等场景的通知广播：遍历用户表逐个算权限在
    内网规模下可接受，但 SQL join 更直接。
    """
    rows = db.execute(
        select(User.id)
        .join(user_roles, user_roles.c.user_id == User.id)
        .join(Role, Role.id == user_roles.c.role_id)
        .join(role_permissions, role_permissions.c.role_id == Role.id)
        .join(Permission, Permission.id == role_permissions.c.permission_id)
        .where(Permission.codename == codename)
        .distinct()
    ).all()
    return [row[0] for row in rows]


def get_user_roles(db: Session, user: User) -> list[Role]:
    """返回用户的角色列表（已加载 permissions）。"""
    return user.roles

from sqlalchemy.orm import Session

from app.models.permission import Permission
from app.models.role import Role
from app.models.user import User


def get_all_roles(db: Session) -> list[Role]:
    return db.query(Role).order_by(Role.id).all()


def get_role_by_id(db: Session, role_id: int) -> Role | None:
    return db.query(Role).filter(Role.id == role_id).first()


def get_role_by_name(db: Session, name: str) -> Role | None:
    return db.query(Role).filter(Role.name == name).first()


def get_roles_by_ids(db: Session, ids: list[int]) -> list[Role]:
    return db.query(Role).filter(Role.id.in_(ids)).all()


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
    permissions = db.query(Permission).filter(Permission.id.in_(permission_ids)).all()
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


def get_user_roles(db: Session, user: User) -> list[Role]:
    """返回用户的角色列表（已加载 permissions）。"""
    return user.roles

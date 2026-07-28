from datetime import datetime

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.crud.crud_role import get_roles_by_ids
from app.models.user import User
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
) -> list[User]:
    query = db.query(User)
    if search:
        query = query.filter(User.username.ilike(f"%{search}%"))
    return query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()


def count_users(db: Session) -> int:
    return db.query(User).count()


def create_user(db: Session, user_in: UserCreate) -> User:
    hashed_password = get_password_hash(user_in.password)
    db_user = User(username=user_in.username, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def create_user_by_admin(db: Session, user_in: UserCreateByAdmin) -> User:
    """管理员创建用户，可指定初始角色。"""
    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        username=user_in.username,
        hashed_password=hashed_password,
    )
    if user_in.role_ids:
        roles = get_roles_by_ids(db, user_in.role_ids)
        db_user.roles = roles
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


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

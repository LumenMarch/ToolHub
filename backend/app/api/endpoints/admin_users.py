from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_admin_user
from app.crud.crud_user import (
    count_users,
    create_user_by_admin,
    delete_user,
    get_user_by_id,
    get_user_by_username,
    get_users,
    update_user,
)
from app.models.user import User
from app.schemas.user import UserCreateByAdmin, UserResponse, UserUpdate
from app.services.audit import log_action

router = APIRouter()


@router.get("", response_model=list[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    db: Session = Depends(deps.get_db),
    _: User = Depends(get_current_admin_user),
):
    """列出所有用户，支持按用户名搜索。"""
    return get_users(db, skip=skip, limit=limit, search=search)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    user_in: UserCreateByAdmin,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(get_current_admin_user),
):
    """管理员创建用户。"""
    if get_user_by_username(db, user_in.username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    user = create_user_by_admin(db, user_in)
    log_action(
        db,
        request=request,
        user=admin,
        action="user.create",
        target_type="user",
        target_id=user.id,
        detail={"username": user.username, "is_admin": user.is_admin},
    )
    return user


@router.patch("/{user_id}", response_model=UserResponse)
def update_user_endpoint(
    user_id: int,
    user_in: UserUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(get_current_admin_user),
):
    """管理员修改用户（角色 / 启用状态 / 重置密码）。

    不允许撤销自己的管理员权限或封禁自己，避免误操作失去管理能力。
    """
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if admin.id == user.id:
        if user_in.is_admin is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot revoke your own admin privileges",
            )
        if user_in.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate yourself",
            )

    updated = update_user(db, user, user_in)
    log_action(
        db,
        request=request,
        user=admin,
        action="user.update",
        target_type="user",
        target_id=user.id,
        detail=user_in.model_dump(exclude_none=True),
    )
    return updated


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_endpoint(
    user_id: int,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(get_current_admin_user),
):
    """管理员删除用户。不允许删除自己。"""
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if admin.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself",
        )
    deleted_username = user.username
    delete_user(db, user)
    log_action(
        db,
        request=request,
        user=admin,
        action="user.delete",
        target_type="user",
        target_id=user_id,
        detail={"username": deleted_username},
    )

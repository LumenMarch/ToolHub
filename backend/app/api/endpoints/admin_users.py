from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission
from app.crud.crud_user import (
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
from app.services.realtime.sessions import (
    notify_permissions_updated,
    revoke_user_sessions,
)

router = APIRouter()


@router.get("", response_model=list[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("user:read")),
):
    """列出所有用户，支持按用户名搜索。"""
    return get_users(db, skip=skip, limit=limit, search=search)


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    user_in: UserCreateByAdmin,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
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
        detail={
            "username": user.username,
            "role_ids": user_in.role_ids,
        },
    )
    return _user_to_response(user, db)


@router.patch("/{user_id}", response_model=UserResponse)
def update_user_endpoint(
    user_id: int,
    user_in: UserUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """管理员修改用户（角色 / 启用状态 / 重置密码）。

    不允许封禁自己，避免误操作失去管理能力。
    """
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # 自保护 — 不能封禁自己或修改自己的角色
    if admin.id == user.id:
        if user_in.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot deactivate yourself",
            )
        if user_in.role_ids is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own roles",
            )

    # 层级保护 — 不能修改比自己权限更高的用户（拥有自己不具备的角色）
    admin_role_names = {r.name for r in admin.roles}
    target_role_names = {r.name for r in user.roles}
    if not admin_role_names.issuperset(target_role_names):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify a user with higher privileges",
        )

    # 记录变更意图（update 前），用于安全相关吊销与权限推送
    roles_changed = user_in.role_ids is not None
    password_changed = user_in.password is not None
    deactivated = user_in.is_active is False

    updated = update_user(db, user, user_in)
    log_action(
        db,
        request=request,
        user=admin,
        action="user.update",
        target_type="user",
        target_id=user.id,
        # 排除 password，防止明文密码写入审计日志
        detail=user_in.model_dump(exclude_none=True, exclude={"password"}),
    )

    # 停用 / 重置密码：递增 token_version，踢掉全部旧会话
    if deactivated or password_changed:
        updated = revoke_user_sessions(db, updated)
    elif roles_changed:
        # 仅角色变更：推权限刷新，不强制重新登录
        notify_permissions_updated(int(updated.id))

    return _user_to_response(updated, db)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user_endpoint(
    user_id: int,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """管理员删除用户。不允许删除自己。"""
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if admin.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete yourself",
        )
    # 层级保护
    admin_role_names = {r.name for r in admin.roles}
    target_role_names = {r.name for r in user.roles}
    if not admin_role_names.issuperset(target_role_names):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a user with higher privileges",
        )
    deleted_username = user.username
    # 先吊销会话（通知在线客户端），再物理删除
    revoke_user_sessions(db, user)
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


def _user_to_response(user: User, db: Session) -> dict:
    """将 User 模型转为 UserResponse 所需字典。"""
    from app.crud.crud_role import get_user_permissions

    return {
        "id": user.id,
        "username": user.username,
        "is_active": user.is_active,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
        "roles": [role.name for role in user.roles],
        "permissions": sorted(get_user_permissions(db, user)),
    }

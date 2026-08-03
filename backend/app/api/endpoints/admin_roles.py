from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission
from app.crud.crud_permission import get_all_permissions
from app.crud.crud_role import (
    create_role,
    delete_role,
    get_all_roles,
    get_role_by_id,
    get_roles_by_ids,
    set_role_permissions,
    update_role,
)
from app.crud.crud_user import get_user_by_id
from app.models.user import User
from app.services.audit import log_action
from app.services.realtime.sessions import (
    notify_permissions_updated,
    notify_role_permissions_updated,
)

router = APIRouter()


# ===== 输出 Schema =====


class PermissionOut(BaseModel):
    id: int
    codename: str
    description: str
    model_config = {"from_attributes": True}


class RoleOut(BaseModel):
    id: int
    name: str
    description: str
    permissions: list[PermissionOut]
    model_config = {"from_attributes": True}


class RoleListItem(BaseModel):
    id: int
    name: str
    description: str
    permission_count: int
    model_config = {"from_attributes": True}


# ===== 输入 Schema =====


class RoleCreate(BaseModel):
    name: str
    description: str = ""


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class RolePermissionsUpdate(BaseModel):
    permission_ids: list[int]


class UserRolesUpdate(BaseModel):
    role_ids: list[int]


# ===== 角色 CRUD =====


@router.get("/roles", response_model=list[RoleListItem])
def list_roles(
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("role:read")),
):
    """列出所有角色。"""
    roles = get_all_roles(db)
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "permission_count": len(r.permissions),
        }
        for r in roles
    ]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role_endpoint(
    role_in: RoleCreate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("role:write")),
):
    """创建新角色。"""
    role = create_role(db, name=role_in.name, description=role_in.description)
    log_action(
        db,
        request=request,
        user=admin,
        action="role.create",
        target_type="role",
        target_id=role.id,
        detail={"name": role.name},
    )
    return role


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role_endpoint(
    role_id: int,
    role_in: RoleUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("role:write")),
):
    """编辑角色名称或描述。"""
    role = get_role_by_id(db, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="角色不存在")
    updated = update_role(db, role, name=role_in.name, description=role_in.description)
    log_action(
        db,
        request=request,
        user=admin,
        action="role.update",
        target_type="role",
        target_id=role.id,
        detail=role_in.model_dump(exclude_none=True),
    )
    return updated


@router.delete("/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_role_endpoint(
    role_id: int,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("role:write")),
):
    """删除角色。不允许删除自己拥有的角色。"""
    role = get_role_by_id(db, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="角色不存在")
    if role in admin.roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a role assigned to yourself",
        )
    # 删除前记下受影响用户；CASCADE 去掉关联后权限集已变
    affected_user_ids = sorted({int(user.id) for user in role.users})
    role_name = role.name
    delete_role(db, role)
    log_action(
        db,
        request=request,
        user=admin,
        action="role.delete",
        target_type="role",
        target_id=role_id,
        detail={"name": role_name},
    )
    for uid in affected_user_ids:
        notify_permissions_updated(uid)


# ===== 角色权限管理 =====


@router.get("/roles/{role_id}/permissions", response_model=list[PermissionOut])
def get_role_permissions(
    role_id: int,
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("role:read")),
):
    """查看角色的权限列表。"""
    role = get_role_by_id(db, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="角色不存在")
    return role.permissions


@router.put("/roles/{role_id}/permissions", response_model=RoleOut)
def update_role_permissions(
    role_id: int,
    perm_in: RolePermissionsUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("role:write")),
):
    """设置角色权限（覆盖式）。"""
    role = get_role_by_id(db, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="角色不存在")
    updated = set_role_permissions(db, role, perm_in.permission_ids)
    log_action(
        db,
        request=request,
        user=admin,
        action="role.permissions_update",
        target_type="role",
        target_id=role.id,
        detail={"permission_ids": perm_in.permission_ids},
    )
    # 持有该角色的用户权限集已变，推送刷新 /users/me
    notify_role_permissions_updated(db, int(updated.id))
    return updated


# ===== 权限列表（供 UI 勾选） =====


@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("role:read")),
):
    """列出系统中所有可用权限。"""
    return get_all_permissions(db)


# ===== 用户角色管理 =====


@router.get("/users/{user_id}/roles", response_model=list[RoleListItem])
def get_user_roles(
    user_id: int,
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("user:read")),
):
    """查看用户的角色列表。"""
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "permission_count": len(r.permissions),
        }
        for r in user.roles
    ]


@router.patch("/users/{user_id}/roles", response_model=list[RoleListItem])
def update_user_roles(
    user_id: int,
    roles_in: UserRolesUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """为用户设置角色（覆盖式）。不允许修改自己的角色。"""
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    if admin.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own roles",
        )
    # 层级保护 — 不能修改比自己权限更高的用户
    admin_role_names = {r.name for r in admin.roles}
    target_role_names = {r.name for r in user.roles}
    if not admin_role_names.issuperset(target_role_names):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify a user with higher privileges",
        )
    roles = get_roles_by_ids(db, roles_in.role_ids)
    user.roles = roles
    db.commit()
    db.refresh(user)
    log_action(
        db,
        request=request,
        user=admin,
        action="user.role_change",
        target_type="user",
        target_id=user.id,
        detail={"username": user.username, "role_ids": roles_in.role_ids},
    )
    notify_permissions_updated(int(user.id))
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description,
            "permission_count": len(r.permissions),
        }
        for r in user.roles
    ]

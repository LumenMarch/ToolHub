from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission
from app.crud.crud_notification import create_notification
from app.crud.crud_role import get_role_by_name, get_roles_by_ids
from app.crud.crud_session import (
    get_user_session_by_id,
    get_user_sessions,
)
from app.crud.crud_user import (
    create_user_by_admin,
    delete_user,
    get_user_by_id,
    get_user_by_username,
    get_user_direct_tool_permissions,
    get_users,
    set_user_direct_permissions,
    update_user,
    validate_direct_tool_permissions,
)
from app.models.permission import Permission
from app.models.user import (
    USER_STATUS_APPROVED,
    USER_STATUS_PENDING,
    USER_STATUS_REJECTED,
    User,
)
from app.schemas.user import UserCreateByAdmin, UserResponse, UserUpdate
from app.schemas.user_session import UserSessionResponse
from app.services.audit import log_action
from app.services.realtime.sessions import (
    notify_permissions_updated,
    notify_user_status_updated,
    revoke_single_user_session,
    revoke_user_sessions,
)

router = APIRouter()


class UserListResponse(BaseModel):
    """用户列表分页响应，形态与 GET /admin/audit 一致。"""

    items: list[UserResponse]
    total: int


class UserApproveRequest(BaseModel):
    """审批通过请求体；role_ids 未提供（None）时服务端分配默认"工具使用者"角色，
    显式传空数组 [] 则不分配任何角色。"""

    role_ids: list[int] | None = None
    # 审批时一并设置的用户直接工具权限 ID（覆盖式，仅 tool:*:use）；
    # None = 不设置直接权限
    tool_permission_ids: list[int] | None = None


class UserRejectRequest(BaseModel):
    """驳回请求体；reason 仅写入审计日志，不展示给用户。"""

    reason: str | None = None


def _parse_statuses(raw: str | None) -> list[str] | None:
    """解析 status 查询参数（逗号分隔多值）；未提供返回 None（不过滤）。"""
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    allowed = {USER_STATUS_PENDING, USER_STATUS_APPROVED, USER_STATUS_REJECTED}
    if any(p not in allowed for p in parts):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"status 取值仅支持 {sorted(allowed)}",
        )
    return parts


def _ensure_can_manage(admin: User, target: User) -> None:
    """层级保护 — 不能审批/修改比自己权限更高的用户。

    pending/rejected 用户通常无角色，空集合天然满足保护；
    保留检查以覆盖（罕见的）带角色用户被驳回后重新审批的场景。
    """
    admin_role_names = {r.name for r in admin.roles}
    target_role_names = {r.name for r in target.roles}
    if not admin_role_names.issuperset(target_role_names):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify a user with higher privileges",
        )


def _safe_create_notification(db: Session, **kwargs) -> None:
    """通知写库容错：失败仅记日志，不影响审批结果与审计（与 log_action 同样式）。

    审批动作的状态变更已先于通知 commit；若通知写库抛异常导致 500，
    客户端重试会被"仅 pending/rejected 可审批"挡住，造成结果已生效
    但接口报错的假象。
    """
    try:
        create_notification(db, **kwargs)
    except Exception:
        logger.exception(
            "notification write failed type={} title={}",
            kwargs.get("type"),
            kwargs.get("title"),
        )


@router.get("", response_model=UserListResponse)
def list_users(
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    status: str | None = Query(default=None, description="逗号分隔多值"),
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("user:read")),
):
    """列出所有用户，支持按用户名搜索与审批状态筛选（多值）。"""
    items, total, online_ids = get_users(
        db,
        skip=skip,
        limit=limit,
        search=search,
        statuses=_parse_statuses(status),
    )
    return {
        "items": [_user_to_response(user, db, online_ids=online_ids) for user in items],
        "total": total,
    }


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    user_in: UserCreateByAdmin,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """管理员创建用户（创建即 approved）。"""
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

    # 自保护 — 不能封禁自己、修改自己的角色或直接工具权限
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
        # 防止 user:write 持有者绕过前端约束，自行授予任意工具权限
        if user_in.tool_permission_ids is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot change your own tool permissions",
            )

    # 层级保护 — 不能修改比自己权限更高的用户（拥有自己不具备的角色）
    _ensure_can_manage(admin, user)

    # 记录变更意图（update 前），用于安全相关吊销与权限推送
    roles_changed = user_in.role_ids is not None
    tool_perms_changed = user_in.tool_permission_ids is not None
    password_changed = user_in.password is not None
    deactivated = user_in.is_active is False

    # 直接工具权限：在任何写入之前先校验（仅 tool:*:use），
    # 校验失败返回 400，避免"角色已提交但接口报错"的部分提交
    if tool_perms_changed:
        try:
            validate_direct_tool_permissions(db, user_in.tool_permission_ids)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

    updated = update_user(db, user, user_in)

    # 覆盖式设置直接工具权限（校验已通过，此处不会失败）
    if tool_perms_changed:
        updated = set_user_direct_permissions(db, updated, user_in.tool_permission_ids)
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
    elif roles_changed or tool_perms_changed:
        # 仅角色 / 直接权限变更：推权限刷新，不强制重新登录
        notify_permissions_updated(int(updated.id))

    return _user_to_response(updated, db)


@router.post("/{user_id}/approve", response_model=UserResponse)
def approve_user_endpoint(
    user_id: int,
    request: Request,
    approve_in: UserApproveRequest | None = None,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """审批通过：pending → approved，也用于恢复 rejected 用户（re-approve）。

    role_ids 未提供（None）时服务端分配"工具使用者"角色（查不到该角色则 400）；
    显式传空数组 [] 则不分配任何角色（通常配合 tool_permission_ids 使用）。
    审计 action=user.approve；定向推送 user.status.updated。
    """
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.status not in (USER_STATUS_PENDING, USER_STATUS_REJECTED):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending or rejected users can be approved",
        )
    _ensure_can_manage(admin, user)

    # 直接工具权限：先校验（仅 tool:*:use），再与角色/状态同一事务提交，
    # 避免"审批已生效但接口报 400"的假象（与通知写库同一考量）
    direct_perms: list[Permission] | None = None
    if approve_in is not None and approve_in.tool_permission_ids is not None:
        try:
            direct_perms = validate_direct_tool_permissions(
                db, approve_in.tool_permission_ids
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc

    role_ids = (approve_in or UserApproveRequest()).role_ids
    if role_ids is None:
        # role_ids 未提供：默认分配"工具使用者"（低权角色），不受提权校验限制
        tool_role = get_role_by_name(db, "工具使用者")
        if tool_role is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='未找到默认角色"工具使用者"，请检查权限种子数据',
            )
        roles = [tool_role]
    elif role_ids:
        # 非空：去重后校验角色存在性，防止无效 ID 被 get_roles_by_ids 静默丢弃
        unique_ids = list(dict.fromkeys(role_ids))
        roles = get_roles_by_ids(db, unique_ids)
        if len(roles) != len(unique_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="包含不存在的角色 ID",
            )
        # 提权防护：显式授予的角色必须是当前管理员自身角色的子集，
        # 防止低阶管理员借此给自己/他人授予超管等高权限角色。
        admin_role_ids = {r.id for r in admin.roles}
        granted_role_ids = {r.id for r in roles}
        if not granted_role_ids.issubset(admin_role_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能授予高于自身权限的角色",
            )
    else:
        # 显式空数组：不分配任何角色（通常配合 tool_permission_ids 使用，由管理员自行负责）
        roles = []
    previous_status = user.status
    user.roles = roles
    user.status = USER_STATUS_APPROVED
    if direct_perms is not None:
        user.direct_permissions = direct_perms
    db.add(user)
    db.commit()
    db.refresh(user)

    log_action(
        db,
        request=request,
        user=admin,
        action="user.approve",
        target_type="user",
        target_id=user.id,
        detail={
            "username": user.username,
            "role_ids": [r.id for r in roles],
            "previous_status": previous_status,
        },
    )
    notify_user_status_updated(int(user.id), USER_STATUS_APPROVED)
    if direct_perms is not None:
        # 审批时设置了直接工具权限：补推权限刷新（不递增 token_version）
        notify_permissions_updated(int(user.id))
    # 通知中心落库：审批结果通知当事用户（写失败不影响审批结果）
    _safe_create_notification(
        db,
        user_id=int(user.id),
        type="user.status.updated",
        title="注册申请已通过",
        payload={"status": USER_STATUS_APPROVED},
    )
    return _user_to_response(user, db)


@router.post("/{user_id}/reject", response_model=UserResponse)
def reject_user_endpoint(
    user_id: int,
    request: Request,
    reject_in: UserRejectRequest | None = None,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """驳回注册：仅允许 pending 用户；审计 action=user.reject。

    被驳回用户登录时返回区分文案；TTL 到期后用户名释放。
    rejected 用户恢复走 /approve（re-approve），不单独提供 restore 端点。
    reason 仅用于审计留痕，不展示给被驳回用户。
    """
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    if user.status != USER_STATUS_PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only pending users can be rejected",
        )
    _ensure_can_manage(admin, user)

    user.status = USER_STATUS_REJECTED
    db.add(user)
    db.commit()
    db.refresh(user)
    # 与停用语义一致：递增 token_version 吊销全部旧会话并推送 session.revoked，
    # 防止被驳回用户持有审批前的 token 继续访问接口
    user = revoke_user_sessions(db, user)

    detail: dict = {"username": user.username}
    if reject_in is not None and reject_in.reason:
        detail["reason"] = reject_in.reason
    log_action(
        db,
        request=request,
        user=admin,
        action="user.reject",
        target_type="user",
        target_id=user.id,
        detail=detail,
    )
    notify_user_status_updated(int(user.id), USER_STATUS_REJECTED)
    # 通知中心落库：驳回结果通知当事用户（含 reason，若有；写失败不影响驳回结果）
    reject_payload: dict = {"status": USER_STATUS_REJECTED}
    if reject_in is not None and reject_in.reason:
        reject_payload["reason"] = reject_in.reason
    _safe_create_notification(
        db,
        user_id=int(user.id),
        type="user.status.updated",
        title="注册申请被拒绝",
        payload=reject_payload,
    )
    return _user_to_response(user, db)


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
    _ensure_can_manage(admin, user)
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


@router.get("/{user_id}/sessions", response_model=list[UserSessionResponse])
def list_user_sessions_endpoint(
    user_id: int,
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("user:read")),
):
    """列出指定用户的全部会话（含已吊销），按创建时间倒序。"""
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return get_user_sessions(db, user_id)


@router.post(
    "/{user_id}/sessions/{session_id}/revoke",
    response_model=UserSessionResponse,
)
def revoke_user_session_endpoint(
    user_id: int,
    session_id: int,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("user:write")),
):
    """吊销指定用户的单个会话（幂等：重复吊销仍返回 200）。

    定向推送 session.revoked（payload 带 sid，前端据此判断是否命中本设备）；
    不递增 token_version，该用户其它会话不受影响。审计 action=user.session_revoke。
    """
    user = get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    # 层级保护 — 不能吊销比自己权限更高的用户的会话
    _ensure_can_manage(admin, user)
    user_session = get_user_session_by_id(db, session_id)
    if user_session is None or user_session.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    revoked = revoke_single_user_session(db, user_session)
    log_action(
        db,
        request=request,
        user=admin,
        action="user.session_revoke",
        target_type="user",
        target_id=user_id,
        detail={
            "username": user.username,
            "session_id": session_id,
            "revoked_at": revoked.revoked_at.isoformat()
            if revoked.revoked_at
            else None,
        },
    )
    return revoked


def _user_to_response(
    user: User, db: Session, online_ids: set[int] | None = None
) -> dict:
    """将 User 模型转为 UserResponse 所需字典。

    online_ids 为批量查询得到的在线用户集合（列表场景传入，O(1) 判断）；
    未传入时对单个用户做一次在线判定查询（单用户响应场景）。
    """
    from app.crud.crud_role import get_user_permissions
    from app.crud.crud_session import is_user_online

    online: bool
    if online_ids is not None:
        online = user.id in online_ids
    else:
        online = is_user_online(db, int(user.id))

    return {
        "id": user.id,
        "username": user.username,
        "is_active": user.is_active,
        "status": user.status,
        "current_session_id": getattr(user, "current_session_id", None),
        "online": online,
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
        "roles": [role.name for role in user.roles],
        "permissions": sorted(get_user_permissions(db, user)),
        "direct_tool_permissions": get_user_direct_tool_permissions(db, user),
    }

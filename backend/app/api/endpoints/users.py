from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_user
from app.crud.crud_role import get_user_permissions
from app.crud.crud_session import get_user_sessions
from app.crud.crud_user import get_user_direct_tool_permissions
from app.models.user import User
from app.schemas.user import UserResponse
from app.schemas.user_session import UserSessionResponse

router = APIRouter()


@router.get("/me", response_model=UserResponse)
def read_users_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(deps.get_db),
):
    """返回当前用户信息，含角色、权限列表与当前会话标识。"""
    from app.crud.crud_session import is_user_online

    return {
        "id": current_user.id,
        "username": current_user.username,
        "is_active": current_user.is_active,
        "status": current_user.status,
        "current_session_id": current_user.current_session_id,
        # 能走到这里说明当前会话有效，在线判定恒为 True
        "online": is_user_online(db, int(current_user.id)),
        "created_at": current_user.created_at,
        "last_login_at": current_user.last_login_at,
        "roles": [role.name for role in current_user.roles],
        "permissions": sorted(get_user_permissions(db, current_user)),
        "direct_tool_permissions": get_user_direct_tool_permissions(db, current_user),
    }


@router.get("/me/sessions", response_model=list[UserSessionResponse])
def read_my_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(deps.get_db),
):
    """当前用户自己的会话列表（含已吊销），用于"当前设备"标识。"""
    return get_user_sessions(db, int(current_user.id))

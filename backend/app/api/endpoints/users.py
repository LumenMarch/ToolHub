from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_user
from app.crud.crud_role import get_user_permissions
from app.models.user import User
from app.schemas.user import UserResponse

router = APIRouter()


@router.get("/me", response_model=UserResponse)
def read_users_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(deps.get_db),
):
    """返回当前用户信息，含角色和权限列表。"""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at,
        "last_login_at": current_user.last_login_at,
        "roles": [role.name for role in current_user.roles],
        "permissions": sorted(get_user_permissions(db, current_user)),
    }

from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.core.security import _token_version_from_payload
from app.crud.crud_role import get_user_permissions
from app.crud.crud_user import get_user_by_username
from app.models.user import USER_STATUS_REJECTED, User

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/token",
    auto_error=False,
)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def get_current_user(
    db: Session = Depends(deps.get_db),
    bearer_token: str | None = Depends(oauth2_scheme),
    session_token: str | None = Cookie(
        default=None,
        alias=settings.AUTH_COOKIE_NAME,
    ),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = bearer_token or session_token
    if token is None:
        raise credentials_exception

    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_version = _token_version_from_payload(payload)
    except InvalidTokenError:
        raise credentials_exception

    user = get_user_by_username(db, username=username)
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise credentials_exception
    # 审批被驳回的用户即使持有 token 也一律拒绝访问
    # （reject 时已吊销会话，此处为纵深防御，覆盖未吊销的边角场景）
    if user.status == USER_STATUS_REJECTED:
        raise credentials_exception
    # Cookie 与 Bearer 均校验 token_version，吊销后旧会话立即 401
    if int(user.token_version or 0) != token_version:
        raise credentials_exception
    return user


class _PermissionChecker:
    """FastAPI Dependency: 校验当前用户是否持有指定权限。

    通过 Depends 注入后，FastAPI 会自动解析 __call__ 的依赖参数。
    """

    def __init__(self, required: str) -> None:
        self.required = required

    def __call__(
        self,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(deps.get_db),
    ) -> User:
        permissions = get_user_permissions(db, current_user)
        if self.required not in permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要 {self.required} 权限",
            )
        return current_user


def require_permission(permission: str) -> _PermissionChecker:
    """要求当前用户持有指定权限，否则返回 403。

    用法:
        @router.get("/admin/users")
        def list_users(
            db: Session = Depends(get_db),
            _: User = Depends(require_permission("user:read")),
        ):
            ...
    """
    return _PermissionChecker(permission)


class _ToolEnabledChecker:
    """FastAPI Dependency: 校验工具是否已被管理员启用。"""

    def __init__(self, tool_id: str) -> None:
        self.tool_id = tool_id

    def __call__(
        self,
        db: Session = Depends(deps.get_db),
    ) -> None:
        from app.crud.crud_tool_meta import is_tool_enabled

        if not is_tool_enabled(db, self.tool_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"工具 {self.tool_id} 已被禁用",
            )


def require_tool_enabled(tool_id: str) -> _ToolEnabledChecker:
    """要求指定工具当前处于启用状态，否则返回 403。

    用法:
        @router.post("/process")
        def process(
            _: None = Depends(require_tool_enabled("string_tools")),
        ):
            ...
    """
    return _ToolEnabledChecker(tool_id)

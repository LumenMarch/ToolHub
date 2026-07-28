from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.crud.crud_role import get_user_permissions
from app.crud.crud_user import get_user_by_username
from app.models.user import User

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
    except InvalidTokenError:
        raise credentials_exception

    user = get_user_by_username(db, username=username)
    if user is None:
        raise credentials_exception
    if not user.is_active:
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

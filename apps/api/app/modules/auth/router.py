from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.config import Settings, get_settings
from app.core.security import (
    authenticate,
    clear_session_cookie,
    create_session,
    require_user,
    set_session_cookie,
)
from app.modules.auth.schemas import LoginRequest, UserResponse

router = APIRouter(prefix="/api/auth", tags=["认证"])
ConfigDependency = Annotated[Settings, Depends(get_settings)]
UserDependency = Annotated[str, Depends(require_user)]


@router.post("/login", response_model=UserResponse)
def login(payload: LoginRequest, response: Response, config: ConfigDependency):
    if not authenticate(payload.username, payload.password, config):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    set_session_cookie(response, create_session(payload.username, config), config)
    return UserResponse(username=payload.username)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, config: ConfigDependency) -> None:
    clear_session_cookie(response, config)


@router.get("/me", response_model=UserResponse)
def current_user(username: UserDependency) -> UserResponse:
    return UserResponse(username=username)

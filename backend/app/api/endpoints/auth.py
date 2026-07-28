from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import create_access_token
from app.core.config import settings
from app.core.security import verify_password
from app.crud.crud_user import (
    count_users,
    create_user,
    get_user_by_username,
    update_last_login,
)
from app.schemas.user import Token, UserCreate, UserResponse
from app.services.audit import log_action

router = APIRouter()


def _authenticate_user(
    db: Session,
    form_data: OAuth2PasswordRequestForm,
):
    user = get_user_by_username(db, username=form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def _create_user_access_token(username: str) -> str:
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return create_access_token(
        data={"sub": username},
        expires_delta=access_token_expires,
    )


def _set_session_cookie(response: Response, access_token: str) -> None:
    response.set_cookie(
        key=settings.AUTH_COOKIE_NAME,
        value=access_token,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path=settings.API_V1_STR,
        secure=settings.AUTH_COOKIE_SECURE,
        httponly=True,
        samesite="strict",
    )


@router.post("/register", response_model=UserResponse)
def register_user(
    user_in: UserCreate,
    request: Request,
    db: Session = Depends(deps.get_db),
):
    """Register a new user. The first user automatically becomes admin."""
    user = get_user_by_username(db, username=user_in.username)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    # 首个注册的用户自动成为管理员。
    is_first_user = count_users(db) == 0
    user = create_user(db, user_in)
    if is_first_user:
        user.is_admin = True
        db.commit()
        db.refresh(user)
    return user


@router.post("/token", response_model=Token)
def login_for_access_token(
    request: Request,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """OAuth2 compatible token login, get an access token for future requests."""
    user = _authenticate_user(db, form_data)
    update_last_login(db, user)
    log_action(
        db,
        request=request,
        user=user,
        action="user.login",
        detail={"method": "token"},
    )
    access_token = _create_user_access_token(user.username)
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/session", response_model=UserResponse)
def login_for_session(
    response: Response,
    request: Request,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    user = _authenticate_user(db, form_data)
    update_last_login(db, user)
    log_action(
        db,
        request=request,
        user=user,
        action="user.login",
        detail={"method": "session"},
    )
    access_token = _create_user_access_token(user.username)
    _set_session_cookie(response, access_token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout_session(response: Response) -> None:
    # 前端发起登出时 cookie 即将失效，无法可靠关联用户，故不记录审计日志。
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        path=settings.API_V1_STR,
        secure=settings.AUTH_COOKIE_SECURE,
        httponly=True,
        samesite="strict",
    )

import secrets
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.config import Settings, get_settings

SESSION_COOKIE = "toolhub_session"
SESSION_SALT = "toolhub-auth"


def authenticate(username: str, password: str, settings: Settings) -> bool:
    return secrets.compare_digest(username, settings.username) and secrets.compare_digest(
        password, settings.password
    )


def create_session(username: str, settings: Settings) -> str:
    serializer = URLSafeTimedSerializer(settings.secret_key, salt=SESSION_SALT)
    return serializer.dumps({"username": username})


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=settings.session_max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def require_user(
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> str:
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    serializer = URLSafeTimedSerializer(settings.secret_key, salt=SESSION_SALT)
    try:
        payload = serializer.loads(session, max_age=settings.session_max_age)
    except (BadSignature, SignatureExpired) as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登录已过期，请重新登录",
        ) from error

    username = payload.get("username")
    if not isinstance(username, str) or not secrets.compare_digest(username, settings.username):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录状态无效")
    return username

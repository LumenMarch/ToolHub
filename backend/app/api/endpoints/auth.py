import uuid
from datetime import timedelta

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from jwt.exceptions import InvalidTokenError
from loguru import logger
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import create_access_token
from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.core.security import verify_password
from app.crud.crud_notification import create_notifications
from app.crud.crud_role import get_user_ids_with_permission
from app.crud.crud_session import (
    create_user_session,
    get_user_session_by_jti,
    revoke_user_session,
)
from app.crud.crud_user import create_user, get_user_by_username, update_last_login
from app.models.user import USER_STATUS_REJECTED
from app.schemas.user import Token, UserCreate, UserResponse
from app.services.audit import log_action
from app.services.realtime.sessions import notify_user_pending

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
    if user.status == USER_STATUS_REJECTED:
        # 与普通密码错误同样返回 401，但给出区分文案；
        # TTL 到期后用户名会被清理，届时可重新注册。
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "账号申请已被拒绝，用户名将在 "
                f"{settings.REGISTRATION_PENDING_TTL_DAYS} 天后释放，"
                "届时可重新注册"
            ),
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def _create_user_access_token(user, *, sid: str) -> str:
    """签发 access token，嵌入当前 token_version（tv）与会话 id（sid）。"""
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return create_access_token(
        data={
            "sub": user.username,
            "tv": int(user.token_version or 0),
            "sid": sid,
        },
        expires_delta=access_token_expires,
    )


def _register_login_session(db: Session, request: Request, user) -> str:
    """登录成功时登记会话记录，返回 jti（写入 token 的 sid 声明）。"""
    jti = uuid.uuid4().hex
    create_user_session(
        db,
        user_id=int(user.id),
        jti=jti,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return jti


def _revoke_current_session(request: Request, db: Session) -> None:
    """logout 辅助：尽力从 cookie/bearer 解析 JWT（不校验过期），
    存在 sid 则标记对应会话 revoked。

    解析失败或无 sid 均静默忽略——logout 的职责是清 cookie，
    不因解析失败影响登出行为。
    """
    token: str | None = None
    bearer = request.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        token = bearer.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get(settings.AUTH_COOKIE_NAME)
    if not token:
        return
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_exp": False},
        )
    except InvalidTokenError:
        return
    sid = payload.get("sid")
    if not sid:
        return
    user_session = get_user_session_by_jti(db, str(sid))
    if user_session is not None:
        revoke_user_session(db, user_session)


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


def _user_to_response(user, db: Session) -> dict:
    from app.crud.crud_role import get_user_permissions
    from app.crud.crud_session import is_user_online

    return {
        "id": user.id,
        "username": user.username,
        "is_active": user.is_active,
        "status": user.status,
        "current_session_id": getattr(user, "current_session_id", None),
        # 登录响应恒为 True（会话刚创建）；注册响应无会话恒为 False
        "online": is_user_online(db, int(user.id)),
        "created_at": user.created_at,
        "last_login_at": user.last_login_at,
        "roles": [role.name for role in user.roles],
        "permissions": sorted(get_user_permissions(db, user)),
    }


def _check_registration_domain(username: str) -> None:
    """域名白名单检查（注册无 email 字段，按 username 后缀匹配）。

    白名单为空表示不限制；非空时 username 必须以任一白名单项结尾
    （如 "@example.com"）。
    """
    allowed = settings.REGISTRATION_ALLOWED_DOMAINS
    if not allowed:
        return
    if not any(username.endswith(domain) for domain in allowed):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="用户名后缀不在注册白名单内，请联系管理员",
        )


@router.post(
    "/register",
    response_model=UserResponse,
    dependencies=[
        Depends(
            rate_limit(
                settings.REGISTRATION_RATE_LIMIT_PER_IP,
                settings.REGISTRATION_RATE_LIMIT_WINDOW,
            )
        )
    ],
)
def register_user(
    user_in: UserCreate,
    db: Session = Depends(deps.get_db),
):
    """注册新用户：创建后为 pending 待审批状态，不分配任何角色。

    - 不再有"首个用户自动超级管理员"逻辑，初始管理员由
      INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD 引导创建；
    - 不再默认分配"工具使用者"角色，审批通过时由管理员分配；
    - 限流按 IP（滑动窗口），白名单按 username 后缀匹配（见
      REGISTRATION_ALLOWED_DOMAINS）。
    """
    _check_registration_domain(user_in.username)
    user = get_user_by_username(db, username=user_in.username)
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )
    new_user = create_user(db, user_in)

    # 广播待审批事件，管理员端刷新待审批计数（hub 无角色过滤）
    notify_user_pending(int(new_user.id))
    # 通知中心落库：给所有持有 user:write 权限的用户写一条待审批通知。
    # 批量单次 commit（避免逐条 N 次事务），整体容错——
    # 通知失败不能破坏注册（用户已创建，返回 500 会造成孤儿 pending）。
    admin_ids = get_user_ids_with_permission(db, "user:write")
    if admin_ids:
        try:
            create_notifications(
                db,
                [
                    {
                        "user_id": uid,
                        "type": "user.pending",
                        "title": "新用户待审批",
                        "payload": {
                            "user_id": new_user.id,
                            "username": new_user.username,
                        },
                    }
                    for uid in admin_ids
                ],
            )
        except Exception:
            logger.exception("user.pending notification fan-out failed")

    return _user_to_response(new_user, db)


@router.post("/token", response_model=Token)
def login_for_access_token(
    request: Request,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """OAuth2 compatible token login, get an access token for future requests."""
    user = _authenticate_user(db, form_data)
    sid = _register_login_session(db, request, user)
    update_last_login(db, user)
    log_action(
        db,
        request=request,
        user=user,
        action="user.login",
        detail={"method": "token"},
    )
    access_token = _create_user_access_token(user, sid=sid)
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/session", response_model=UserResponse)
def login_for_session(
    response: Response,
    request: Request,
    db: Session = Depends(deps.get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    user = _authenticate_user(db, form_data)
    sid = _register_login_session(db, request, user)
    # 登录响应即携带当前会话标识，前端据此判断后续 session.revoked 是否命中本设备
    user._current_session_id = sid  # type: ignore[attr-defined]
    update_last_login(db, user)
    log_action(
        db,
        request=request,
        user=user,
        action="user.login",
        detail={"method": "session"},
    )
    access_token = _create_user_access_token(user, sid=sid)
    _set_session_cookie(response, access_token)
    return _user_to_response(user, db)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout_session(
    response: Response,
    request: Request,
    db: Session = Depends(deps.get_db),
) -> None:
    """退出登录：尽力吊销当前会话（解析 JWT 的 sid），再清 cookie。"""
    _revoke_current_session(request, db)
    response.delete_cookie(
        key=settings.AUTH_COOKIE_NAME,
        path=settings.API_V1_STR,
        secure=settings.AUTH_COOKIE_SECURE,
        httponly=True,
        samesite="strict",
    )

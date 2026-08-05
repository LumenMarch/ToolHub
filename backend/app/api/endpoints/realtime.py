"""实时通知 WebSocket 端点。

认证复用 HTTP 会话 Cookie ``toolhub_session``；校验失败时以 1008 关闭。
客户端消息仅处理可选 ping，其余忽略（WS 不做命令通道）。
"""

from __future__ import annotations

import json

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from jwt.exceptions import InvalidTokenError

from app.core.config import settings
from app.core.security import _token_version_from_payload
from app.crud.crud_user import get_user_by_username
from app.db.session import SessionLocal
from app.services.realtime.hub import realtime_hub

router = APIRouter()


def _resolve_user_id_from_cookie(
    websocket: WebSocket,
) -> tuple[int, str | None] | None:
    """从会话 Cookie 解析 (用户 id, 会话 jti)；无效则返回 None。

    校验与 HTTP get_current_user 一致：sub/tv 之外，若 token 带 sid 声明
    则要求对应 UserSession 存在且未吊销（单会话吊销不递增 token_version，
    必须查会话行才能堵住被吊销 token 的重连）；sid 缺失（旧 token）按
    tv 兜底放行。
    """
    token = websocket.cookies.get(settings.AUTH_COOKIE_NAME)
    if not token:
        return None

    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        username = payload.get("sub")
        if not username or not isinstance(username, str):
            return None
        token_version = _token_version_from_payload(payload)
        sid = payload.get("sid")
    except InvalidTokenError:
        return None

    db = SessionLocal()
    try:
        user = get_user_by_username(db, username=username)
        if user is None or not user.is_active:
            return None
        # 与 HTTP get_current_user 一致：tv 不匹配则拒绝握手
        if int(user.token_version or 0) != token_version:
            return None
        if sid is not None:
            from app.crud.crud_session import get_user_session_by_jti

            user_session = get_user_session_by_jti(db, str(sid))
            if user_session is None or user_session.revoked_at is not None:
                return None
        return int(user.id), str(sid) if sid is not None else None
    finally:
        db.close()


@router.websocket("/ws")
async def realtime_ws(websocket: WebSocket) -> None:
    """登录后单一实时通道：事件仅通知，客户端再 REST 拉取详情。"""
    resolved = _resolve_user_id_from_cookie(websocket)
    if resolved is None:
        # 未建立时也可 close；部分 ASGI 实现要求先 accept
        try:
            await websocket.accept()
        except Exception:
            return
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    user_id, sid = resolved

    await realtime_hub.connect(user_id, websocket, sid=sid)
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            text = message.get("text")
            if text == "ping":
                await websocket.send_text(
                    json.dumps({"type": "pong"}, separators=(",", ":"))
                )
            # 其它客户端消息忽略（WS 不做命令通道）
    except WebSocketDisconnect:
        pass
    finally:
        realtime_hub.disconnect(user_id, websocket)

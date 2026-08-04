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


def _resolve_user_id_from_cookie(websocket: WebSocket) -> int | None:
    """从会话 Cookie 解析当前用户 id；无效则返回 None。"""
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
        return int(user.id)
    finally:
        db.close()


@router.websocket("/ws")
async def realtime_ws(websocket: WebSocket) -> None:
    """登录后单一实时通道：事件仅通知，客户端再 REST 拉取详情。"""
    user_id = _resolve_user_id_from_cookie(websocket)
    if user_id is None:
        # 未建立时也可 close；部分 ASGI 实现要求先 accept
        try:
            await websocket.accept()
        except Exception:
            return
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await realtime_hub.connect(user_id, websocket)
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

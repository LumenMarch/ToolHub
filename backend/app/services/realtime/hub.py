"""进程内 WebSocket 连接注册表与 publish 抽象。

Phase-1 不做 Redis；job worker 跑在 ThreadPoolExecutor 中，
publish 必须通过 call_soon_threadsafe 安全切回主事件循环。
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from loguru import logger
from starlette.websockets import WebSocketState


class RealtimeHub:
    """user_id → WebSocket 集合；支持定向推送与全员广播。"""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = threading.RLock()
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """在应用 startup 时绑定主事件循环，供工作线程跨线程调度。"""
        self._loop = loop

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        """接受握手并登记连接。"""
        await websocket.accept()
        with self._lock:
            self._connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        """移除连接；用户无剩余连接时清理键。"""
        with self._lock:
            sockets = self._connections.get(user_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)

    def publish(
        self,
        event: dict[str, Any],
        *,
        user_id: int | None = None,
    ) -> None:
        """发布事件。

        - ``user_id`` 指定时仅推送给该用户的全部连接
        - ``user_id is None`` 时广播给所有已连接用户
        - 可从同步工作线程调用；无可用事件循环时静默丢弃
        """
        payload = dict(event)
        loop = self._resolve_loop()
        if loop is None:
            logger.debug(
                "realtime hub: 无事件循环，丢弃事件 type={}",
                payload.get("type"),
            )
            return

        def schedule() -> None:
            loop.create_task(self._dispatch(payload, user_id=user_id))

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None

        if running is loop:
            schedule()
        else:
            loop.call_soon_threadsafe(schedule)

    def _resolve_loop(self) -> asyncio.AbstractEventLoop | None:
        if self._loop is not None and self._loop.is_running():
            return self._loop
        try:
            return asyncio.get_running_loop()
        except RuntimeError:
            return None

    async def _dispatch(
        self,
        event: dict[str, Any],
        *,
        user_id: int | None,
    ) -> None:
        text = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            if user_id is None:
                targets = [
                    (uid, list(socks)) for uid, socks in self._connections.items()
                ]
            else:
                targets = [(user_id, list(self._connections.get(user_id, ())))]

        for uid, sockets in targets:
            dead: list[WebSocket] = []
            for websocket in sockets:
                try:
                    if websocket.client_state != WebSocketState.CONNECTED:
                        dead.append(websocket)
                        continue
                    await websocket.send_text(text)
                except Exception:
                    logger.debug(
                        "realtime hub: 发送失败 user_id={} type={}",
                        uid,
                        event.get("type"),
                    )
                    dead.append(websocket)
            for websocket in dead:
                self.disconnect(uid, websocket)


realtime_hub = RealtimeHub()

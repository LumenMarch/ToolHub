"""WebSocket 连接注册表与 publish 抽象。

默认进程内 fan-out；若配置了可用 Redis，则额外经 Pub/Sub 跨进程广播。
job worker 跑在 ThreadPoolExecutor 中，publish 必须通过
call_soon_threadsafe 安全切回主事件循环。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import threading
from collections import defaultdict
from typing import Any
from uuid import uuid4

from fastapi import WebSocket
from loguru import logger
from starlette.websockets import WebSocketState

# Redis 频道：仅承载 notify-only JSON 信封，事件契约与单机一致
REDIS_CHANNEL = "toolhub:realtime"


class RealtimeHub:
    """user_id → WebSocket 集合；支持定向推送、全员广播与可选 Redis 跨实例。"""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = threading.RLock()
        self._loop: asyncio.AbstractEventLoop | None = None
        # 本进程实例 id：Redis 回环时跳过已本地投递的消息
        self._instance_id = uuid4().hex
        self._redis: Any | None = None
        self._redis_pubsub: Any | None = None
        self._redis_task: asyncio.Task[None] | None = None
        self._redis_enabled = False

    def set_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """在应用 startup 时绑定主事件循环，供工作线程跨线程调度。"""
        self._loop = loop

    @property
    def redis_enabled(self) -> bool:
        """当前是否已启用 Redis 跨进程 fan-out。"""
        return self._redis_enabled

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
        - 始终先投递本进程连接；若 Redis 已启用，再 Pub/Sub 给其它实例
        - 可从同步工作线程调用；无可用事件循环时静默丢弃本地投递
        """
        payload = dict(event)
        self._publish_local(payload, user_id=user_id)
        if self._redis_enabled:
            self._publish_redis(payload, user_id=user_id)

    def _publish_local(
        self,
        event: dict[str, Any],
        *,
        user_id: int | None,
    ) -> None:
        """仅向本进程已登记的 WebSocket 投递。"""
        loop = self._resolve_loop()
        if loop is None:
            logger.debug(
                "realtime hub: 无事件循环，丢弃本地事件 type={}",
                event.get("type"),
            )
            return

        def schedule() -> None:
            loop.create_task(self._dispatch(event, user_id=user_id))

        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None

        if running is loop:
            schedule()
        else:
            loop.call_soon_threadsafe(schedule)

    def _publish_redis(
        self,
        event: dict[str, Any],
        *,
        user_id: int | None,
    ) -> None:
        """将事件信封发布到 Redis；失败只记日志，不影响本地投递。"""
        client = self._redis
        loop = self._resolve_loop()
        if client is None or loop is None:
            return

        envelope = {
            "origin": self._instance_id,
            "user_id": user_id,
            "event": event,
        }
        text = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))

        async def do_publish() -> None:
            try:
                await client.publish(REDIS_CHANNEL, text)
            except Exception:
                logger.warning(
                    "realtime hub: Redis publish 失败 type={}，仅本进程已投递",
                    event.get("type"),
                )

        def schedule() -> None:
            loop.create_task(do_publish())

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

    async def start_redis(self, url: str) -> None:
        """尝试启用 Redis Pub/Sub；失败则保持进程内 hub，不阻塞启动。"""
        if not url or not url.strip():
            return

        try:
            import redis.asyncio as redis_async
        except ImportError:
            logger.warning(
                "realtime hub: 已配置 REDIS_URL 但未安装 redis 包"
                "（pip/uv install 'backend[redis]'），回落进程内 hub"
            )
            return

        client: Any | None = None
        try:
            client = redis_async.from_url(
                url.strip(),
                decode_responses=True,
                socket_connect_timeout=2.0,
            )
            await asyncio.wait_for(client.ping(), timeout=2.0)
            pubsub = client.pubsub()
            await pubsub.subscribe(REDIS_CHANNEL)
        except Exception:
            logger.warning(
                "realtime hub: Redis 连接失败，回落进程内 hub",
                exc_info=True,
            )
            if client is not None:
                with contextlib.suppress(Exception):
                    await client.aclose()
            self._redis = None
            self._redis_pubsub = None
            self._redis_enabled = False
            return

        self._redis = client
        self._redis_pubsub = pubsub
        self._redis_enabled = True
        self._redis_task = asyncio.create_task(
            self._redis_subscriber(),
            name="realtime-redis-subscriber",
        )
        logger.info("realtime hub: 已启用 Redis Pub/Sub 跨实例 fan-out")

    async def _redis_subscriber(self) -> None:
        """订阅 Redis 频道，将来自其它实例的事件投递到本机连接。"""
        pubsub = self._redis_pubsub
        if pubsub is None:
            return
        try:
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True,
                    timeout=1.0,
                )
                if message is None:
                    await asyncio.sleep(0.01)
                    continue
                if message.get("type") != "message":
                    continue
                raw = message.get("data")
                if not isinstance(raw, str):
                    continue
                try:
                    envelope = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if envelope.get("origin") == self._instance_id:
                    # 本进程已在 publish 时本地投递，跳过回环
                    continue
                event = envelope.get("event")
                if not isinstance(event, dict):
                    continue
                target = envelope.get("user_id")
                user_id = int(target) if target is not None else None
                await self._dispatch(event, user_id=user_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("realtime hub: Redis 订阅循环异常，停用跨实例 fan-out")
            self._redis_enabled = False
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(REDIS_CHANNEL)
                await pubsub.aclose()

    async def stop_redis(self) -> None:
        """关闭 Redis 订阅与连接（应用 shutdown）。"""
        task = self._redis_task
        self._redis_task = None
        self._redis_enabled = False
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        pubsub = self._redis_pubsub
        self._redis_pubsub = None
        if pubsub is not None:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(REDIS_CHANNEL)
                await pubsub.aclose()
        client = self._redis
        self._redis = None
        if client is not None:
            with contextlib.suppress(Exception):
                await client.aclose()


realtime_hub = RealtimeHub()

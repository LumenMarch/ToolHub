"""按 IP 的滑动窗口限流：Redis 为主，内存降级。

服务器部署用 Redis 共享限流状态，保证多副本一致；Redis 不可用时退回
进程内状态并记录告警，避免登录/注册入口被基础设施故障整体拖死。
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from uuid import uuid4

import redis as redis_lib
from fastapi import HTTPException, Request, status
from loguru import logger

from app.core.config import settings


def _client_ip(request: Request) -> str:
    """取 TCP 对端地址（request.client.host）。

    不信任 X-Forwarded-For：内网直连部署下客户端可伪造该头绕过限流；
    多实例部署时应由网关注入真实对端，并在网关层再加一道限流。
    """
    return request.client.host if request.client else "unknown"


class _SlidingWindowLimiter:
    """按 IP 的进程内滑动窗口计数器，线程安全，惰性清理过期时间戳。"""

    # 内部状态超过该数量时做一次整体清理，防止长期运行内存膨胀
    _PRUNE_THRESHOLD = 4096

    def __init__(
        self,
        max_requests: int,
        window_seconds: float,
        detail: str = "注册请求过于频繁，请稍后再试",
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.detail = detail
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        # 上次整体清理的单调时钟；清理最多每窗口执行一次，避免每请求全量扫描
        self._last_prune = 0.0

    def __call__(self, request: Request) -> None:
        ip = _client_ip(request)
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            queue = self._hits[ip]
            while queue and queue[0] < cutoff:
                queue.popleft()
            if len(queue) >= self.max_requests:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=self.detail,
                )
            queue.append(now)
            if (
                len(self._hits) >= self._PRUNE_THRESHOLD
                and now - self._last_prune >= self.window_seconds
            ):
                self._prune(cutoff)
                self._last_prune = now

    def _prune(self, cutoff: float) -> None:
        """清理已无有效请求记录的 IP 条目，避免字典无限增长。"""
        stale = [
            ip for ip, queue in self._hits.items() if not queue or queue[-1] < cutoff
        ]
        for ip in stale:
            del self._hits[ip]

    def clear(self) -> None:
        """清空全部限流状态（测试用）。"""
        with self._lock:
            self._hits.clear()


class _RedisSlidingWindowLimiter:
    """Redis 有序集合滑动窗口；Redis 故障时降级到进程内限流。"""

    _LUA = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
    return 0
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return 1
"""

    def __init__(
        self,
        *,
        name: str,
        max_requests: int,
        window_seconds: float,
        detail: str,
    ) -> None:
        self.name = name
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.detail = detail
        self._fallback = _SlidingWindowLimiter(max_requests, window_seconds, detail)
        self._client = redis_lib.Redis.from_url(
            settings.REDIS_URL or "",
            socket_connect_timeout=1,
            socket_timeout=1,
            decode_responses=True,
        )
        self._script = self._client.register_script(self._LUA)
        self._redis_error_logged = False

    def __call__(self, request: Request) -> None:
        ip = _client_ip(request)
        now_ms = int(time.time() * 1000)
        window_ms = max(1, int(self.window_seconds * 1000))
        try:
            allowed = self._script(
                keys=[f"{settings.REALTIME_REDIS_CHANNEL}:ratelimit:{self.name}:{ip}"],
                args=[
                    now_ms,
                    window_ms,
                    self.max_requests,
                    f"{now_ms}:{uuid4().hex}",
                ],
            )
        except redis_lib.RedisError:
            if not self._redis_error_logged:
                logger.warning("限流 Redis 不可用，降级为进程内限流")
                self._redis_error_logged = True
            self._fallback(request)
            return
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=self.detail,
            )

    def clear(self) -> None:
        self._fallback.clear()


# 已创建的限流器实例注册表，供测试整体重置
_limiters: list[_SlidingWindowLimiter | _RedisSlidingWindowLimiter] = []


def rate_limit(
    max_requests: int,
    window_seconds: float,
    detail: str = "注册请求过于频繁，请稍后再试",
    *,
    name: str | None = None,
) -> _SlidingWindowLimiter | _RedisSlidingWindowLimiter:
    """构造 FastAPI 依赖：按 IP 对调用方限流，超限抛 429。

    用法:
        @router.post("/register")
        def register_user(
            _: None = Depends(rate_limit(10, 3600)),
            ...
        ):
    """
    limiter_name = name or f"{max_requests}:{int(window_seconds)}"
    if settings.REDIS_URL:
        limiter: _SlidingWindowLimiter | _RedisSlidingWindowLimiter = (
            _RedisSlidingWindowLimiter(
                name=limiter_name,
                max_requests=max_requests,
                window_seconds=window_seconds,
                detail=detail,
            )
        )
    else:
        limiter = _SlidingWindowLimiter(max_requests, window_seconds, detail)
    _limiters.append(limiter)
    return limiter


def reset_rate_limiters() -> None:
    """清空所有限流器状态（测试隔离用）。"""
    for limiter in _limiters:
        limiter.clear()

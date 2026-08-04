"""注册接口内存限流（单实例滑动窗口，按 IP）。

ToolHub 默认单进程部署，进程内限流即可满足要求，不引入外部限流库；
多实例部署时由部署层（Nginx/网关）统一限流。限流状态仅存内存，
进程重启后清零（可接受）。
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


def _client_ip(request: Request) -> str:
    """取 TCP 对端地址（request.client.host）。

    不信任 X-Forwarded-For：内网直连部署下客户端可伪造该头绕过限流；
    多实例部署时应由网关注入真实对端并在网关层统一限流。
    """
    return request.client.host if request.client else "unknown"


class _SlidingWindowLimiter:
    """按 IP 的滑动窗口计数器，线程安全，惰性清理过期时间戳。"""

    # 内部状态超过该数量时做一次整体清理，防止长期运行内存膨胀
    _PRUNE_THRESHOLD = 4096

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
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
                    detail="注册请求过于频繁，请稍后再试",
                )
            queue.append(now)
            if (
                len(self._hits) >= self._PRUNE_THRESHOLD
                and now - self._last_prune >= self.window_seconds
            ):
                self._prune(cutoff)
                self._last_prune = now

    def _prune(self, cutoff: float) -> None:
        """清理已无有效请求记录的 IP 条目，避免字典无限增长。

        删除条件：deque 为空，或全部时间戳均已过期
        （最新一条 < cutoff，时间戳按序排列故等价于整条过期）。
        被清理的 IP 再次请求时会重新建档，不影响限流正确性；
        未过期但已不活跃的条目保留至下一个清理周期。
        """
        stale = [
            ip for ip, queue in self._hits.items() if not queue or queue[-1] < cutoff
        ]
        for ip in stale:
            del self._hits[ip]

    def clear(self) -> None:
        """清空全部限流状态（测试用）。"""
        with self._lock:
            self._hits.clear()


# 已创建的限流器实例注册表，供测试整体重置
_limiters: list[_SlidingWindowLimiter] = []


def rate_limit(max_requests: int, window_seconds: float) -> _SlidingWindowLimiter:
    """构造 FastAPI 依赖：按 IP 对调用方限流，超限抛 429。

    用法:
        @router.post("/register")
        def register_user(
            _: None = Depends(rate_limit(10, 3600)),
            ...
        ):
    """
    limiter = _SlidingWindowLimiter(max_requests, window_seconds)
    _limiters.append(limiter)
    return limiter


def reset_rate_limiters() -> None:
    """清空所有限流器状态（测试隔离用）。"""
    for limiter in _limiters:
        limiter.clear()

"""后台任务队列：服务器用 RQ，测试用进程内执行器。"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Protocol

import redis as redis_lib
from loguru import logger
from rq import Queue

from app.core.config import settings


class JobQueue(Protocol):
    def enqueue(
        self,
        func: Callable[..., Any],
        *args: Any,
        queue: str | None = None,
    ) -> str | None: ...

    def shutdown(self) -> None: ...


class LocalJobQueue:
    """测试/单进程调试用：直接在当前进程的线程池执行。"""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(
            max_workers=max(settings.ASSET_COMPARISON_MAX_ACTIVE_JOBS, 1),
            thread_name_prefix="toolhub-job",
        )

    def enqueue(
        self,
        func: Callable[..., Any],
        *args: Any,
        queue: str | None = None,
    ) -> None:
        self._executor.submit(func, *args)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)


class RQJobQueue:
    """Redis + RQ：API 只入队，Worker 进程执行。"""

    def __init__(self) -> None:
        if not settings.REDIS_URL:
            raise RuntimeError("JOB_QUEUE_BACKEND=rq 时必须配置 REDIS_URL")
        self._redis = redis_lib.Redis.from_url(settings.REDIS_URL)
        self._queues: dict[str, Queue] = {}

    def _queue(self, name: str) -> Queue:
        queue = self._queues.get(name)
        if queue is None:
            queue = Queue(name=name, connection=self._redis)
            self._queues[name] = queue
        return queue

    def enqueue(
        self,
        func: Callable[..., Any],
        *args: Any,
        queue: str | None = None,
    ) -> str:
        target = self._queue(queue or settings.JOB_QUEUE_ANALYSIS)
        job = target.enqueue(
            func,
            *args,
            job_timeout=settings.JOB_TIMEOUT_SECONDS,
            result_ttl=settings.JOB_RESULT_TTL_SECONDS,
            failure_ttl=settings.JOB_FAILURE_TTL_SECONDS,
        )
        logger.info(
            "enqueued job {} queue={} func={}",
            job.id,
            target.name,
            getattr(func, "__qualname__", repr(func)),
        )
        return job.id

    def shutdown(self) -> None:
        self._redis.close()


_job_queue: JobQueue | None = None


def get_job_queue() -> JobQueue:
    global _job_queue
    if _job_queue is None:
        if settings.JOB_QUEUE_BACKEND == "local":
            _job_queue = LocalJobQueue()
        else:
            _job_queue = RQJobQueue()
    return _job_queue


def reset_job_queue() -> None:
    """测试隔离：关闭并丢弃当前队列实例。"""
    global _job_queue
    if _job_queue is not None:
        _job_queue.shutdown()
        _job_queue = None

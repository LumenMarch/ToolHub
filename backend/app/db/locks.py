"""PostgreSQL 会话级 advisory lock。

多副本 API 同时启动时，初始化管理员、恢复中断任务只应由一个进程执行。
锁随连接释放；调用方必须在同一连接生命周期内完成工作。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import text

from app.db.session import engine


@contextmanager
def advisory_lock(name: str) -> Iterator[bool]:
    """尝试获取命名锁；未获取时 yield False，调用方应直接跳过。"""
    with engine.connect() as connection:
        acquired = connection.execute(
            text("SELECT pg_try_advisory_lock(hashtext(:name))"),
            {"name": name},
        ).scalar()
        if not acquired:
            yield False
            return
        try:
            yield True
        finally:
            try:
                connection.execute(
                    text("SELECT pg_advisory_unlock(hashtext(:name))"),
                    {"name": name},
                )
            except Exception:
                # 连接已断开时锁随会话释放；不要用解锁失败覆盖原始异常。
                pass

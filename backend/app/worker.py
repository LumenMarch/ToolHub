"""RQ Worker 入口。

API 只负责入队；本进程执行 CPU/IO 密集的分析与导出任务。
部署时与 API 使用同一镜像，命令不同：
    python -m app.worker --queues analysis,export,maintenance
"""

from __future__ import annotations

import argparse
import os
import sys

import redis as redis_lib
from rq import Queue, Worker

from app.core.config import settings

# RQ 每个任务都 fork 一个 work-horse。macOS 上父进程若有多线程正在初始化
# Objective-C 运行时，fork 出的子进程会直接 abort（signal 6），任务全部失败。
# libobjc 在进程启动时读一次该变量，进程内再改 os.environ 无效，所以必须
# 原样重新 exec 自身，让新进程带着变量启动。生产（Linux）不走这条路径。
_FORK_SAFETY_ENV = "OBJC_DISABLE_INITIALIZE_FORK_SAFETY"


def _ensure_fork_safety() -> None:
    if sys.platform != "darwin" or os.environ.get(_FORK_SAFETY_ENV):
        return
    env = {**os.environ, _FORK_SAFETY_ENV: "YES"}
    os.execve(sys.executable, [sys.executable, "-m", "app.worker", *sys.argv[1:]], env)


def main() -> None:
    parser = argparse.ArgumentParser(description="ToolHub RQ worker")
    parser.add_argument(
        "--queues",
        default=f"{settings.JOB_QUEUE_ANALYSIS},{settings.JOB_QUEUE_EXPORT},"
        f"{settings.JOB_QUEUE_MAINTENANCE}",
        help="逗号分隔的队列名，按优先级从左到右",
    )
    parser.add_argument(
        "--burst",
        action="store_true",
        help="处理完当前队列后退出（测试/一次性任务用）",
    )
    args = parser.parse_args()

    if not settings.REDIS_URL:
        raise SystemExit("REDIS_URL 未配置，RQ Worker 无法启动")

    connection = redis_lib.Redis.from_url(settings.REDIS_URL)
    queues = [
        Queue(name=name.strip(), connection=connection)
        for name in args.queues.split(",")
        if name.strip()
    ]
    if not queues:
        raise SystemExit("至少需要配置一个队列")

    worker = Worker(queues, connection=connection)
    worker.work(burst=args.burst)


if __name__ == "__main__":
    _ensure_fork_safety()
    main()

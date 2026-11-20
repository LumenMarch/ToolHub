"""ToolHub 服务启动入口。

本地开发可直接 `python -m app`；服务器部署使用 uvicorn 命令以支持多副本。
API 与 Worker 是独立进程，Worker 入口见 `app.worker`。

用法：
    python -m app                                   # 默认 0.0.0.0:8000
    python -m app --host 127.0.0.1 --port 8015      # 覆盖监听地址 / 端口
"""

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="ToolHub 服务启动入口")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    args = parser.parse_args()

    # 本入口只启动一个 API 进程；多副本部署请使用 uvicorn --workers
    # 或容器编排，后台任务由独立 RQ Worker 执行。
    uvicorn.run("app.main:app", host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()

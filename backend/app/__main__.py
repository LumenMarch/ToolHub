"""ToolHub 服务默认启动入口。

pex / scie 二进制通过 `-m app` 执行本模块，裸跑即可启动服务（无需再传
`app.main:app` 参数）；在 backend 目录下 `python -m app` 同样可用（dev 模式）。

用法：
    ./dist/toolhub                                  # 默认 0.0.0.0:8000
    ./dist/toolhub --host 127.0.0.1 --port 8015     # 覆盖监听地址 / 端口
"""

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="ToolHub 服务启动入口")
    parser.add_argument("--host", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    args = parser.parse_args()

    # 单 worker：资产比对任务运行器按单个 uvicorn worker 设计（见 backend/README.md），
    # 内部使用有界执行器做比对工作，单 worker 不会把比对任务限制在一个 CPU 核上。
    uvicorn.run("app.main:app", host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()

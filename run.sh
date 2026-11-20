#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building frontend..."
cd "$ROOT_DIR/frontend"
bun run build

cd "$ROOT_DIR/backend"
echo "Applying database migrations..."
uv run alembic upgrade head
uv run python -m app.bootstrap

# 本机 HTTP 开发需关闭 Secure cookie（生产部署应保持默认 True）。
# 数据库、Redis 与队列配置来自仓库根 .env。
export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-false}"
# 前端构建产物由后端在 / 上托管，不再单独启动 Vite。
exec uv run uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

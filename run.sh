#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building frontend..."
cd "$ROOT_DIR/frontend"
bun run build

echo "Starting backend..."
cd "$ROOT_DIR/backend"
# 本机 HTTP 开发需关闭 Secure cookie（生产部署应保持默认 True）。
# SECRET_KEY 未配置时由 config 自动生成并持久化到仓库根 .env。
export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-false}"
# 前端构建产物由后端在 / 上托管，不再单独启动 Vite。
exec uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

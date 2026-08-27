#!/usr/bin/env bash
# OCR 图片（Vision 引擎）封装脚本
# 用法: ./scripts/ocr.sh <图片路径> [语言 zh-Hans|en-US]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SWIFT="$HERE/ocr-image.swift"
CACHE="${OCR_CACHE:-/tmp/mcache}"
mkdir -p "$CACHE"

# 独立临时目录放置编译产物：并发调用或共享 TMPDIR 的 worktree 不会互相覆盖
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/ocr-image-bin"
swiftc -module-cache-path "$CACHE" -O "$SWIFT" -o "$BIN"
"$BIN" "$@"

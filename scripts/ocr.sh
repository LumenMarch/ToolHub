#!/usr/bin/env bash
# OCR 图片（Vision 引擎）封装脚本
# 用法: ./scripts/ocr.sh <图片路径> [语言 zh-Hans|en-US]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SWIFT="$HERE/ocr-image.swift"
CACHE="${OCR_CACHE:-/tmp/mcache}"
mkdir -p "$CACHE"

BIN="${TMPDIR:-/tmp}/ocr-image-bin"
swiftc -module-cache-path "$CACHE" -O "$SWIFT" -o "$BIN"
"$BIN" "$@"

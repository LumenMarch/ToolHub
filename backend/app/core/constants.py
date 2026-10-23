"""跨模块共享的硬性限制常量。"""

from __future__ import annotations

# tus 单文件上传上限（1 GiB）。上传能力声明、请求校验与缓存解析共用此值。
MAX_UPLOAD_BYTES = 1024 * 1024 * 1024

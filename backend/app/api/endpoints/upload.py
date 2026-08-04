"""tus 协议文件上传端点。

tus v1.0.0 — IETF 断点续传上传协议。
参考: https://tus.io/protocols/resumable-upload.html

路由前缀由 api_router 设置为 /upload，即 /api/v1/upload/...
"""

import base64

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.core.auth import require_permission
from app.models.user import User
from app.services.task_artifacts import ContentDigest
from app.services.upload.store import (
    UploadChecksumMismatchError,
    UploadLengthExceededError,
    UploadNotFoundError,
    UploadOffsetMismatchError,
    UploadStore,
    UploadWriteConflictError,
)

router = APIRouter()
store = UploadStore()

# 256 MB：atlas-merge 周批数据包（unit-archive zip）实测可达约 58MB，
# 默认 100MB 偏紧，留出余量避免接近上限时上传失败。
# 该值同时用于 Tus-Max-Size 能力声明与缓存解析的大小上限。
MAX_SIZE = 256 * 1024 * 1024  # 256 MB


class UploadCacheResolveRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_type: str = Field(
        default="application/octet-stream",
        max_length=255,
    )
    size: int = Field(..., gt=0, le=MAX_SIZE)
    md5: str = Field(..., pattern=r"^[A-Fa-f0-9]{32}$")
    sha256: str = Field(..., pattern=r"^[A-Fa-f0-9]{64}$")


# ------------------------------------------------------------------ helpers


def _parse_metadata(raw: str | None) -> dict[str, str]:
    """解析 tus Upload-Metadata 头。

    格式: "key1 base64value1,key2 base64value2"
    返回: {"key1": "decoded_value1", ...}
    """
    if not raw:
        return {}
    result: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair:
            continue
        parts = pair.split(" ", 1)
        if len(parts) != 2:
            continue
        key, b64val = parts[0].strip(), parts[1].strip()
        try:
            result[key] = base64.b64decode(b64val).decode("utf-8", errors="replace")
        except Exception:
            result[key] = ""
    return result


def _check_ownership(info: dict, current_user: User) -> None:
    """校验当前用户是上传的创建者。"""
    owner_id = info.get("user_id")
    if owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权访问此上传")


# ------------------------------------------------------------ tus 标准端点


@router.options("/tus")
async def tus_options() -> Response:
    """tus 能力发现端点。"""
    headers = {
        "Tus-Version": "1.0.0",
        "Tus-Extension": "creation,termination",
        "Tus-Max-Size": str(MAX_SIZE),
        "Access-Control-Allow-Headers": (
            "Tus-Resumable, Upload-Length, Upload-Metadata, "
            "Upload-Offset, Content-Type, Authorization"
        ),
        "Access-Control-Allow-Methods": "POST, PATCH, HEAD, DELETE, OPTIONS",
        "Access-Control-Max-Age": "86400",
    }
    return Response(status_code=204, headers=headers)


@router.post("/tus")
async def tus_create(
    request: Request,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    """创建 tus 上传（creation 扩展）。

    要求请求头:
      - Upload-Length: 总字节数（必填，>0 且 ≤ max_size）
      - Upload-Metadata: 可选 base64 编码的键值对
    """
    upload_length_raw = request.headers.get("Upload-Length")
    if not upload_length_raw:
        raise HTTPException(
            status_code=400,
            detail="缺少 Upload-Length 头",
        )

    try:
        upload_length = int(upload_length_raw)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Upload-Length 必须是数值",
        ) from None

    if upload_length <= 0:
        raise HTTPException(
            status_code=400,
            detail="Upload-Length 必须大于 0",
        )

    if upload_length > MAX_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"文件大小超过限制 ({MAX_SIZE} 字节)",
        )

    metadata_raw = request.headers.get("Upload-Metadata", "")
    parsed = _parse_metadata(metadata_raw)

    meta = {}
    filename = parsed.get("filename", "")
    if filename:
        meta["filename"] = filename
    content_type = parsed.get("content_type", "")
    if content_type:
        meta["content_type"] = content_type
    md5 = parsed.get("md5", "")
    sha256 = parsed.get("sha256", "")
    if md5 or sha256:
        try:
            digest = ContentDigest(md5=md5, sha256=sha256, size=upload_length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        meta["md5"] = digest.md5
        meta["sha256"] = digest.sha256
    meta["user_id"] = current_user.id

    upload_id = store.create(upload_length, metadata=meta)

    headers = {
        "Location": f"/api/v1/upload/tus/{upload_id}",
        "Tus-Resumable": "1.0.0",
    }
    return Response(status_code=201, headers=headers)


@router.head("/tus/{upload_id}")
async def tus_head(
    upload_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    """查询上传进度。"""
    try:
        offset = store.get_offset(upload_id)
        info = store.get_info(upload_id)
        _check_ownership(info, current_user)
    except UploadNotFoundError:
        raise HTTPException(status_code=404, detail="上传不存在") from None

    headers = {
        "Upload-Offset": str(offset),
        "Upload-Length": str(info["upload_length"]),
        "Tus-Resumable": "1.0.0",
        "Cache-Control": "no-store",
    }
    if info["completed"]:
        headers["Upload-Complete"] = "true"

    return Response(status_code=200, headers=headers)


@router.patch("/tus/{upload_id}")
async def tus_patch(
    upload_id: str,
    request: Request,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    """写入上传分片。

    要求请求头:
      - Upload-Offset: 当前分片的起始偏移量
      - Content-Type: application/offset+octet-stream
    """
    # 校验 Content-Type
    content_type = request.headers.get("Content-Type", "")
    if content_type != "application/offset+octet-stream":
        raise HTTPException(
            status_code=415,
            detail="需要 Content-Type: application/offset+octet-stream",
        )

    offset_raw = request.headers.get("Upload-Offset")
    if offset_raw is None:
        raise HTTPException(
            status_code=400,
            detail="缺少 Upload-Offset 头",
        )

    try:
        offset = int(offset_raw)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Upload-Offset 必须是数值",
        ) from None

    try:
        info = store.get_info(upload_id)
        _check_ownership(info, current_user)
    except UploadNotFoundError:
        raise HTTPException(status_code=404, detail="上传不存在") from None

    # 检查是否已完成
    if info["completed"]:
        raise HTTPException(
            status_code=409,
            detail="上传已完成，不可继续写入",
        )

    try:
        new_offset = await store.write_stream(upload_id, offset, request.stream())
    except (UploadOffsetMismatchError, UploadWriteConflictError) as e:
        raise HTTPException(status_code=409, detail=str(e)) from None
    except UploadLengthExceededError:
        raise HTTPException(
            status_code=413,
            detail="写入超出 Upload-Length",
        ) from None
    except UploadChecksumMismatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    headers = {
        "Upload-Offset": str(new_offset),
        "Tus-Resumable": "1.0.0",
    }
    return Response(status_code=204, headers=headers)


@router.delete("/tus/{upload_id}")
async def tus_delete(
    upload_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> Response:
    """取消上传（termination 扩展）。"""
    try:
        info = store.get_info(upload_id)
    except UploadNotFoundError:
        raise HTTPException(status_code=404, detail="上传不存在") from None
    _check_ownership(info, current_user)
    store.delete(upload_id)
    headers = {"Tus-Resumable": "1.0.0"}
    return Response(status_code=204, headers=headers)


# ------------------------------------------------------------ 便利端点


@router.post("/cache/resolve")
async def resolve_upload_cache(
    req: UploadCacheResolveRequest,
    current_user: User = Depends(require_permission("tool:use")),
) -> dict:
    """用用户级内容摘要解析缓存，命中时返回新的上传句柄。"""
    digest = ContentDigest(md5=req.md5, sha256=req.sha256, size=req.size)
    blob = store.find_cached_blob(user_id=current_user.id, digest=digest)
    if blob is None:
        return {"cache_hit": False, "upload_id": None}

    try:
        upload_id = store.create_cached_reference(
            user_id=current_user.id,
            filename=req.filename,
            content_type=req.content_type,
            blob=blob,
        )
    except UploadNotFoundError:
        return {"cache_hit": False, "upload_id": None}
    return {
        "cache_hit": True,
        "upload_id": upload_id,
        "md5": digest.md5,
        "sha256": digest.sha256,
        "size": digest.size,
    }


@router.get("/{upload_id}/info")
async def get_upload_info(
    upload_id: str,
    current_user: User = Depends(require_permission("tool:use")),
) -> dict:
    """获取上传信息（非 tus 便利端点）。"""
    try:
        info = store.get_info(upload_id)
        _check_ownership(info, current_user)
        return info
    except UploadNotFoundError:
        raise HTTPException(status_code=404, detail="上传不存在") from None

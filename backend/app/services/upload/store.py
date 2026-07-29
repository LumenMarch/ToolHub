"""tus 协议上传的本地文件存储。

每个上传在磁盘上对应两个文件：
  - {root}/{upload_id}       纯二进制数据
  - {root}/{upload_id}.meta  JSON 元数据
"""

import fcntl
import json
import os
import tempfile
import time
import uuid
from pathlib import Path

UPLOAD_ROOT = Path(tempfile.gettempdir()) / "toolhub-uploads"


class UploadNotFoundError(Exception):
    """未找到指定的上传资源。"""

    pass


class UploadNotCompleteError(Exception):
    """上传尚未完成，不能读取。"""

    pass


class UploadStore:
    """tus 上传的本地文件存储。"""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or UPLOAD_ROOT
        self.root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ helpers

    def _data_path(self, upload_id: str) -> Path:
        return self.root / upload_id

    def _meta_path(self, upload_id: str) -> Path:
        return self.root / f"{upload_id}.meta"

    def _read_meta(self, upload_id: str) -> dict:
        path = self._meta_path(upload_id)
        if not path.exists():
            raise UploadNotFoundError(f"上传不存在: {upload_id}")
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def _write_meta(self, upload_id: str, meta: dict) -> None:
        with open(self._meta_path(upload_id), "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False)

    def _lock_file(self, fp) -> None:
        """获取 POSIX 排他锁（写锁）。"""
        try:
            Lockable = getattr(fp, "buffer", None) or fp  # noqa: B009
            fcntl.flock(Lockable, fcntl.LOCK_EX)
        except OSError:
            # 部分平台不支持 flock，退化为无锁（风险可接受）
            pass

    def _unlock_file(self, fp) -> None:
        try:
            Lockable = getattr(fp, "buffer", None) or fp  # noqa: B009
            fcntl.flock(Lockable, fcntl.LOCK_UN)
        except OSError:
            pass

    # --------------------------------------------------------------- public API

    def create(self, upload_length: int, metadata: dict | None = None) -> str:
        """创建新上传。返回 upload_id（uuid hex，32 字符）。"""
        metadata = metadata or {}
        upload_id = uuid.uuid4().hex

        meta = {
            "upload_length": upload_length,
            "filename": metadata.get("filename", ""),
            "content_type": metadata.get("content_type", "application/octet-stream"),
            "created_at": time.time(),
            "user_id": metadata.get("user_id"),
            "completed": False,
        }

        self._write_meta(upload_id, meta)
        # 创建空数据文件
        self._data_path(upload_id).touch()
        return upload_id

    def write_chunk(self, upload_id: str, offset: int, data: bytes) -> int:
        """在指定 offset 写入数据分片。校验 offset 必须等于当前文件大小。返回新 offset。"""
        meta = self._read_meta(upload_id)
        upload_length = meta["upload_length"]

        data_path = self._data_path(upload_id)
        current_size = data_path.stat().st_size

        if offset != current_size:
            raise ValueError(f"Offset 不匹配: 期望 {current_size}，收到 {offset}")

        if offset + len(data) > upload_length:
            raise ValueError(
                f"写入超出 upload_length: "
                f"offset={offset} + {len(data)} > {upload_length}"
            )

        with open(data_path, "ab") as f:
            self._lock_file(f)
            try:
                # 加锁后再次确认 offset（防止竞态）
                f.seek(0, os.SEEK_END)
                pos = f.tell()
                if pos != offset:
                    raise ValueError(
                        f"并发冲突: 文件已增长到 {pos}，请求 offset={offset}"
                    )
                f.write(data)
                new_offset = f.tell()
            finally:
                self._unlock_file(f)

        # 检查是否完成
        if new_offset >= upload_length:
            meta["completed"] = True
            self._write_meta(upload_id, meta)

        return new_offset

    def get_offset(self, upload_id: str) -> int:
        """返回已上传字节数。"""
        # 确保 meta 存在
        self._read_meta(upload_id)
        return self._data_path(upload_id).stat().st_size

    def get_info(self, upload_id: str) -> dict:
        """返回上传信息。"""
        meta = self._read_meta(upload_id)
        data_path = self._data_path(upload_id)
        size = data_path.stat().st_size
        return {
            "upload_id": upload_id,
            "filename": meta.get("filename", ""),
            "size": size,
            "upload_length": meta["upload_length"],
            "content_type": meta.get("content_type", "application/octet-stream"),
            "file_path": str(data_path),
            "completed": meta.get("completed", False),
            "created_at": meta.get("created_at"),
        }

    def read_bytes(self, upload_id: str) -> bytes:
        """读取完整文件内容。仅 completed 时可读。"""
        meta = self._read_meta(upload_id)
        if not meta.get("completed"):
            raise UploadNotCompleteError(f"上传尚未完成: {upload_id}")
        return self._data_path(upload_id).read_bytes()

    def get_file_path(self, upload_id: str) -> Path:
        """返回数据文件路径。"""
        # 确保 meta 存在
        self._read_meta(upload_id)
        return self._data_path(upload_id)

    def delete(self, upload_id: str) -> None:
        """删除上传文件及元数据。不存在则静默忽略。"""
        data_path = self._data_path(upload_id)
        meta_path = self._meta_path(upload_id)
        try:
            data_path.unlink(missing_ok=True)
            meta_path.unlink(missing_ok=True)
        except OSError:
            pass

    def cleanup_expired(self, max_age_hours: int = 24) -> None:
        """删除超过 max_age_hours 的未完成上传。"""
        cutoff = time.time() - max_age_hours * 3600
        for meta_path in self.root.glob("*.meta"):
            try:
                with open(meta_path, encoding="utf-8") as f:
                    meta = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            if meta.get("completed"):
                continue
            if meta.get("created_at", 0) >= cutoff:
                continue

            upload_id = meta_path.stem  # 去掉 .meta 后缀
            self.delete(upload_id)

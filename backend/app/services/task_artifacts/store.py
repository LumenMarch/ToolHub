from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import settings

SAFE_SEGMENT_PATTERN = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$")
MD5_PATTERN = re.compile(r"^[a-f0-9]{32}$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")


class TaskArtifactNotFoundError(LookupError):
    """任务产物不存在。"""


@dataclass(frozen=True)
class ContentDigest:
    md5: str
    sha256: str
    size: int

    def __post_init__(self) -> None:
        normalized_md5 = self.md5.lower()
        normalized_sha256 = self.sha256.lower()
        if not MD5_PATTERN.fullmatch(normalized_md5):
            raise ValueError("MD5 必须是 32 位十六进制字符串")
        if not SHA256_PATTERN.fullmatch(normalized_sha256):
            raise ValueError("SHA-256 必须是 64 位十六进制字符串")
        if self.size <= 0:
            raise ValueError("文件大小必须大于 0")
        object.__setattr__(self, "md5", normalized_md5)
        object.__setattr__(self, "sha256", normalized_sha256)


@dataclass(frozen=True)
class CachedBlob:
    user_id: int
    digest: ContentDigest
    path: Path


class TaskArtifactStore:
    """统一管理用户级内容缓存和工具任务产物。"""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(settings.TASK_ARTIFACT_ROOT)
        self.upload_root = self.root / "uploads"
        self.user_root = self.root / "users"
        self.upload_root.mkdir(parents=True, exist_ok=True)
        self.user_root.mkdir(parents=True, exist_ok=True)

    def task_dir(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
    ) -> Path:
        safe_tool = self._safe_segment(tool, "tool")
        safe_task_id = self._safe_segment(task_id, "task_id")
        return (
            self.user_root
            / str(self._safe_user_id(user_id))
            / "tasks"
            / safe_tool
            / safe_task_id
        )

    def ensure_task(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
        expires_at: float,
        metadata: dict[str, Any] | None = None,
    ) -> Path:
        task_dir = self.task_dir(user_id=user_id, tool=tool, task_id=task_id)
        task_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = task_dir / "manifest.json"
        now = time.time()
        current = self._read_json(manifest_path, fallback={})
        current_metadata = current.get("metadata", {})
        manifest = {
            "version": 1,
            "user_id": user_id,
            "tool": tool,
            "task_id": task_id,
            "created_at": current.get("created_at", now),
            "updated_at": now,
            "expires_at": expires_at,
            "metadata": {**current_metadata, **(metadata or {})},
        }
        self._write_json_atomic(manifest_path, manifest)
        return task_dir

    def read_task_manifest(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
    ) -> dict[str, Any]:
        manifest_path = (
            self.task_dir(user_id=user_id, tool=tool, task_id=task_id) / "manifest.json"
        )
        if not manifest_path.is_file():
            raise TaskArtifactNotFoundError
        return self._read_json(manifest_path)

    def resolve_task_path(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
        relative_path: str,
    ) -> Path:
        task_dir = self.task_dir(
            user_id=user_id,
            tool=tool,
            task_id=task_id,
        ).resolve()
        path = (task_dir / relative_path).resolve()
        if task_dir not in path.parents:
            raise ValueError("任务产物路径超出任务目录")
        return path

    def write_artifact(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
        relative_path: str,
        content: bytes,
    ) -> Path:
        path = self.resolve_task_path(
            user_id=user_id,
            tool=tool,
            task_id=task_id,
            relative_path=relative_path,
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary_path.write_bytes(content)
        os.replace(temporary_path, path)
        return path

    def materialize_input(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
        filename: str,
        source_path: Path,
    ) -> Path:
        """将缓存文件映射到任务输入目录，同文件系统优先使用硬链接。"""
        safe_filename = Path(filename).name
        if not safe_filename:
            raise ValueError("任务输入文件名不能为空")
        destination = self.resolve_task_path(
            user_id=user_id,
            tool=tool,
            task_id=task_id,
            relative_path=f"inputs/{safe_filename}",
        )
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.unlink(missing_ok=True)
        try:
            os.link(source_path, destination)
        except OSError:
            shutil.copy2(source_path, destination)
        return destination

    def delete_task(
        self,
        *,
        user_id: int,
        tool: str,
        task_id: str,
        ignore_errors: bool = True,
    ) -> None:
        task_dir = self.task_dir(user_id=user_id, tool=tool, task_id=task_id)
        shutil.rmtree(task_dir, ignore_errors=ignore_errors)

    def task_size(self, *, user_id: int, tool: str, task_id: str) -> int:
        task_dir = self.task_dir(user_id=user_id, tool=tool, task_id=task_id)
        return sum(
            path.stat().st_size for path in task_dir.rglob("*") if path.is_file()
        )

    def find_blob(self, *, user_id: int, digest: ContentDigest) -> CachedBlob | None:
        path = self._blob_path(user_id, digest.sha256)
        metadata_path = self._blob_metadata_path(user_id, digest.sha256)
        if not path.is_file() or not metadata_path.is_file():
            return None
        metadata = self._read_json(metadata_path, fallback={})
        if (
            metadata.get("md5") != digest.md5
            or metadata.get("sha256") != digest.sha256
            or metadata.get("size") != digest.size
            or path.stat().st_size != digest.size
        ):
            return None
        metadata["last_accessed_at"] = time.time()
        self._write_json_atomic(metadata_path, metadata)
        return CachedBlob(user_id=user_id, digest=digest, path=path)

    def publish_blob(
        self,
        *,
        user_id: int,
        source_path: Path,
        digest: ContentDigest,
    ) -> CachedBlob:
        path = self._blob_path(user_id, digest.sha256)
        metadata_path = self._blob_metadata_path(user_id, digest.sha256)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file():
            if path.stat().st_size != digest.size:
                raise ValueError("缓存文件大小与摘要记录不一致")
            source_path.unlink(missing_ok=True)
        else:
            os.replace(source_path, path)

        now = time.time()
        current = self._read_json(metadata_path, fallback={})
        self._write_json_atomic(
            metadata_path,
            {
                "version": 1,
                "user_id": user_id,
                "md5": digest.md5,
                "sha256": digest.sha256,
                "size": digest.size,
                "created_at": current.get("created_at", now),
                "last_accessed_at": now,
            },
        )
        return CachedBlob(user_id=user_id, digest=digest, path=path)

    def cleanup_expired_blobs(self, *, max_age_hours: int) -> None:
        cutoff = time.time() - max_age_hours * 3600
        for metadata_path in self.user_root.glob("*/blobs/*/*.json"):
            metadata = self._read_json(metadata_path, fallback={})
            if metadata.get("last_accessed_at", 0) >= cutoff:
                continue
            blob_path = metadata_path.with_suffix("")
            blob_path.unlink(missing_ok=True)
            metadata_path.unlink(missing_ok=True)

    def cleanup_expired_tasks(self) -> None:
        now = time.time()
        for manifest_path in self.user_root.glob("*/tasks/*/*/manifest.json"):
            manifest = self._read_json(manifest_path, fallback={})
            if manifest.get("expires_at", 0) > now:
                continue
            shutil.rmtree(manifest_path.parent, ignore_errors=True)

    def _blob_path(self, user_id: int, sha256: str) -> Path:
        if not SHA256_PATTERN.fullmatch(sha256):
            raise ValueError("SHA-256 必须是 64 位十六进制字符串")
        return (
            self.user_root
            / str(self._safe_user_id(user_id))
            / "blobs"
            / sha256[:2]
            / sha256
        )

    def _blob_metadata_path(self, user_id: int, sha256: str) -> Path:
        return self._blob_path(user_id, sha256).with_suffix(".json")

    @staticmethod
    def _safe_user_id(user_id: int) -> int:
        if user_id <= 0:
            raise ValueError("user_id 必须大于 0")
        return user_id

    @staticmethod
    def _safe_segment(value: str, field: str) -> str:
        if not SAFE_SEGMENT_PATTERN.fullmatch(value):
            raise ValueError(f"{field} 包含不支持的字符")
        return value

    @staticmethod
    def _read_json(path: Path, fallback: Any = None) -> Any:
        try:
            with path.open(encoding="utf-8") as file:
                return json.load(file)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            if fallback is not None:
                return fallback
            raise TaskArtifactNotFoundError from None

    @staticmethod
    def _write_json_atomic(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            json.dump(value, temporary_file, ensure_ascii=False, separators=(",", ":"))
            temporary_path = Path(temporary_file.name)
        os.replace(temporary_path, path)


task_artifact_store = TaskArtifactStore()

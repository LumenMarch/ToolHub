from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.services.task_artifacts import (
    TaskArtifactNotFoundError,
    TaskArtifactStore,
    task_artifact_store,
)

TASK_TOOL = "attendance"
RESULT_PATH = "artifacts/result.xlsx"


class AttendanceResultNotFoundError(LookupError):
    """请求的出勤结果不存在或不属于当前用户。"""


class AttendanceResultExpiredError(LookupError):
    """请求的出勤结果已过期。"""


@dataclass(frozen=True)
class CachedAttendanceResult:
    result_id: str
    user_id: int
    filename: str
    content_path: Path
    size: int
    expires_at: datetime
    expires_monotonic: float

    @property
    def content(self) -> bytes:
        return self.content_path.read_bytes()


class AttendanceResultCache:
    """以统一任务产物存储为后端的出勤结果短时缓存。"""

    def __init__(
        self,
        *,
        ttl_seconds: int = 600,
        max_entries: int = 20,
        max_bytes: int = 100 * 1024 * 1024,
        artifact_store: TaskArtifactStore | None = None,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.artifact_store = artifact_store or task_artifact_store
        self._entries: OrderedDict[str, CachedAttendanceResult] = OrderedDict()
        self._unavailable: OrderedDict[str, int] = OrderedDict()
        self._total_bytes = 0
        self._lock = threading.Lock()

    def put(
        self,
        *,
        user_id: int,
        filename: str,
        content: bytes,
    ) -> CachedAttendanceResult:
        now_monotonic = time.monotonic()
        result_id = secrets.token_urlsafe(32)
        expires_at = datetime.now(UTC) + timedelta(seconds=self.ttl_seconds)
        self.artifact_store.ensure_task(
            user_id=user_id,
            tool=TASK_TOOL,
            task_id=result_id,
            expires_at=expires_at.timestamp(),
            metadata={"filename": filename},
        )
        content_path = self.artifact_store.write_artifact(
            user_id=user_id,
            tool=TASK_TOOL,
            task_id=result_id,
            relative_path=RESULT_PATH,
            content=content,
        )
        entry = CachedAttendanceResult(
            result_id=result_id,
            user_id=user_id,
            filename=filename,
            content_path=content_path,
            size=len(content),
            expires_at=expires_at,
            expires_monotonic=now_monotonic + self.ttl_seconds,
        )

        with self._lock:
            self._purge_expired(now_monotonic)
            self._entries[entry.result_id] = entry
            self._total_bytes += entry.size
            self._evict_overflow()
        return entry

    def get(self, result_id: str, user_id: int) -> CachedAttendanceResult:
        now_monotonic = time.monotonic()
        with self._lock:
            entry = self._entries.get(result_id)
            if entry is None:
                entry = self._load_entry(result_id, user_id, now_monotonic)
            if entry.user_id != user_id:
                raise AttendanceResultNotFoundError
            if entry.expires_monotonic <= now_monotonic:
                self._remove_entry(result_id, mark_unavailable=True)
                raise AttendanceResultExpiredError
            self._entries.move_to_end(result_id)
            return entry

    def delete(self, result_id: str, user_id: int) -> None:
        with self._lock:
            entry = self._entries.get(result_id)
            if entry is not None and entry.user_id != user_id:
                return
            if entry is not None:
                self._remove_entry(result_id, mark_unavailable=False)
                return
            try:
                manifest = self.artifact_store.read_task_manifest(
                    user_id=user_id,
                    tool=TASK_TOOL,
                    task_id=result_id,
                )
            except TaskArtifactNotFoundError:
                return
            if manifest.get("user_id") == user_id:
                self.artifact_store.delete_task(
                    user_id=user_id,
                    tool=TASK_TOOL,
                    task_id=result_id,
                )

    def _load_entry(
        self,
        result_id: str,
        user_id: int,
        now_monotonic: float,
    ) -> CachedAttendanceResult:
        try:
            manifest = self.artifact_store.read_task_manifest(
                user_id=user_id,
                tool=TASK_TOOL,
                task_id=result_id,
            )
        except (TaskArtifactNotFoundError, ValueError) as exc:
            unavailable_user_id = self._unavailable.get(result_id)
            if unavailable_user_id == user_id:
                raise AttendanceResultExpiredError from exc
            raise AttendanceResultNotFoundError from exc

        expires_timestamp = float(manifest.get("expires_at", 0))
        remaining_seconds = expires_timestamp - time.time()
        if remaining_seconds <= 0:
            self.artifact_store.delete_task(
                user_id=user_id,
                tool=TASK_TOOL,
                task_id=result_id,
            )
            self._remember_unavailable(result_id, user_id)
            raise AttendanceResultExpiredError

        path = self.artifact_store.resolve_task_path(
            user_id=user_id,
            tool=TASK_TOOL,
            task_id=result_id,
            relative_path=RESULT_PATH,
        )
        if not path.is_file():
            raise AttendanceResultNotFoundError
        entry = CachedAttendanceResult(
            result_id=result_id,
            user_id=user_id,
            filename=str(manifest.get("metadata", {}).get("filename", path.name)),
            content_path=path,
            size=path.stat().st_size,
            expires_at=datetime.fromtimestamp(expires_timestamp, tz=UTC),
            expires_monotonic=now_monotonic + remaining_seconds,
        )
        self._entries[result_id] = entry
        self._total_bytes += entry.size
        self._evict_overflow()
        return entry

    def _purge_expired(self, now_monotonic: float) -> None:
        expired_ids = [
            result_id
            for result_id, entry in self._entries.items()
            if entry.expires_monotonic <= now_monotonic
        ]
        for result_id in expired_ids:
            self._remove_entry(result_id, mark_unavailable=True)

    def _evict_overflow(self) -> None:
        while (
            len(self._entries) > self.max_entries or self._total_bytes > self.max_bytes
        ):
            oldest_result_id = next(iter(self._entries))
            self._remove_entry(oldest_result_id, mark_unavailable=True)

    def _remove_entry(self, result_id: str, *, mark_unavailable: bool) -> None:
        entry = self._entries.pop(result_id, None)
        if entry is None:
            return
        self._total_bytes -= entry.size
        self.artifact_store.delete_task(
            user_id=entry.user_id,
            tool=TASK_TOOL,
            task_id=result_id,
        )
        if mark_unavailable:
            self._remember_unavailable(result_id, entry.user_id)

    def _remember_unavailable(self, result_id: str, user_id: int) -> None:
        self._unavailable[result_id] = user_id
        while len(self._unavailable) > self.max_entries * 5:
            self._unavailable.popitem(last=False)


attendance_result_cache = AttendanceResultCache()

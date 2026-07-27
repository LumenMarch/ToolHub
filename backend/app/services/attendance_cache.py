from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta


class AttendanceResultNotFoundError(LookupError):
    """请求的出勤结果不存在或不属于当前用户。"""


class AttendanceResultExpiredError(LookupError):
    """请求的出勤结果已过期。"""


@dataclass(frozen=True)
class CachedAttendanceResult:
    result_id: str
    user_id: int
    filename: str
    content: bytes
    expires_at: datetime
    expires_monotonic: float


class AttendanceResultCache:
    def __init__(
        self,
        *,
        ttl_seconds: int = 600,
        max_entries: int = 20,
        max_bytes: int = 100 * 1024 * 1024,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self.max_bytes = max_bytes
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
        entry = CachedAttendanceResult(
            result_id=secrets.token_urlsafe(32),
            user_id=user_id,
            filename=filename,
            content=content,
            expires_at=datetime.now(UTC) + timedelta(seconds=self.ttl_seconds),
            expires_monotonic=now_monotonic + self.ttl_seconds,
        )

        with self._lock:
            self._purge_expired(now_monotonic)
            self._entries[entry.result_id] = entry
            self._total_bytes += len(content)
            self._evict_overflow()
        return entry

    def get(self, result_id: str, user_id: int) -> CachedAttendanceResult:
        now_monotonic = time.monotonic()
        with self._lock:
            entry = self._entries.get(result_id)
            if entry is not None:
                if entry.user_id != user_id:
                    raise AttendanceResultNotFoundError
                if entry.expires_monotonic <= now_monotonic:
                    self._remove_entry(result_id, mark_unavailable=True)
                    raise AttendanceResultExpiredError
                return entry

            unavailable_user_id = self._unavailable.get(result_id)
            if unavailable_user_id == user_id:
                raise AttendanceResultExpiredError
            raise AttendanceResultNotFoundError

    def delete(self, result_id: str, user_id: int) -> None:
        with self._lock:
            entry = self._entries.get(result_id)
            if entry is not None and entry.user_id == user_id:
                self._remove_entry(result_id, mark_unavailable=False)

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
        self._total_bytes -= len(entry.content)
        if mark_unavailable:
            self._unavailable[result_id] = entry.user_id
            while len(self._unavailable) > self.max_entries * 5:
                self._unavailable.popitem(last=False)


attendance_result_cache = AttendanceResultCache()

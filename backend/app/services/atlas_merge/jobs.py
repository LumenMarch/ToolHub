"""atlas-merge 合并任务的进程内 job 表与执行器。

进度契约（与前端对齐）：
- ``POST /tools/atlas-merge/analyze`` 立即返回 202 + job_id，合并任务在后台线程执行
- ``GET /tools/atlas-merge/jobs/{job_id}`` 轮询进度（REST 为进度真相源）
- job 完成/失败后保留 10 分钟（懒清理，仿 attendance cache 的懒清理风格）
- 完成时向该用户发一个轻量实时提示事件（``atlas_merge.progress``，仅 {job_id, status}，
  不含进度真相，符合 CONTEXT.md 的 Realtime Notification 模式）

实现约束：单进程假设（与 DESIGN.md 一致）——进程内 dict + threading.Lock，
ThreadPoolExecutor（max_workers=2，仿 asset_comparison 先例）执行合并。
"""

from __future__ import annotations

import secrets
import shutil
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import Request
from loguru import logger

from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.atlas_merge import AtlasMergeAnalyzeResponse
from app.services.atlas_merge.archive import extract_archive_zip
from app.services.atlas_merge.cache import (
    CachedAtlasMergeResult,
    atlas_merge_result_cache,
)
from app.services.atlas_merge.exporter import csv_text
from app.services.atlas_merge.merge_engine import merge
from app.services.atlas_merge.models import MergedReport, MetaColumn
from app.services.audit import log_action
from app.services.realtime.hub import realtime_hub
from app.services.upload.store import (
    UploadNotCompleteError,
    UploadNotFoundError,
    UploadOwnershipError,
    UploadStore,
)

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_ERROR = "error"

# 终态：到达后保留时长由 TTL 控制（懒清理）；活跃任务不清理
_TERMINAL_STATUSES = {STATUS_DONE, STATUS_ERROR}

# 完成后保留时长（秒）
JOB_TTL_SECONDS = 600

# 预览上限：真实归档可达上千测量列，job 响应只返回元数据列 + 前 N 个测量列 + 总列数，
# 供前端表格骨架使用；完整数据（全列）走 download。
PREVIEW_MEASUREMENT_COLUMNS = 20
PREVIEW_ROWS = 10

# 单进程内最多 2 个合并任务并行（仿 asset_comparison 先例）
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="atlas-merge-job")

store = UploadStore()


@dataclass
class JobEntry:
    """进程内 job 记录。字段更新均需持有 registry 锁。"""

    job_id: str
    user_id: int
    upload_id: str
    status: str = STATUS_QUEUED
    done: int = 0
    total: int = 0
    # 终态 done 时携带完整响应字段（含 status），error 时为 None
    result: dict[str, Any] | None = None
    error: str | None = None
    created_monotonic: float = field(default_factory=time.monotonic)
    completed_monotonic: float | None = None
    # 提交时的请求对象，供后台线程审计取客户端 IP（headers 读取线程安全）
    request: Request | None = None


class AtlasMergeJobRegistry:
    """进程内 job 表：提交 → 后台执行 → 轮询 → 懒清理。"""

    def __init__(self, ttl_seconds: int = JOB_TTL_SECONDS) -> None:
        self.ttl_seconds = ttl_seconds
        self._jobs: dict[str, JobEntry] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------- 提交

    def submit(
        self,
        *,
        user_id: int,
        upload_id: str,
        request: Request | None = None,
    ) -> str:
        """创建 queued job 并提交后台执行，返回 job_id。"""
        job_id = secrets.token_hex(16)
        entry = JobEntry(
            job_id=job_id,
            user_id=user_id,
            upload_id=upload_id,
            request=request,
        )
        with self._lock:
            self._purge_expired(time.monotonic())
            self._jobs[job_id] = entry
        _EXECUTOR.submit(self._run, entry)
        return job_id

    # ------------------------------------------------------------- 查询

    def get(self, job_id: str, user_id: int) -> JobEntry | None:
        """返回属于指定用户的 job；不存在、非本人或已过期清理时返回 None。"""
        with self._lock:
            self._purge_expired(time.monotonic())
            entry = self._jobs.get(job_id)
            if entry is None or entry.user_id != user_id:
                return None
            return entry

    def get_serialized(self, job_id: str, user_id: int) -> dict | None:
        """归属校验 + 序列化一次完成（持锁，避免与进度更新竞态）。"""
        with self._lock:
            self._purge_expired(time.monotonic())
            entry = self._jobs.get(job_id)
            if entry is None or entry.user_id != user_id:
                return None
            return self.serialize(entry)

    @staticmethod
    def serialize(entry: JobEntry) -> dict:
        """按状态输出契约要求的载荷。"""
        if entry.status == STATUS_DONE:
            return dict(entry.result) if entry.result else {"status": STATUS_DONE}
        if entry.status == STATUS_ERROR:
            return {"status": STATUS_ERROR, "error": entry.error or "未知错误"}
        return {"status": entry.status, "done": entry.done, "total": entry.total}

    # ------------------------------------------------------------- 执行

    def _run(self, entry: JobEntry) -> None:
        """后台任务主体：解压 → 合并（进度回调）→ 写缓存 → 清理源上传 → 审计。"""
        self._set_status(entry, STATUS_RUNNING)
        tmp_dir = Path(tempfile.mkdtemp(prefix="atlas-merge-"))
        try:
            content = self._read_upload(entry)
            archive_root = extract_archive_zip(content, tmp_dir / "archive")
            report = merge(archive_root, progress=self._make_progress(entry))
            output = csv_text(report).encode("utf-8")
        except Exception as exc:  # noqa: BLE001 - 终态错误统一由 job 携带
            logger.exception(f"atlas-merge job 执行失败 job_id={entry.job_id}")
            self._fail(entry, str(exc) or "合并任务执行失败，请稍后重试")
            return
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        timestamp = datetime.now().strftime("%Y%m%d")
        filename = f"unit_archive_merged_{timestamp}.csv"
        cached = atlas_merge_result_cache.put(
            user_id=entry.user_id,
            filename=filename,
            content=output,
        )
        self._complete(entry, _build_done_payload(report, cached, filename))

        # 成功后才清理源上传，失败保留以便用户重试
        try:
            store.delete_owned(entry.upload_id, entry.user_id)
        except Exception:  # noqa: BLE001 - 清理失败不阻断结果
            logger.warning(
                f"atlas-merge 源上传清理失败 upload_id={entry.upload_id}",
                exc_info=True,
            )
        self._audit_completed(entry)

    def _read_upload(self, entry: JobEntry) -> bytes:
        """读取属于该 job 用户的已完成上传；错误转成可展示的失败原因。"""
        try:
            return store.read_owned_bytes(entry.upload_id, entry.user_id)
        except UploadOwnershipError as exc:
            raise RuntimeError("无权访问此上传") from exc
        except UploadNotFoundError as exc:
            raise RuntimeError("上传不存在或已被清理") from exc
        except UploadNotCompleteError as exc:
            raise RuntimeError("上传尚未完成") from exc

    def _make_progress(self, entry: JobEntry):
        """merge 进度回调：每个 unit 一次，直接写入 job.done/total（unit 级粒度正合适，不节流）。"""

        def on_progress(done: int, total: int) -> None:
            with self._lock:
                current = self._jobs.get(entry.job_id)
                if current is None or current.status != STATUS_RUNNING:
                    return
                current.done = done
                current.total = total
            logger.debug(f"atlas-merge 进度 job={entry.job_id} {done}/{total}")

        return on_progress

    # ------------------------------------------------------------- 状态转换

    def _set_status(self, entry: JobEntry, status: str) -> None:
        """非终态转换（queued → running）。"""
        with self._lock:
            current = self._jobs.get(entry.job_id)
            if current is None:
                return
            current.status = status

    def _complete(self, entry: JobEntry, payload: dict) -> None:
        """写入终态 done（含完整响应载荷）。"""
        with self._lock:
            current = self._jobs.get(entry.job_id)
            if current is None:
                return
            current.status = STATUS_DONE
            current.result = payload
            current.completed_monotonic = time.monotonic()
        self._notify_terminal(entry)

    def _fail(self, entry: JobEntry, error: str) -> None:
        """写入终态 error（含失败原因）。"""
        with self._lock:
            current = self._jobs.get(entry.job_id)
            if current is None:
                return
            current.status = STATUS_ERROR
            current.error = error
            current.completed_monotonic = time.monotonic()
        self._notify_terminal(entry)

    def _notify_terminal(self, entry: JobEntry) -> None:
        """终态实时提示（轻量事件，仅 {job_id, status}；REST 才是进度真相源）。

        发布放在锁外；realtime_hub.publish 内部经 call_soon_threadsafe 切回主事件循环。
        """
        event = {
            "type": "atlas_merge.progress",
            "job_id": entry.job_id,
            "user_id": entry.user_id,
            "status": entry.status,
            "at": datetime.now(UTC)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        realtime_hub.publish(event, user_id=entry.user_id)

    def _audit_completed(self, entry: JobEntry) -> None:
        """任务完成审计（后台线程需独立 DB session；失败不阻断）。"""
        try:
            with SessionLocal() as db:
                user = db.get(User, entry.user_id)
                if user is None:
                    return
                detail: dict[str, Any] = {"job_id": entry.job_id}
                if entry.result is not None:
                    detail.update(
                        {
                            "result_id": entry.result.get("result_id"),
                            "unit_count": entry.result.get("unit_count"),
                            "run_count": entry.result.get("run_count"),
                            "parse_error_count": len(
                                entry.result.get("parse_errors") or []
                            ),
                        }
                    )
                log_action(
                    db,
                    request=entry.request,
                    user=user,
                    action="tool.atlas_merge.analyze",
                    target_type="tool",
                    target_id="atlas-merge",
                    detail=detail,
                )
        except Exception:  # noqa: BLE001 - 审计失败不影响主流程
            logger.warning(
                f"atlas-merge job 审计失败 job_id={entry.job_id}", exc_info=True
            )

    # ------------------------------------------------------------- 懒清理

    def _purge_expired(self, now: float) -> None:
        """懒清理：仅清理到达终态且超过 TTL 的 job；活跃 job 永不清理。"""
        expired = [
            job_id
            for job_id, entry in self._jobs.items()
            if entry.status in _TERMINAL_STATUSES
            and entry.completed_monotonic is not None
            and now - entry.completed_monotonic >= self.ttl_seconds
        ]
        for job_id in expired:
            self._jobs.pop(job_id, None)


def _build_done_payload(
    report: MergedReport,
    cached: CachedAtlasMergeResult,
    filename: str,
) -> dict:
    """组装 done 状态载荷：status + 与原有 analyze 响应完全一致的字段。"""
    metadata_columns = [mc.value for mc in MetaColumn]
    serial_index = metadata_columns.index(MetaColumn.SERIAL_NUMBER.value)
    measurement_columns = [c.name for c in report.columns[len(metadata_columns) :]]
    preview_columns = measurement_columns[:PREVIEW_MEASUREMENT_COLUMNS]
    skeleton_columns = metadata_columns + preview_columns
    rows_preview = [row[: len(skeleton_columns)] for row in report.rows[:PREVIEW_ROWS]]
    unit_count = len({row[serial_index] for row in report.rows})

    response = AtlasMergeAnalyzeResponse(
        result_id=cached.result_id,
        download_filename=filename,
        expires_at=cached.expires_at,
        unit_count=unit_count,
        run_count=len(report.rows),
        parse_errors=report.parseErrors,
        data_source=report.dataSource,
        metadata_columns=metadata_columns,
        preview_measurement_columns=preview_columns,
        total_measurement_columns=len(measurement_columns),
        columns=skeleton_columns,
        rows_preview=rows_preview,
    )
    return {"status": STATUS_DONE, **response.model_dump()}


atlas_merge_jobs = AtlasMergeJobRegistry()

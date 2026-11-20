"""atlas-merge 合并任务：PostgreSQL 状态 + RQ 执行器。

进度契约（与前端对齐）：
- ``POST /tools/atlas-merge/analyze`` 立即返回 202 + job_id，任务进入 RQ
- ``GET /tools/atlas-merge/jobs/{job_id}`` 轮询进度（REST 为进度真相源）
- 终态后保留 ``JOB_TTL_SECONDS``，由懒清理与周期清理删除行
- 完成/失败时向该用户发轻量实时提示事件（``atlas_merge.progress``）

多副本：任务状态在 PostgreSQL，API 只入队；Worker 用条件更新领取
``queued -> running``，重复投递不会重复执行。
"""

from __future__ import annotations

import json
import secrets
import shutil
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import Request
from loguru import logger
from sqlalchemy import delete, select, update

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.atlas_merge_job import AtlasMergeJob
from app.models.user import User
from app.schemas.atlas_merge import AtlasMergeAnalyzeResponse
from app.services.atlas_merge.archive import extract_archive_zip
from app.services.atlas_merge.cache import (
    CachedAtlasMergeResult,
    atlas_merge_result_cache,
)
from app.services.atlas_merge.exporter import csv_text, insight_csv_text
from app.services.atlas_merge.merge_engine import merge
from app.services.atlas_merge.models import MergedReport, MetaColumn
from app.services.audit import get_client_ip, log_action
from app.services.jobs.queue import JobQueue, get_job_queue
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

store = UploadStore()


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass(frozen=True)
class _JobSnapshot:
    """Worker 执行所需的不可变字段；不跨进程持有 ORM 对象。"""

    job_id: str
    user_id: int
    upload_id: str
    export_format: str
    ip_address: str | None


class AtlasMergeJobRegistry:
    """PostgreSQL 持久化 job 表：提交 → RQ 执行 → 轮询 → 清理。"""

    def __init__(
        self,
        ttl_seconds: int = JOB_TTL_SECONDS,
        *,
        job_queue: JobQueue | None = None,
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self._job_queue = job_queue or get_job_queue()

    # ------------------------------------------------------------- 提交

    def submit(
        self,
        *,
        user_id: int,
        upload_id: str,
        export_format: str = "insight",
        request: Request | None = None,
    ) -> str:
        """创建 queued job 并入队，返回 job_id。"""
        job_id = secrets.token_hex(16)
        with SessionLocal() as db:
            db.add(
                AtlasMergeJob(
                    id=job_id,
                    user_id=user_id,
                    upload_id=upload_id,
                    export_format=export_format,
                    status=STATUS_QUEUED,
                    done=0,
                    total=0,
                    ip_address=get_client_ip(request),
                )
            )
            db.commit()
        self.cleanup_expired()
        self._job_queue.enqueue(
            run_atlas_merge_job_task, job_id, queue=settings.JOB_QUEUE_ANALYSIS
        )
        return job_id

    # ------------------------------------------------------------- 查询

    def get_serialized(self, job_id: str, user_id: int) -> dict | None:
        """归属校验 + 序列化；不存在、非本人或已过期时返回 None。"""
        with SessionLocal() as db:
            job = db.scalars(
                select(AtlasMergeJob).where(
                    AtlasMergeJob.id == job_id,
                    AtlasMergeJob.user_id == user_id,
                )
            ).first()
            if job is None:
                return None
            if self._is_expired(job):
                db.delete(job)
                db.commit()
                return None
            return self.serialize(job)

    @staticmethod
    def serialize(job: AtlasMergeJob) -> dict:
        """按状态输出契约要求的载荷。"""
        if job.status == STATUS_DONE:
            if job.result_json:
                return json.loads(job.result_json)
            return {"status": STATUS_DONE}
        if job.status == STATUS_ERROR:
            return {
                "status": STATUS_ERROR,
                "error": job.error_message or "未知错误",
            }
        return {"status": job.status, "done": job.done, "total": job.total}

    # ------------------------------------------------------------- 执行

    def run(self, job_id: str) -> None:
        """Worker 任务主体：领取 → 解压 → 合并 → 写缓存 → 清理源上传 → 审计。"""
        snapshot = self._claim(job_id)
        if snapshot is None:
            return
        tmp_dir = Path(tempfile.mkdtemp(prefix="atlas-merge-"))
        try:
            content = self._read_upload(snapshot)
            archive_root = extract_archive_zip(content, tmp_dir / "archive")
            report = merge(
                archive_root,
                progress=self._make_progress(job_id),
            )
            timestamp = datetime.now().strftime("%Y%m%d")
            if snapshot.export_format == "insight":
                output = insight_csv_text(report).encode("utf-8")
                filename = f"unit_archive_merged_insight_{timestamp}.csv"
            else:
                output = csv_text(report).encode("utf-8")
                filename = f"unit_archive_merged_{timestamp}.csv"
            cached = atlas_merge_result_cache.put(
                user_id=snapshot.user_id,
                filename=filename,
                content=output,
            )
            payload = _build_done_payload(report, cached, filename)
        except Exception as exc:  # noqa: BLE001 - 终态错误统一由 job 携带
            logger.exception(f"atlas-merge job 执行失败 job_id={job_id}")
            self._fail(job_id, str(exc) or "合并任务执行失败，请稍后重试")
            return
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        self._complete(snapshot, payload)

        # 成功后才清理源上传，失败保留以便用户重试
        try:
            store.delete_owned(snapshot.upload_id, snapshot.user_id)
        except Exception:  # noqa: BLE001 - 清理失败不阻断结果
            logger.warning(
                f"atlas-merge 源上传清理失败 upload_id={snapshot.upload_id}",
                exc_info=True,
            )
        self._audit_completed(snapshot, payload)

    def _claim(self, job_id: str) -> _JobSnapshot | None:
        """条件更新领取任务；重复投递的第二个 Worker 会直接退出。"""
        with SessionLocal() as db:
            claimed = db.execute(
                update(AtlasMergeJob)
                .where(
                    AtlasMergeJob.id == job_id,
                    AtlasMergeJob.status == STATUS_QUEUED,
                )
                .values(
                    status=STATUS_RUNNING,
                    started_at=_utcnow(),
                    updated_at=_utcnow(),
                )
            ).rowcount
            if claimed != 1:
                db.rollback()
                return None
            job = db.get(AtlasMergeJob, job_id)
            if job is None:
                db.rollback()
                return None
            snapshot = _JobSnapshot(
                job_id=job.id,
                user_id=job.user_id,
                upload_id=job.upload_id,
                export_format=job.export_format,
                ip_address=job.ip_address,
            )
            db.commit()
            return snapshot

    def _read_upload(self, snapshot: _JobSnapshot) -> bytes:
        """读取属于该 job 用户的已完成上传；错误转成可展示的失败原因。"""
        try:
            return store.read_owned_bytes(snapshot.upload_id, snapshot.user_id)
        except UploadOwnershipError as exc:
            raise RuntimeError("无权访问此上传") from exc
        except UploadNotFoundError as exc:
            raise RuntimeError("上传不存在或已被清理") from exc
        except UploadNotCompleteError as exc:
            raise RuntimeError("上传尚未完成") from exc

    def _make_progress(self, job_id: str):
        """merge 进度回调：限频写库，避免每个 unit 一次数据库往返。"""
        last_update = 0.0

        def on_progress(done: int, total: int) -> None:
            nonlocal last_update
            now = time.monotonic()
            if done != total and now - last_update < 0.5:
                return
            last_update = now
            with SessionLocal() as db:
                db.execute(
                    update(AtlasMergeJob)
                    .where(
                        AtlasMergeJob.id == job_id,
                        AtlasMergeJob.status == STATUS_RUNNING,
                    )
                    .values(done=done, total=total, updated_at=_utcnow())
                )
                db.commit()
            logger.debug(f"atlas-merge 进度 job={job_id} {done}/{total}")

        return on_progress

    def _complete(self, snapshot: _JobSnapshot, payload: dict) -> None:
        now = _utcnow()
        with SessionLocal() as db:
            updated = db.execute(
                update(AtlasMergeJob)
                .where(
                    AtlasMergeJob.id == snapshot.job_id,
                    AtlasMergeJob.status == STATUS_RUNNING,
                )
                .values(
                    status=STATUS_DONE,
                    result_json=json.dumps(payload, ensure_ascii=False),
                    completed_at=now,
                    updated_at=now,
                    expires_at=now + timedelta(seconds=self.ttl_seconds),
                )
            ).rowcount
            db.commit()
        if updated:
            self._notify(snapshot, STATUS_DONE)

    def _fail(self, job_id: str, error: str) -> None:
        now = _utcnow()
        with SessionLocal() as db:
            job = db.get(AtlasMergeJob, job_id)
            if job is None:
                return
            snapshot = _JobSnapshot(
                job_id=job.id,
                user_id=job.user_id,
                upload_id=job.upload_id,
                export_format=job.export_format,
                ip_address=job.ip_address,
            )
            updated = db.execute(
                update(AtlasMergeJob)
                .where(
                    AtlasMergeJob.id == job_id,
                    AtlasMergeJob.status == STATUS_RUNNING,
                )
                .values(
                    status=STATUS_ERROR,
                    error_message=error,
                    completed_at=now,
                    updated_at=now,
                    expires_at=now + timedelta(seconds=self.ttl_seconds),
                )
            ).rowcount
            db.commit()
        if updated:
            self._notify(snapshot, STATUS_ERROR)

    def _notify(self, snapshot: _JobSnapshot, status: str) -> None:
        """终态实时提示（轻量事件，仅 {job_id, status}；REST 才是进度真相源）。"""
        event = {
            "type": "atlas_merge.progress",
            "job_id": snapshot.job_id,
            "user_id": snapshot.user_id,
            "status": status,
            "at": datetime.now(UTC)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
        }
        realtime_hub.publish(event, user_id=snapshot.user_id)

    def _audit_completed(self, snapshot: _JobSnapshot, payload: dict) -> None:
        """任务完成审计（Worker 无 Request，IP 来自提交时快照）。"""
        try:
            with SessionLocal() as db:
                user = db.get(User, snapshot.user_id)
                if user is None:
                    return
                detail: dict[str, Any] = {"job_id": snapshot.job_id}
                detail.update(
                    {
                        "result_id": payload.get("result_id"),
                        "unit_count": payload.get("unit_count"),
                        "run_count": payload.get("run_count"),
                        "parse_error_count": len(payload.get("parse_errors") or []),
                    }
                )
                log_action(
                    db,
                    request=None,
                    ip_address=snapshot.ip_address,
                    user=user,
                    action="tool.atlas_merge.analyze",
                    target_type="tool",
                    target_id="atlas-merge",
                    detail=detail,
                )
        except Exception:  # noqa: BLE001 - 审计失败不影响主流程
            logger.warning(
                f"atlas-merge job 审计失败 job_id={snapshot.job_id}", exc_info=True
            )

    # ------------------------------------------------------------- 清理

    @staticmethod
    def _is_expired(job: AtlasMergeJob) -> bool:
        if job.status not in _TERMINAL_STATUSES:
            return False
        return job.expires_at is not None and job.expires_at <= _utcnow()

    def cleanup_expired(self) -> int:
        """删除终态且超过 TTL 的 job 行；活跃 job 不受影响。"""
        with SessionLocal() as db:
            removed = db.execute(
                delete(AtlasMergeJob).where(
                    AtlasMergeJob.status.in_(_TERMINAL_STATUSES),
                    AtlasMergeJob.expires_at.is_not(None),
                    AtlasMergeJob.expires_at <= _utcnow(),
                )
            ).rowcount
            db.commit()
            return removed


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


def run_atlas_merge_job_task(job_id: str) -> None:
    """RQ 任务入口：必须是模块级函数，Worker 才能按路径导入。"""
    atlas_merge_jobs.run(job_id)


atlas_merge_jobs = AtlasMergeJobRegistry()

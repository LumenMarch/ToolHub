from __future__ import annotations

import hashlib
import json
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter
from typing import Any

from loguru import logger

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.asset_comparison_artifact import AssetComparisonArtifact
from app.models.asset_comparison_job import AssetComparisonJob
from app.services.asset_comparison.comparison_snapshot import (
    comparison_snapshot_exists,
    load_comparison_snapshot,
)
from app.services.asset_comparison.difference_details import (
    build_difference_details,
)
from app.services.asset_comparison.domain import (
    JOB_ACTIVE_STATUSES,
    JOB_TERMINAL_STATUSES,
    MODULE_BY_KEY,
    MODULE_ORDER,
    calculate_progress,
    derive_job_status,
    initial_artifacts,
    initial_module_results,
    initial_progress,
    normalize_module_results,
    transition_allowed,
)
from app.services.realtime.events import job_terminal_event, job_updated_event
from app.services.realtime.hub import realtime_hub
from app.services.task_artifacts import TaskArtifactStore, task_artifact_store

TASK_TOOL = "asset-comparison"
BASE_ARTIFACT_KEYS = [*(f"module_{key}" for key in MODULE_ORDER), "raw_data_xlsx"]
REVIEW_VALUES = {"差異確認OK", "待跟进", "異常"}
RETAINED_JOB_STATUSES = [
    "base_ready",
    "complete",
    "partial_failed",
    "failed",
    "cancelled",
    "expired",
]


class AssetComparisonJobNotFoundError(LookupError):
    pass


class AssetComparisonJobExpiredError(LookupError):
    pass


class AssetComparisonJobConflictError(RuntimeError):
    pass


class AssetComparisonJobValidationError(ValueError):
    pass


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _loads(value: str | None, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class AssetComparisonJobManager:
    """管理资产核对任务、状态转换和产物生命周期。"""

    def __init__(
        self,
        *,
        execute_job: Callable,
        finalize_job: Callable,
        retry_artifact: Callable,
        artifact_store: TaskArtifactStore | None = None,
    ) -> None:
        self._execute_job = execute_job
        self._finalize_job = finalize_job
        self._retry_artifact = retry_artifact
        self._artifact_store = artifact_store or task_artifact_store
        self._executor = ThreadPoolExecutor(
            max_workers=max(settings.ASSET_COMPARISON_MAX_ACTIVE_JOBS, 1),
            thread_name_prefix="asset-comparison-job",
        )
        self._lock = threading.RLock()

    @staticmethod
    def _transition(job: AssetComparisonJob, next_status: str) -> None:
        if not transition_allowed(job.status, next_status):
            raise RuntimeError(
                f"不允许的资产核对任务状态转换: {job.status} -> {next_status}"
            )
        job.status = next_status

    def _notify_job(self, *, job_id: str, user_id: int, status: str) -> None:
        """任务状态落库后推送实时通知（仅 owner；终态用 job.terminal）。"""
        if status in JOB_TERMINAL_STATUSES:
            event = job_terminal_event(job_id=job_id, user_id=user_id, status=status)
        else:
            event = job_updated_event(job_id=job_id, user_id=user_id, status=status)
        realtime_hub.publish(event, user_id=user_id)

    def create_job(
        self,
        *,
        user_id: int,
        client_request_id: str,
        inputs: dict[str, str],
    ) -> tuple[dict, bool]:
        create_started_at = perf_counter()
        self.cleanup()
        with self._lock, SessionLocal() as db:
            existing = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.user_id == user_id,
                    AssetComparisonJob.client_request_id == client_request_id,
                )
                .first()
            )
            if existing is not None:
                existing = self._get_owned_job(db, user_id, existing.id)
                return self._serialize(existing), True

            now = _utcnow()
            job_id = str(uuid.uuid4())
            expires_at = now + timedelta(hours=settings.ASSET_COMPARISON_JOB_TTL_HOURS)
            source_paths = {
                key: Path(value).resolve()
                for key, value in inputs.items()
                if str(value).strip()
            }
            invalid_inputs = [
                key
                for key in inputs
                if key not in source_paths or not source_paths[key].is_file()
            ]
            if invalid_inputs:
                raise AssetComparisonJobValidationError(
                    f"输入文件不存在: {', '.join(invalid_inputs)}"
                )
            job_dir = self._artifact_store.ensure_task(
                user_id=user_id,
                tool=TASK_TOOL,
                task_id=job_id,
                expires_at=expires_at.replace(tzinfo=UTC).timestamp(),
                metadata={
                    "client_request_id": client_request_id,
                    "inputs": {
                        key: source_path.name
                        for key, source_path in source_paths.items()
                    },
                },
            )
            snapshot_files = {}
            try:
                for key, source_path in source_paths.items():
                    suffix = source_path.suffix.lower() or ".bin"
                    staged_path = self._artifact_store.materialize_input(
                        user_id=user_id,
                        tool=TASK_TOOL,
                        task_id=job_id,
                        filename=f"{key}{suffix}",
                        source_path=source_path,
                        link_source=self._artifact_store.contains_path(source_path),
                    )
                    snapshot_files[key] = {
                        "relativePath": staged_path.relative_to(job_dir).as_posix(),
                        "filename": source_path.name,
                        "sizeBytes": staged_path.stat().st_size,
                        "sha256": _sha256_file(staged_path),
                    }
            except Exception:
                self._delete_job_files(user_id, job_id)
                raise

            fingerprint_payload = {
                key: {
                    "sizeBytes": value["sizeBytes"],
                    "sha256": value["sha256"],
                }
                for key, value in sorted(snapshot_files.items())
            }
            input_fingerprint = hashlib.sha256(
                _dumps(fingerprint_payload).encode("utf-8")
            ).hexdigest()
            input_snapshot = {
                "version": 1,
                "fingerprint": input_fingerprint,
                "files": snapshot_files,
            }
            self._artifact_store.ensure_task(
                user_id=user_id,
                tool=TASK_TOOL,
                task_id=job_id,
                expires_at=expires_at.replace(tzinfo=UTC).timestamp(),
                metadata={"input_fingerprint": input_fingerprint},
            )
            job = AssetComparisonJob(
                id=job_id,
                user_id=user_id,
                client_request_id=client_request_id,
                status="queued",
                input_json=_dumps(input_snapshot),
                results_json=_dumps(initial_module_results()),
                artifacts_json="{}",
                remarks_json="{}",
                reviews_json="{}",
                progress_json=_dumps(initial_progress()),
                expires_at=expires_at,
            )
            self._store_artifacts(job, initial_artifacts())
            try:
                db.add(job)
                db.commit()
            except Exception:
                self._delete_job_files(user_id, job_id)
                raise
            db.refresh(job)
            response = self._serialize(job)

        self._log_stage(
            job_id=job_id,
            user_id=user_id,
            stage="job_snapshot_inputs",
            status="ready",
            elapsed=perf_counter() - create_started_at,
            size_bytes=sum(
                file_info["sizeBytes"] for file_info in snapshot_files.values()
            ),
            annotation_revision=0,
        )
        self._notify_job(job_id=job_id, user_id=user_id, status="queued")
        self._executor.submit(self._execute_worker, job_id)
        return response, False

    def get_job(self, *, user_id: int, job_id: str) -> dict:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            return self._serialize(job)

    def get_difference_details(
        self,
        *,
        user_id: int,
        job_id: str,
        module_key: str,
        change_type: str,
        query: str,
        offset: int,
        limit: int,
    ) -> dict:
        if module_key not in MODULE_BY_KEY:
            raise AssetComparisonJobValidationError("不支持的资产核对模块")
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            results = normalize_module_results(_loads(job.results_json, []))
            result = next(
                (item for item in results if item["key"] == module_key),
                None,
            )
            if result is None or result.get("status") != "ready":
                raise AssetComparisonJobConflictError("核对明细尚未生成")
            job_dir = self._job_dir(job.user_id, job.id)
            if not comparison_snapshot_exists(job_dir):
                raise AssetComparisonJobConflictError("核对结果快照不存在，请重新核对")
            summary = load_comparison_snapshot(
                job_dir,
                module_keys={module_key},
            )
            instance = summary.get(module_key)
            if instance is None:
                raise AssetComparisonJobConflictError("核对模块快照不完整")
            try:
                return build_difference_details(
                    module_key=module_key,
                    instance=instance,
                    change_type=change_type,
                    query=query,
                    offset=offset,
                    limit=limit,
                )
            except ValueError as exc:
                raise AssetComparisonJobValidationError(str(exc)) from exc

    def update_annotations(
        self,
        *,
        user_id: int,
        job_id: str,
        expected_revision: int,
        remarks: dict[str, str],
        reviews: dict[str, str],
    ) -> dict:
        invalid_reviews = {
            key: value for key, value in reviews.items() if value not in REVIEW_VALUES
        }
        if invalid_reviews:
            raise AssetComparisonJobValidationError("审核状态包含不支持的值")

        normalized_remarks = {
            key: str(value) for key, value in remarks.items() if key in MODULE_ORDER
        }
        normalized_reviews = {
            key: str(value) for key, value in reviews.items() if key in MODULE_ORDER
        }
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            current_remarks = _loads(job.remarks_json, {})
            current_reviews = _loads(job.reviews_json, {})
            if (
                current_remarks == normalized_remarks
                and current_reviews == normalized_reviews
            ):
                return self._serialize(job)
            if job.annotation_revision != expected_revision:
                raise AssetComparisonJobConflictError("备注已被更新，请刷新后重试")

            job.remarks_json = _dumps(normalized_remarks)
            job.reviews_json = _dumps(normalized_reviews)
            job.annotation_revision += 1
            job.updated_at = _utcnow()

            artifacts = self._load_artifacts(job)
            final_artifact = artifacts.get("final_bundle", {})
            status_changed = False
            if final_artifact.get("status") == "ready":
                final_artifact["status"] = "stale"
                artifacts["final_bundle"] = final_artifact
                self._store_artifacts(job, artifacts)
                if job.status == "complete":
                    self._transition(job, "base_ready")
                    status_changed = True

            db.commit()
            db.refresh(job)
            response = self._serialize(job)
            notify = (job.id, job.user_id, job.status) if status_changed else None
            self._log_stage(
                job_id=job.id,
                user_id=job.user_id,
                stage="job_update_annotations",
                status="ready",
                annotation_revision=job.annotation_revision,
            )
        if notify is not None:
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])
        return response

    def finalize(self, *, user_id: int, job_id: str) -> dict:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            response = self._serialize(job)
            blockers = response["finalizeBlockers"]
            if blockers:
                raise AssetComparisonJobValidationError(
                    "；".join(blocker["message"] for blocker in blockers)
                )

            artifacts = self._load_artifacts(job)
            final_artifact = artifacts["final_bundle"]
            if (
                final_artifact.get("status") == "ready"
                and job.finalized_revision == job.annotation_revision
            ):
                return response
            if final_artifact.get("status") == "building":
                return response

            final_artifact["status"] = "building"
            final_artifact.pop("error", None)
            artifacts["final_bundle"] = final_artifact
            self._store_artifacts(job, artifacts)
            self._transition(job, "finalizing")
            job.updated_at = _utcnow()
            revision = job.annotation_revision
            remarks = _loads(job.remarks_json, {})
            reviews = _loads(job.reviews_json, {})
            db.commit()
            notify = (job.id, job.user_id, job.status)

        self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])
        self._log_stage(
            job_id=job_id,
            user_id=user_id,
            stage="job_finalize",
            status="building",
            annotation_revision=revision,
        )
        self._executor.submit(
            self._finalize_worker,
            job_id,
            revision,
            remarks,
            reviews,
        )
        return self.get_job(user_id=user_id, job_id=job_id)

    def retry(
        self,
        *,
        user_id: int,
        job_id: str,
        artifact_key: str,
    ) -> dict:
        if artifact_key not in [*BASE_ARTIFACT_KEYS, "final_bundle"]:
            raise AssetComparisonJobValidationError("未知的产物类型")
        if artifact_key == "final_bundle":
            return self.finalize(user_id=user_id, job_id=job_id)

        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            artifacts = self._load_artifacts(job)
            artifact = artifacts.get(artifact_key, {})
            if artifact.get("status") not in {"failed", "stale"}:
                raise AssetComparisonJobConflictError("当前产物不需要重试")
            artifact["status"] = "building"
            artifact.pop("error", None)
            artifacts[artifact_key] = artifact
            self._store_artifacts(job, artifacts)
            self._transition(job, "running")
            job.updated_at = _utcnow()
            db.commit()
            notify = (job.id, job.user_id, job.status)

        self._log_stage(
            job_id=job_id,
            user_id=user_id,
            stage="job_retry_artifact",
            status="building",
            artifact_key=artifact_key,
        )
        self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])
        self._executor.submit(self._retry_worker, job_id, artifact_key)
        return self.get_job(user_id=user_id, job_id=job_id)

    def cancel(self, *, user_id: int, job_id: str) -> dict:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            if job.status in JOB_TERMINAL_STATUSES:
                return self._serialize(job)
            artifacts = self._load_artifacts(job)
            progress = _loads(job.progress_json, {})
            results = normalize_module_results(_loads(job.results_json, []))
            if job.status == "queued":
                self._mark_cancelled_state(job, artifacts, progress, results)
                self._store_artifacts(job, artifacts)
                job.progress_json = _dumps(progress)
                job.results_json = _dumps(results)
            elif job.status in JOB_ACTIVE_STATUSES:
                self._transition(job, "cancel_requested")
            else:
                self._mark_cancelled_state(job, artifacts, progress, results)
                self._store_artifacts(job, artifacts)
                job.progress_json = _dumps(progress)
                job.results_json = _dumps(results)
            job.updated_at = _utcnow()
            db.commit()
            db.refresh(job)
            notify_status = job.status
            notify_job_id = job.id
            notify_user_id = job.user_id
            self._log_stage(
                job_id=job.id,
                user_id=job.user_id,
                stage="job_cancel",
                status=job.status,
            )
            serialized = self._serialize(job)
        self._notify_job(
            job_id=notify_job_id,
            user_id=notify_user_id,
            status=notify_status,
        )
        return serialized

    def purge(self, *, user_id: int, job_id: str) -> None:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            if job.status in JOB_ACTIVE_STATUSES:
                raise AssetComparisonJobConflictError("任务仍在运行，暂时无法删除")
            self._delete_job_files(job.user_id, job.id, ignore_errors=False)
            db.delete(job)
            db.commit()

    def open_artifact(
        self,
        *,
        user_id: int,
        job_id: str,
        artifact_key: str,
    ) -> tuple[Path, str, str]:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            artifacts = self._load_artifacts(job)
            artifact = artifacts.get(artifact_key)
            if artifact is None:
                raise AssetComparisonJobNotFoundError
            if artifact.get("status") != "ready":
                raise AssetComparisonJobConflictError("文件尚未生成或已经失效")
            relative_path = artifact.get("path")
            if not relative_path:
                raise AssetComparisonJobNotFoundError

            path = self._artifact_store.resolve_task_path(
                user_id=job.user_id,
                tool=TASK_TOOL,
                task_id=job.id,
                relative_path=relative_path,
            )
            if not path.is_file():
                raise AssetComparisonJobNotFoundError
            expected_size = artifact.get("sizeBytes")
            expected_checksum = artifact.get("checksum")
            integrity_error = (
                expected_size is not None and path.stat().st_size != expected_size
            ) or (
                expected_checksum is not None
                and _sha256_file(path) != expected_checksum
            )
            if integrity_error:
                artifact.update(
                    {
                        "status": "failed",
                        "error": "文件完整性校验失败，请重新生成",
                    }
                )
                artifacts[artifact_key] = artifact
                self._store_artifacts(job, artifacts)
                if artifact_key == "final_bundle" and job.status == "complete":
                    self._transition(job, "base_ready")
                elif artifact_key in BASE_ARTIFACT_KEYS and job.status in {
                    "base_ready",
                    "complete",
                }:
                    self._transition(job, "partial_failed")
                job.updated_at = _utcnow()
                db.commit()
                raise AssetComparisonJobConflictError("文件完整性校验失败，请重试生成")
            return (
                path,
                artifact.get("filename") or path.name,
                artifact.get("contentType") or "application/octet-stream",
            )

    def recover_interrupted(self) -> None:
        requeue_job_ids = []
        failed_job_ids = []
        with self._lock, SessionLocal() as db:
            jobs = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.status.in_(
                        [
                            "queued",
                            "validating",
                            "running",
                            "base_ready",
                            "finalizing",
                            "cancel_requested",
                        ]
                    )
                )
                .all()
            )
            for job in jobs:
                if job.status == "base_ready":
                    if not self._has_comparison_snapshot(job):
                        self._transition(job, "partial_failed")
                        job.error_message = "服务重启前的核对结果未持久化，请重新核对"
                    continue
                if job.status == "cancel_requested":
                    artifacts = self._load_artifacts(job)
                    progress = _loads(job.progress_json, {})
                    results = normalize_module_results(_loads(job.results_json, []))
                    self._mark_cancelled_state(job, artifacts, progress, results)
                    self._store_artifacts(job, artifacts)
                    job.progress_json = _dumps(progress)
                    job.results_json = _dumps(results)
                    continue
                if job.status == "finalizing" and self._has_comparison_snapshot(job):
                    artifacts = self._load_artifacts(job)
                    artifacts["final_bundle"].update(
                        {
                            "status": "failed",
                            "error": "服务在完整导出期间重启，请重试完整导出",
                        }
                    )
                    self._store_artifacts(job, artifacts)
                    self._transition(job, "base_ready")
                    job.error_message = None
                    job.updated_at = _utcnow()
                    continue
                if not all(
                    Path(path).is_file() for path in self._resolved_inputs(job).values()
                ):
                    self._transition(job, "failed")
                    job.error_message = "服务重启后输入快照不完整，请重新扫描并创建任务"
                    job.updated_at = _utcnow()
                    failed_job_ids.append(job.id)
                    continue
                self._transition(job, "queued")
                job.results_json = _dumps(initial_module_results())
                self._store_artifacts(job, initial_artifacts())
                job.progress_json = _dumps(initial_progress())
                job.error_message = None
                job.started_at = None
                job.completed_at = None
                job.finalized_revision = None
                job.updated_at = _utcnow()
                requeue_job_ids.append(job.id)
            db.commit()
        for job_id in requeue_job_ids:
            self._log_stage(
                job_id=job_id,
                stage="job_recover",
                status="queued",
            )
            self._executor.submit(self._execute_worker, job_id)
        for job_id in failed_job_ids:
            self._log_stage(
                job_id=job_id,
                stage="job_recover",
                status="failed",
            )
        self.cleanup()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def cleanup(self) -> None:
        now = _utcnow()
        expired_job_files = []
        # 提交后再推送，避免持锁 publish；收集 (job_id, user_id, status)
        expired_notifies: list[tuple[str, int, str]] = []
        with self._lock, SessionLocal() as db:
            active_expired = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.expires_at <= now,
                    AssetComparisonJob.status.in_(JOB_ACTIVE_STATUSES),
                )
                .all()
            )
            for job in active_expired:
                job.expires_at = now + timedelta(
                    hours=settings.ASSET_COMPARISON_JOB_TTL_HOURS
                )
                self._artifact_store.ensure_task(
                    user_id=job.user_id,
                    tool=TASK_TOOL,
                    task_id=job.id,
                    expires_at=job.expires_at.replace(tzinfo=UTC).timestamp(),
                    metadata={"client_request_id": job.client_request_id},
                )

            expired = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.expires_at <= now,
                    AssetComparisonJob.status.notin_(JOB_ACTIVE_STATUSES),
                    AssetComparisonJob.status != "expired",
                )
                .all()
            )
            for job in expired:
                artifacts = self._load_artifacts(job)
                self._mark_expired_state(job, artifacts)
                self._store_artifacts(job, artifacts)
                expired_job_files.append((job.user_id, job.id))
                expired_notifies.append((job.id, job.user_id, job.status))

            terminal_jobs = (
                db.query(AssetComparisonJob)
                .filter(AssetComparisonJob.status.in_(RETAINED_JOB_STATUSES))
                .order_by(AssetComparisonJob.updated_at.desc())
                .all()
            )
            for job in terminal_jobs[settings.ASSET_COMPARISON_MAX_STORED_JOBS :]:
                self._delete_job_files(job.user_id, job.id)
                db.delete(job)
            db.commit()

        # 过期终态通知：前端已停轮询，需靠 job.terminal 刷新 UI
        for job_id, user_id, status in expired_notifies:
            self._notify_job(job_id=job_id, user_id=user_id, status=status)

        for user_id, job_id in expired_job_files:
            self._delete_job_files(user_id, job_id)
        self._cleanup_storage_limit()

    def _begin_execute(self, job_id: str) -> int | None:
        notify: tuple[str, int, str] | None = None
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                return None
            artifacts = self._load_artifacts(job)
            progress = _loads(job.progress_json, {})
            results = normalize_module_results(_loads(job.results_json, []))
            if job.status == "cancel_requested":
                self._mark_cancelled_state(job, artifacts, progress, results)
                self._store_artifacts(job, artifacts)
                job.progress_json = _dumps(progress)
                job.results_json = _dumps(results)
                db.commit()
                notify = (job.id, job.user_id, job.status)
                user_id = None
            elif job.status != "queued":
                return None
            else:
                self._transition(job, "validating")
                job.started_at = _utcnow()
                job.error_message = None
                job.progress_json = _dumps(
                    calculate_progress(
                        results,
                        artifacts,
                        validation_status="running",
                    )
                )
                db.commit()
                self._log_stage(
                    job_id=job.id,
                    user_id=job.user_id,
                    stage="job_validate_inputs",
                    status="running",
                )
                notify = (job.id, job.user_id, job.status)
                user_id = job.user_id
        if notify is not None:
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])
        return user_id

    def _finish_cancel_if_requested(self, job_id: str) -> bool:
        notify: tuple[str, int, str] | None = None
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                return True
            if job.status == "cancelled":
                return True
            if job.status != "cancel_requested":
                return False
            artifacts = self._load_artifacts(job)
            progress = _loads(job.progress_json, {})
            results = normalize_module_results(_loads(job.results_json, []))
            self._mark_cancelled_state(job, artifacts, progress, results)
            self._store_artifacts(job, artifacts)
            job.progress_json = _dumps(progress)
            job.results_json = _dumps(results)
            job.updated_at = _utcnow()
            db.commit()
            notify = (job.id, job.user_id, job.status)
            self._log_stage(
                job_id=job.id,
                user_id=job.user_id,
                stage="job_cancel",
                status="cancelled",
            )
        if notify is not None:
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])
        return True

    def _execute_worker(self, job_id: str) -> None:
        stage_started_at = perf_counter()
        user_id = self._begin_execute(job_id)
        if user_id is None:
            return
        try:
            inputs = self._job_inputs(job_id)
            input_validation_started_at = perf_counter()
            try:
                self._verify_input_snapshot(job_id, inputs)
            except Exception:
                self._log_stage(
                    job_id=job_id,
                    user_id=user_id,
                    stage="job_validate_input_fingerprint",
                    status="failed",
                    elapsed=perf_counter() - input_validation_started_at,
                )
                raise
            self._log_stage(
                job_id=job_id,
                user_id=user_id,
                stage="job_validate_input_fingerprint",
                status="ready",
                elapsed=perf_counter() - input_validation_started_at,
            )
            job_dir = self._job_dir_for_id(job_id)
            job_dir.mkdir(parents=True, exist_ok=True)
            self._execute_job(
                job_id,
                inputs,
                job_dir,
                lambda event, **payload: self._handle_event(job_id, event, payload),
                lambda: self._is_cancel_requested(job_id),
            )
            if self._finish_cancel_if_requested(job_id):
                return
            self._refresh_overall_status(job_id)
            self._log_stage(
                job_id=job_id,
                user_id=user_id,
                stage="job_total",
                status="ready",
                elapsed=perf_counter() - stage_started_at,
            )
        except Exception as exc:
            if self._finish_cancel_if_requested(job_id):
                return
            logger.exception(f"asset job failed: job_id={job_id} error={exc}")
            self._mark_job_failed(job_id, str(exc))
            self._log_stage(
                job_id=job_id,
                user_id=user_id,
                stage="job_total",
                status="failed",
                elapsed=perf_counter() - stage_started_at,
            )

    def _finalize_worker(
        self,
        job_id: str,
        revision: int,
        remarks: dict[str, str],
        reviews: dict[str, str],
    ) -> None:
        stage_started_at = perf_counter()
        try:
            if self._finish_cancel_if_requested(job_id):
                return
            job_dir = self._job_dir_for_id(job_id)
            artifact = self._finalize_job(
                job_id,
                job_dir,
                remarks,
                reviews,
                lambda: self._is_cancel_requested(job_id),
            )
            if self._finish_cancel_if_requested(job_id):
                return
            self._handle_event(
                job_id,
                "artifact_ready",
                {
                    "artifact_key": "final_bundle",
                    **artifact,
                    "annotation_revision": revision,
                },
            )
            with self._lock, SessionLocal() as db:
                job = db.get(AssetComparisonJob, job_id)
                if job is None:
                    return
                job.finalized_revision = revision
                if job.annotation_revision == revision:
                    self._transition(job, "complete")
                else:
                    artifacts = self._load_artifacts(job)
                    artifacts["final_bundle"]["status"] = "stale"
                    self._store_artifacts(job, artifacts)
                    self._transition(job, "base_ready")
                job.completed_at = _utcnow()
                job.updated_at = _utcnow()
                db.commit()
                notify = (job.id, job.user_id, job.status)
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])
            self._log_stage(
                job_id=job_id,
                stage="job_finalize",
                status="ready",
                elapsed=perf_counter() - stage_started_at,
                size_bytes=artifact.get("size_bytes"),
                annotation_revision=revision,
            )
        except Exception as exc:
            if self._finish_cancel_if_requested(job_id):
                return
            logger.exception(f"asset finalize failed: job_id={job_id} error={exc}")
            self._handle_event(
                job_id,
                "artifact_failed",
                {"artifact_key": "final_bundle", "error": str(exc)},
            )
            self._refresh_overall_status(job_id)
            self._log_stage(
                job_id=job_id,
                stage="job_finalize",
                status="failed",
                elapsed=perf_counter() - stage_started_at,
                annotation_revision=revision,
            )

    def _retry_worker(self, job_id: str, artifact_key: str) -> None:
        stage_started_at = perf_counter()
        try:
            if self._finish_cancel_if_requested(job_id):
                return
            inputs = self._job_inputs(job_id)
            job_dir = self._job_dir_for_id(job_id)
            artifact = self._retry_artifact(
                job_id,
                artifact_key,
                job_dir,
                inputs,
            )
            if self._finish_cancel_if_requested(job_id):
                return
            comparison_result = artifact.pop("_comparison_result", None)
            if comparison_result is not None:
                self._handle_event(
                    job_id,
                    "comparison_ready",
                    {"result": comparison_result},
                )
            self._handle_event(
                job_id,
                "artifact_ready",
                {"artifact_key": artifact_key, **artifact},
            )
            self._log_stage(
                job_id=job_id,
                stage="job_retry_artifact",
                status="ready",
                artifact_key=artifact_key,
                elapsed=perf_counter() - stage_started_at,
                size_bytes=artifact.get("size_bytes"),
            )
        except Exception as exc:
            if self._finish_cancel_if_requested(job_id):
                return
            self._handle_event(
                job_id,
                "artifact_failed",
                {"artifact_key": artifact_key, "error": str(exc)},
            )
            self._log_stage(
                job_id=job_id,
                stage="job_retry_artifact",
                status="failed",
                artifact_key=artifact_key,
                elapsed=perf_counter() - stage_started_at,
            )
        self._refresh_overall_status(job_id)

    def _handle_event(self, job_id: str, event: str, payload: dict) -> None:
        if self._is_cancel_requested(job_id):
            return

        def mutate(job, artifacts, progress, results):
            if job.status in {"cancel_requested", "cancelled", "expired"}:
                return
            if event == "validation_ready":
                self._transition(job, "running")
                progress["validation"] = {"status": "ready"}
            elif event == "comparison_started":
                key = payload["module_key"]
                result = next(item for item in results if item["key"] == key)
                result.update({"status": "running", "msg": "核对中"})
            elif event in {"comparison_ready", "comparison_failed"}:
                result = dict(payload["result"])
                result["status"] = "ready" if event == "comparison_ready" else "failed"
                result.setdefault("label", MODULE_BY_KEY[result["key"]].label)
                result_index = MODULE_ORDER.index(result["key"])
                results[result_index] = result
                if event == "comparison_failed":
                    artifacts[f"module_{result['key']}"] = {
                        "status": "failed",
                        "moduleKey": result["key"],
                        "error": result.get("msg", "核对失败"),
                    }
            elif event == "artifact_building":
                artifact_key = payload["artifact_key"]
                artifacts[artifact_key]["status"] = "building"
                artifacts[artifact_key].pop("error", None)
            elif event == "artifact_ready":
                artifact_key = payload["artifact_key"]
                artifact = artifacts.setdefault(artifact_key, {})
                artifact.update(
                    {
                        "status": "ready",
                        "path": payload["path"],
                        "filename": payload["filename"],
                        "contentType": payload["content_type"],
                        "sizeBytes": payload["size_bytes"],
                        "checksum": payload.get("checksum"),
                    }
                )
                if "annotation_revision" in payload:
                    artifact["annotationRevision"] = payload["annotation_revision"]
            elif event == "artifact_failed":
                artifact_key = payload["artifact_key"]
                artifact = artifacts.setdefault(artifact_key, {})
                artifact.update({"status": "failed", "error": payload["error"]})

        self._mutate(job_id, mutate)
        event_status = {
            "validation_ready": "ready",
            "comparison_started": "running",
            "comparison_ready": "ready",
            "comparison_failed": "failed",
            "artifact_building": "building",
            "artifact_ready": "ready",
            "artifact_failed": "failed",
        }.get(event, event)
        result = payload.get("result", {})
        artifact_key = payload.get("artifact_key")
        if event.startswith("artifact_"):
            if artifact_key == "raw_data_xlsx":
                log_stage = "job_build_raw_workbook"
            elif artifact_key == "final_bundle":
                log_stage = "job_build_zip"
            else:
                log_stage = "job_build_module_artifact"
        else:
            log_stage = {
                "validation_ready": "job_validate_inputs",
                "comparison_started": "job_run_comparison",
                "comparison_ready": "job_run_comparison",
                "comparison_failed": "job_run_comparison",
            }.get(event, event)
        self._log_stage(
            job_id=job_id,
            stage=log_stage,
            status=event_status,
            module_key=(
                payload.get("module_key")
                or result.get("key")
                or (
                    artifact_key.removeprefix("module_")
                    if artifact_key and artifact_key.startswith("module_")
                    else None
                )
            ),
            artifact_key=artifact_key,
            elapsed=payload.get("elapsed"),
            size_bytes=payload.get("size_bytes"),
        )

    def _mutate(self, job_id: str, mutator: Callable) -> None:
        notify: tuple[str, int, str] | None = None
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                return
            artifacts = self._load_artifacts(job)
            progress = _loads(job.progress_json, {})
            results = normalize_module_results(_loads(job.results_json, []))
            mutator(job, artifacts, progress, results)
            progress = calculate_progress(
                results,
                artifacts,
                validation_status=progress.get("validation", {}).get(
                    "status", "pending"
                ),
            )
            self._store_artifacts(job, artifacts)
            job.progress_json = _dumps(progress)
            job.results_json = _dumps(results)
            job.updated_at = _utcnow()
            db.commit()
            notify = (job.id, job.user_id, job.status)
        if notify is not None:
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])

    def _refresh_overall_status(self, job_id: str) -> None:
        notify: tuple[str, int, str] | None = None
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None or job.status in {
                "cancelled",
                "cancel_requested",
                "expired",
            }:
                return
            artifacts = self._load_artifacts(job)
            results = normalize_module_results(_loads(job.results_json, []))
            next_status = derive_job_status(results, artifacts)
            if job.status != "complete":
                self._transition(job, next_status)
                final_artifact = artifacts.get("final_bundle", {})
                if (
                    next_status == "base_ready"
                    and final_artifact.get("status") == "ready"
                    and job.finalized_revision == job.annotation_revision
                ):
                    self._transition(job, "complete")
            progress = _loads(job.progress_json, {})
            job.progress_json = _dumps(
                calculate_progress(
                    results,
                    artifacts,
                    validation_status=progress.get("validation", {}).get(
                        "status", "pending"
                    ),
                )
            )
            job.updated_at = _utcnow()
            db.commit()
            notify = (job.id, job.user_id, job.status)
        if notify is not None:
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])

    def _mark_job_failed(self, job_id: str, message: str) -> None:
        notify: tuple[str, int, str] | None = None
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                return
            if job.status == "cancel_requested":
                artifacts = self._load_artifacts(job)
                progress = _loads(job.progress_json, {})
                results = normalize_module_results(_loads(job.results_json, []))
                self._mark_cancelled_state(job, artifacts, progress, results)
                self._store_artifacts(job, artifacts)
                job.progress_json = _dumps(progress)
                job.results_json = _dumps(results)
                db.commit()
                notify = (job.id, job.user_id, job.status)
            else:
                self._transition(job, "failed")
                job.error_message = message
                job.updated_at = _utcnow()
                db.commit()
                notify = (job.id, job.user_id, job.status)
        if notify is not None:
            self._notify_job(job_id=notify[0], user_id=notify[1], status=notify[2])

    def _mark_cancelled_state(
        self,
        job: AssetComparisonJob,
        artifacts: dict,
        progress: dict,
        results: list[dict],
    ) -> None:
        for result in results:
            if result.get("status") == "running":
                result.update({"status": "pending", "msg": "任务已取消"})
        for artifact in artifacts.values():
            if artifact.get("status") in {"pending", "building"}:
                artifact.update({"status": "blocked", "error": "任务已取消"})
        self._transition(job, "cancelled")
        job.completed_at = _utcnow()
        validation_status = progress.get("validation", {}).get("status", "pending")
        if validation_status == "running":
            validation_status = "cancelled"
        progress.clear()
        progress.update(
            calculate_progress(
                results,
                artifacts,
                validation_status=validation_status,
            )
        )

    def _mark_expired_state(
        self,
        job: AssetComparisonJob,
        artifacts: dict,
    ) -> None:
        self._transition(job, "expired")
        for artifact in artifacts.values():
            artifact["status"] = "expired"
            artifact.pop("downloadUrl", None)
        job.error_message = "核对任务已过期"
        job.updated_at = _utcnow()

    def _log_stage(
        self,
        *,
        job_id: str,
        stage: str,
        status: str,
        user_id: int | None = None,
        module_key: str | None = None,
        artifact_key: str | None = None,
        elapsed: float | None = None,
        size_bytes: int | None = None,
        annotation_revision: int | None = None,
    ) -> None:
        if user_id is None or annotation_revision is None:
            with SessionLocal() as db:
                job = db.get(AssetComparisonJob, job_id)
                if job is not None:
                    user_id = user_id if user_id is not None else job.user_id
                    annotation_revision = (
                        annotation_revision
                        if annotation_revision is not None
                        else job.annotation_revision
                    )
        logger.bind(
            job_id=job_id,
            user_id=user_id,
            module_key=module_key,
            artifact_key=artifact_key,
            stage=stage,
            elapsed=elapsed,
            status=status,
            size_bytes=size_bytes,
            annotation_revision=annotation_revision,
        ).info(
            "asset_comparison job_id={} user_id={} module_key={} "
            "artifact_key={} stage={} elapsed={} status={} size_bytes={} "
            "annotation_revision={}",
            job_id,
            user_id if user_id is not None else "-",
            module_key or "-",
            artifact_key or "-",
            stage,
            f"{elapsed:.3f}s" if elapsed is not None else "-",
            status,
            size_bytes if size_bytes is not None else "-",
            (annotation_revision if annotation_revision is not None else "-"),
        )

    @staticmethod
    def _load_artifacts(job: AssetComparisonJob) -> dict:
        if job.artifact_records:
            artifacts = {}
            for record in job.artifact_records:
                artifact = {
                    "status": record.status,
                }
                if record.module_key:
                    artifact["moduleKey"] = record.module_key
                optional_values = {
                    "path": record.relative_path,
                    "filename": record.filename,
                    "contentType": record.content_type,
                    "sizeBytes": record.size_bytes,
                    "checksum": record.checksum,
                    "annotationRevision": record.annotation_revision,
                    "error": record.error_message,
                }
                artifact.update(
                    {
                        key: value
                        for key, value in optional_values.items()
                        if value is not None
                    }
                )
                artifacts[record.artifact_key] = artifact
            return artifacts

        legacy_artifacts = _loads(job.artifacts_json, {})
        return legacy_artifacts or initial_artifacts()

    @staticmethod
    def _store_artifacts(job: AssetComparisonJob, artifacts: dict) -> None:
        records = {record.artifact_key: record for record in job.artifact_records}
        for artifact_key, artifact in artifacts.items():
            record = records.get(artifact_key)
            if record is None:
                record = AssetComparisonArtifact(
                    artifact_key=artifact_key,
                )
                job.artifact_records.append(record)
                records[artifact_key] = record
            record.module_key = artifact.get("moduleKey")
            record.status = artifact.get("status", "blocked")
            record.relative_path = artifact.get("path")
            record.filename = artifact.get("filename")
            record.content_type = artifact.get("contentType")
            record.size_bytes = artifact.get("sizeBytes")
            record.checksum = artifact.get("checksum")
            record.annotation_revision = artifact.get("annotationRevision")
            record.error_message = artifact.get("error")
            record.updated_at = _utcnow()

    def _serialize(self, job: AssetComparisonJob) -> dict:
        results = normalize_module_results(_loads(job.results_json, []))
        artifacts = self._load_artifacts(job)
        remarks = _loads(job.remarks_json, {})
        reviews = _loads(job.reviews_json, {})
        missing_remarks = [
            result["key"]
            for result in results
            if result.get("status") == "ready"
            and result.get("has_diff")
            and not remarks.get(result["key"], "").strip()
        ]
        pending_results = len(results) < len(MODULE_ORDER) or any(
            result.get("status") != "ready" for result in results
        )
        base_not_ready = [
            key
            for key in BASE_ARTIFACT_KEYS
            if artifacts.get(key, {}).get("status") != "ready"
        ]
        blockers = []
        if job.status not in {"base_ready", "complete"}:
            blockers.append(
                {
                    "code": "job_not_finalizable",
                    "message": {
                        "cancelled": "任务已取消",
                        "cancel_requested": "任务正在取消",
                        "expired": "任务已过期",
                        "failed": "任务执行失败",
                        "finalizing": "完整导出正在生成",
                        "partial_failed": "部分核对或文件生成失败",
                    }.get(job.status, "任务尚未进入可导出状态"),
                }
            )
        if pending_results:
            blockers.append(
                {
                    "code": "comparison_not_ready",
                    "message": "资产核对尚未全部完成",
                }
            )
        if base_not_ready:
            blockers.append(
                {
                    "code": "artifacts_not_ready",
                    "message": f"仍有 {len(base_not_ready)} 份基础文件未完成",
                    "artifactKeys": base_not_ready,
                }
            )
        if missing_remarks:
            blockers.append(
                {
                    "code": "missing_remarks",
                    "message": f"请填写 {len(missing_remarks)} 项异常原因",
                    "moduleKeys": missing_remarks,
                }
            )
        if job.status in {
            "base_ready",
            "partial_failed",
        } and not self._has_comparison_snapshot(job):
            blockers.append(
                {
                    "code": "comparison_snapshot_unavailable",
                    "message": "核对结果快照不存在，请重新核对",
                }
            )

        artifact_views = {}
        for key, artifact in artifacts.items():
            view = dict(artifact)
            if view.get("status") == "ready":
                view["downloadUrl"] = (
                    f"/api/v1/tools/asset/jobs/{job.id}/artifacts/{key}"
                )
            artifact_views[key] = view

        return {
            "jobId": job.id,
            "status": job.status,
            "inputs": self._resolved_inputs(job),
            "inputFingerprint": self._input_fingerprint(job),
            "results": results,
            "artifacts": artifact_views,
            "remarks": remarks,
            "reviews": reviews,
            "annotationRevision": job.annotation_revision,
            "finalizedRevision": job.finalized_revision,
            "progress": calculate_progress(
                results,
                artifacts,
                validation_status=_loads(job.progress_json, {})
                .get("validation", {})
                .get("status", "pending"),
            ),
            "canFinalize": not blockers,
            "finalizeBlockers": blockers,
            "error": job.error_message,
            "createdAt": job.created_at.isoformat() if job.created_at else None,
            "updatedAt": job.updated_at.isoformat() if job.updated_at else None,
            "expiresAt": job.expires_at.isoformat() if job.expires_at else None,
        }

    def _get_owned_job(self, db, user_id: int, job_id: str) -> AssetComparisonJob:
        job = db.get(AssetComparisonJob, job_id)
        if job is None or job.user_id != user_id:
            raise AssetComparisonJobNotFoundError
        if job.status == "expired":
            raise AssetComparisonJobExpiredError
        if job.expires_at <= _utcnow():
            if job.status in JOB_ACTIVE_STATUSES:
                job.expires_at = _utcnow() + timedelta(
                    hours=settings.ASSET_COMPARISON_JOB_TTL_HOURS
                )
                self._artifact_store.ensure_task(
                    user_id=job.user_id,
                    tool=TASK_TOOL,
                    task_id=job.id,
                    expires_at=job.expires_at.replace(tzinfo=UTC).timestamp(),
                    metadata={"client_request_id": job.client_request_id},
                )
                db.commit()
            else:
                artifacts = self._load_artifacts(job)
                self._mark_expired_state(job, artifacts)
                self._store_artifacts(job, artifacts)
                db.commit()
                self._delete_job_files(job.user_id, job.id)
                raise AssetComparisonJobExpiredError
        return job

    def _job_inputs(self, job_id: str) -> dict[str, str]:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                raise AssetComparisonJobNotFoundError
            return self._resolved_inputs(job)

    def _verify_input_snapshot(
        self,
        job_id: str,
        inputs: dict[str, str],
    ) -> None:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                raise AssetComparisonJobNotFoundError
            snapshot = _loads(job.input_json, {})
            files = snapshot.get("files") if isinstance(snapshot, dict) else None
        if not isinstance(files, dict):
            return
        invalid_keys = []
        for key, file_info in files.items():
            path_value = inputs.get(key)
            path = Path(path_value) if path_value else None
            if (
                path is None
                or not path.is_file()
                or path.stat().st_size != file_info.get("sizeBytes")
                or _sha256_file(path) != file_info.get("sha256")
            ):
                invalid_keys.append(key)
        if invalid_keys:
            raise AssetComparisonJobValidationError(
                f"输入快照已改变: {', '.join(invalid_keys)}"
            )

    def _resolved_inputs(self, job: AssetComparisonJob) -> dict[str, str]:
        snapshot = _loads(job.input_json, {})
        files = snapshot.get("files") if isinstance(snapshot, dict) else None
        if not isinstance(files, dict):
            return snapshot
        resolved = {}
        for key, file_info in files.items():
            relative_path = file_info.get("relativePath")
            if not relative_path:
                continue
            resolved[key] = str(
                self._artifact_store.resolve_task_path(
                    user_id=job.user_id,
                    tool=TASK_TOOL,
                    task_id=job.id,
                    relative_path=relative_path,
                )
            )
        return resolved

    @staticmethod
    def _input_fingerprint(job: AssetComparisonJob) -> str | None:
        snapshot = _loads(job.input_json, {})
        if not isinstance(snapshot, dict):
            return None
        return snapshot.get("fingerprint")

    def _job_dir_for_id(self, job_id: str) -> Path:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                raise AssetComparisonJobNotFoundError
            return self._artifact_store.ensure_task(
                user_id=job.user_id,
                tool=TASK_TOOL,
                task_id=job.id,
                expires_at=job.expires_at.replace(tzinfo=UTC).timestamp(),
                metadata={"client_request_id": job.client_request_id},
            )

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            return job is None or job.status in {
                "cancel_requested",
                "cancelled",
                "expired",
            }

    def _job_dir(self, user_id: int, job_id: str) -> Path:
        return self._artifact_store.task_dir(
            user_id=user_id,
            tool=TASK_TOOL,
            task_id=job_id,
        )

    def _has_comparison_snapshot(self, job: AssetComparisonJob) -> bool:
        return comparison_snapshot_exists(self._job_dir(job.user_id, job.id))

    def _delete_job_files(
        self,
        user_id: int,
        job_id: str,
        *,
        ignore_errors: bool = True,
    ) -> None:
        self._artifact_store.delete_task(
            user_id=user_id,
            tool=TASK_TOOL,
            task_id=job_id,
            ignore_errors=ignore_errors,
        )

    def _cleanup_storage_limit(self) -> None:
        with self._lock, SessionLocal() as db:
            jobs = (
                db.query(AssetComparisonJob)
                .filter(AssetComparisonJob.status.in_(RETAINED_JOB_STATUSES))
                .order_by(AssetComparisonJob.updated_at.asc())
                .all()
            )
            sizes = {}
            for job in jobs:
                sizes[job.id] = self._artifact_store.task_size(
                    user_id=job.user_id,
                    tool=TASK_TOOL,
                    task_id=job.id,
                )
            total_size = sum(sizes.values())
            for job in jobs:
                if total_size <= settings.ASSET_COMPARISON_MAX_STORAGE_BYTES:
                    break
                total_size -= sizes[job.id]
                self._delete_job_files(job.user_id, job.id)
                db.delete(job)
            db.commit()

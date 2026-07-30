from __future__ import annotations

import json
import shutil
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from loguru import logger

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.asset_comparison_job import AssetComparisonJob

MODULE_ORDER = ["ff", "sfc", "nn", "cc", "fn", "ns", "cn"]
BASE_ARTIFACT_KEYS = [*(f"module_{key}" for key in MODULE_ORDER), "raw_data_xlsx"]
REVIEW_VALUES = {"差異確認OK", "待跟进", "異常"}


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


def _initial_artifacts() -> dict:
    return {
        **{
            f"module_{key}": {
                "status": "blocked",
                "moduleKey": key,
            }
            for key in MODULE_ORDER
        },
        "raw_data_xlsx": {"status": "blocked"},
        "final_bundle": {"status": "blocked"},
    }


def _initial_progress() -> dict:
    return {
        "validation": {"status": "pending"},
        "comparison": {"completed": 0, "total": len(MODULE_ORDER)},
        "moduleArtifacts": {"completed": 0, "total": len(MODULE_ORDER)},
        "rawData": {"status": "blocked"},
    }


class AssetComparisonJobManager:
    """管理资产核对任务、状态转换和产物生命周期。"""

    def __init__(
        self,
        *,
        execute_job: Callable,
        finalize_job: Callable,
        retry_artifact: Callable,
    ) -> None:
        self._execute_job = execute_job
        self._finalize_job = finalize_job
        self._retry_artifact = retry_artifact
        self._artifact_root = Path(settings.ASSET_COMPARISON_ARTIFACT_ROOT)
        self._artifact_root.mkdir(parents=True, exist_ok=True)
        self._executor = ThreadPoolExecutor(
            max_workers=max(settings.ASSET_COMPARISON_MAX_ACTIVE_JOBS, 1),
            thread_name_prefix="asset-comparison-job",
        )
        self._runtime: dict[str, Any] = {}
        self._lock = threading.RLock()

    def create_job(
        self,
        *,
        user_id: int,
        client_request_id: str,
        inputs: dict[str, str],
    ) -> tuple[dict, bool]:
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
                return self._serialize(existing), True

            now = _utcnow()
            job_id = str(uuid.uuid4())
            job = AssetComparisonJob(
                id=job_id,
                user_id=user_id,
                client_request_id=client_request_id,
                status="queued",
                input_json=_dumps(inputs),
                results_json="[]",
                artifacts_json=_dumps(_initial_artifacts()),
                remarks_json="{}",
                reviews_json="{}",
                progress_json=_dumps(_initial_progress()),
                expires_at=now
                + timedelta(hours=settings.ASSET_COMPARISON_JOB_TTL_HOURS),
            )
            db.add(job)
            db.commit()
            db.refresh(job)
            response = self._serialize(job)

        self._executor.submit(self._execute_worker, job_id)
        return response, False

    def get_job(self, *, user_id: int, job_id: str) -> dict:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            return self._serialize(job)

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
            if job.annotation_revision != expected_revision:
                raise AssetComparisonJobConflictError("备注已被更新，请刷新后重试")

            job.remarks_json = _dumps(normalized_remarks)
            job.reviews_json = _dumps(normalized_reviews)
            job.annotation_revision += 1
            job.updated_at = _utcnow()

            artifacts = _loads(job.artifacts_json, {})
            final_artifact = artifacts.get("final_bundle", {})
            if final_artifact.get("status") == "ready":
                final_artifact["status"] = "stale"
                artifacts["final_bundle"] = final_artifact
                job.artifacts_json = _dumps(artifacts)
                if job.status == "complete":
                    job.status = "base_ready"

            db.commit()
            db.refresh(job)
            return self._serialize(job)

    def finalize(self, *, user_id: int, job_id: str) -> dict:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            response = self._serialize(job)
            blockers = response["finalizeBlockers"]
            if blockers:
                raise AssetComparisonJobValidationError(
                    "；".join(blocker["message"] for blocker in blockers)
                )

            artifacts = _loads(job.artifacts_json, {})
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
            job.artifacts_json = _dumps(artifacts)
            job.status = "finalizing"
            job.updated_at = _utcnow()
            revision = job.annotation_revision
            remarks = _loads(job.remarks_json, {})
            reviews = _loads(job.reviews_json, {})
            db.commit()

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
            artifacts = _loads(job.artifacts_json, {})
            artifact = artifacts.get(artifact_key, {})
            if artifact.get("status") not in {"failed", "stale"}:
                raise AssetComparisonJobConflictError("当前产物不需要重试")
            if job_id not in self._runtime:
                raise AssetComparisonJobConflictError("任务运行数据已失效，请重新核对")
            artifact["status"] = "building"
            artifact.pop("error", None)
            artifacts[artifact_key] = artifact
            job.artifacts_json = _dumps(artifacts)
            job.status = "running"
            job.updated_at = _utcnow()
            db.commit()

        self._executor.submit(self._retry_worker, job_id, artifact_key)
        return self.get_job(user_id=user_id, job_id=job_id)

    def cancel(self, *, user_id: int, job_id: str) -> dict:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            if job.status in {"complete", "failed", "cancelled", "expired"}:
                return self._serialize(job)
            job.status = "cancel_requested"
            job.updated_at = _utcnow()
            db.commit()
            db.refresh(job)
            return self._serialize(job)

    def open_artifact(
        self,
        *,
        user_id: int,
        job_id: str,
        artifact_key: str,
    ) -> tuple[Path, str, str]:
        with self._lock, SessionLocal() as db:
            job = self._get_owned_job(db, user_id, job_id)
            artifacts = _loads(job.artifacts_json, {})
            artifact = artifacts.get(artifact_key)
            if artifact is None:
                raise AssetComparisonJobNotFoundError
            if artifact.get("status") != "ready":
                raise AssetComparisonJobConflictError("文件尚未生成或已经失效")
            relative_path = artifact.get("path")
            if not relative_path:
                raise AssetComparisonJobNotFoundError

            job_dir = self._job_dir(job.user_id, job.id).resolve()
            path = (job_dir / relative_path).resolve()
            if job_dir not in path.parents or not path.is_file():
                raise AssetComparisonJobNotFoundError
            return (
                path,
                artifact.get("filename") or path.name,
                artifact.get("contentType") or "application/octet-stream",
            )

    def recover_interrupted(self) -> None:
        requeue_job_ids = []
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
                    job.status = "partial_failed"
                    job.error_message = "服务已重启，可下载已有文件；完整导出需重新核对"
                    continue
                if job.status == "cancel_requested":
                    job.status = "cancelled"
                    continue
                job.status = "queued"
                job.results_json = "[]"
                job.artifacts_json = _dumps(_initial_artifacts())
                job.progress_json = _dumps(_initial_progress())
                job.error_message = None
                job.started_at = None
                job.completed_at = None
                job.finalized_revision = None
                job.updated_at = _utcnow()
                requeue_job_ids.append(job.id)
            db.commit()
        for job_id in requeue_job_ids:
            self._executor.submit(self._execute_worker, job_id)
        self.cleanup()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def cleanup(self) -> None:
        now = _utcnow()
        with self._lock, SessionLocal() as db:
            expired = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.expires_at <= now,
                    AssetComparisonJob.status.notin_(
                        ["queued", "validating", "running", "finalizing"]
                    ),
                )
                .all()
            )
            for job in expired:
                self._delete_job_files(job.user_id, job.id)
                self._runtime.pop(job.id, None)
                db.delete(job)

            terminal_jobs = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.status.in_(
                        ["base_ready", "complete", "partial_failed", "failed"]
                    )
                )
                .order_by(AssetComparisonJob.updated_at.desc())
                .all()
            )
            for job in terminal_jobs[settings.ASSET_COMPARISON_MAX_STORED_JOBS :]:
                self._delete_job_files(job.user_id, job.id)
                self._runtime.pop(job.id, None)
                db.delete(job)
            db.commit()

        self._cleanup_storage_limit()

    def _execute_worker(self, job_id: str) -> None:
        started_at = _utcnow()
        try:
            self._mutate(
                job_id,
                lambda job, _artifacts, progress, _results: (
                    setattr(job, "status", "validating"),
                    setattr(job, "started_at", started_at),
                    progress.update({"validation": {"status": "running"}}),
                ),
            )
            inputs = self._job_inputs(job_id)
            job_dir = self._job_dir_for_id(job_id)
            job_dir.mkdir(parents=True, exist_ok=True)
            runtime = self._execute_job(
                job_id,
                inputs,
                job_dir,
                lambda event, **payload: self._handle_event(job_id, event, payload),
                lambda: self._is_cancel_requested(job_id),
            )
            self._runtime[job_id] = runtime
            if self._is_cancel_requested(job_id):
                self._mutate(
                    job_id,
                    lambda job, _a, _p, _r: setattr(job, "status", "cancelled"),
                )
                return
            self._refresh_overall_status(job_id)
        except Exception as exc:
            logger.exception(f"asset job failed: job_id={job_id} error={exc}")
            self._mark_job_failed(job_id, str(exc))

    def _finalize_worker(
        self,
        job_id: str,
        revision: int,
        remarks: dict[str, str],
        reviews: dict[str, str],
    ) -> None:
        try:
            runtime = self._runtime.get(job_id)
            if runtime is None:
                raise RuntimeError("任务运行数据已失效，请重新核对")
            job_dir = self._job_dir_for_id(job_id)
            artifact = self._finalize_job(
                job_id,
                runtime,
                job_dir,
                remarks,
                reviews,
            )
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
                    job.status = "complete"
                else:
                    artifacts = _loads(job.artifacts_json, {})
                    artifacts["final_bundle"]["status"] = "stale"
                    job.artifacts_json = _dumps(artifacts)
                    job.status = "base_ready"
                job.completed_at = _utcnow()
                job.updated_at = _utcnow()
                db.commit()
        except Exception as exc:
            logger.exception(f"asset finalize failed: job_id={job_id} error={exc}")
            self._handle_event(
                job_id,
                "artifact_failed",
                {"artifact_key": "final_bundle", "error": str(exc)},
            )
            self._refresh_overall_status(job_id)

    def _retry_worker(self, job_id: str, artifact_key: str) -> None:
        try:
            runtime = self._runtime[job_id]
            job_dir = self._job_dir_for_id(job_id)
            artifact = self._retry_artifact(
                job_id,
                artifact_key,
                runtime,
                job_dir,
            )
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
        except Exception as exc:
            self._handle_event(
                job_id,
                "artifact_failed",
                {"artifact_key": artifact_key, "error": str(exc)},
            )
        self._refresh_overall_status(job_id)

    def _handle_event(self, job_id: str, event: str, payload: dict) -> None:
        def mutate(job, artifacts, progress, results):
            if event == "validation_ready":
                job.status = "running"
                progress["validation"] = {"status": "ready"}
            elif event == "comparison_started":
                key = payload["module_key"]
                artifacts[f"module_{key}"]["status"] = "blocked"
            elif event in {"comparison_ready", "comparison_failed"}:
                result = dict(payload["result"])
                result["status"] = "ready" if event == "comparison_ready" else "failed"
                results[:] = [
                    current
                    for current in results
                    if current.get("key") != result.get("key")
                ]
                results.append(result)
                progress["comparison"]["completed"] = len(results)
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
                if artifact_key == "raw_data_xlsx":
                    progress["rawData"] = {"status": "building"}
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
                    }
                )
                if "annotation_revision" in payload:
                    artifact["annotationRevision"] = payload["annotation_revision"]
                if artifact_key == "raw_data_xlsx":
                    progress["rawData"] = {"status": "ready"}
                elif artifact_key.startswith("module_"):
                    progress["moduleArtifacts"]["completed"] = sum(
                        1
                        for key in MODULE_ORDER
                        if artifacts.get(f"module_{key}", {}).get("status") == "ready"
                    )
            elif event == "artifact_failed":
                artifact_key = payload["artifact_key"]
                artifact = artifacts.setdefault(artifact_key, {})
                artifact.update({"status": "failed", "error": payload["error"]})
                if artifact_key == "raw_data_xlsx":
                    progress["rawData"] = {
                        "status": "failed",
                        "error": payload["error"],
                    }

        self._mutate(job_id, mutate)

    def _mutate(self, job_id: str, mutator: Callable) -> None:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                return
            artifacts = _loads(job.artifacts_json, {})
            progress = _loads(job.progress_json, {})
            results = _loads(job.results_json, [])
            mutator(job, artifacts, progress, results)
            results.sort(
                key=lambda item: (
                    MODULE_ORDER.index(item["key"])
                    if item.get("key") in MODULE_ORDER
                    else 99
                )
            )
            job.artifacts_json = _dumps(artifacts)
            job.progress_json = _dumps(progress)
            job.results_json = _dumps(results)
            job.updated_at = _utcnow()
            db.commit()

    def _refresh_overall_status(self, job_id: str) -> None:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None or job.status in {"cancelled", "cancel_requested"}:
                return
            artifacts = _loads(job.artifacts_json, {})
            base_statuses = [
                artifacts.get(key, {}).get("status") for key in BASE_ARTIFACT_KEYS
            ]
            if all(status == "ready" for status in base_statuses):
                if job.status != "complete":
                    job.status = "base_ready"
            elif any(status == "failed" for status in base_statuses):
                job.status = "partial_failed"
            else:
                job.status = "running"
            job.updated_at = _utcnow()
            db.commit()

    def _mark_job_failed(self, job_id: str, message: str) -> None:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                return
            job.status = "failed"
            job.error_message = message
            job.updated_at = _utcnow()
            db.commit()

    def _serialize(self, job: AssetComparisonJob) -> dict:
        results = _loads(job.results_json, [])
        artifacts = _loads(job.artifacts_json, {})
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
        if (
            job.id not in self._runtime
            and job.finalized_revision is None
            and job.status in {"base_ready", "partial_failed"}
        ):
            blockers.append(
                {
                    "code": "runtime_unavailable",
                    "message": "服务重启后运行数据已失效，请重新核对",
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
            "inputs": _loads(job.input_json, {}),
            "results": results,
            "artifacts": artifact_views,
            "remarks": remarks,
            "reviews": reviews,
            "annotationRevision": job.annotation_revision,
            "finalizedRevision": job.finalized_revision,
            "progress": _loads(job.progress_json, {}),
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
        if job.expires_at <= _utcnow():
            raise AssetComparisonJobExpiredError
        return job

    def _job_inputs(self, job_id: str) -> dict[str, str]:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                raise AssetComparisonJobNotFoundError
            return _loads(job.input_json, {})

    def _job_dir_for_id(self, job_id: str) -> Path:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            if job is None:
                raise AssetComparisonJobNotFoundError
            return self._job_dir(job.user_id, job.id)

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._lock, SessionLocal() as db:
            job = db.get(AssetComparisonJob, job_id)
            return job is None or job.status == "cancel_requested"

    def _job_dir(self, user_id: int, job_id: str) -> Path:
        return self._artifact_root / str(user_id) / job_id

    def _delete_job_files(self, user_id: int, job_id: str) -> None:
        shutil.rmtree(self._job_dir(user_id, job_id), ignore_errors=True)

    def _cleanup_storage_limit(self) -> None:
        with self._lock, SessionLocal() as db:
            jobs = (
                db.query(AssetComparisonJob)
                .filter(
                    AssetComparisonJob.status.in_(
                        ["base_ready", "complete", "partial_failed", "failed"]
                    )
                )
                .order_by(AssetComparisonJob.updated_at.asc())
                .all()
            )
            sizes = {}
            for job in jobs:
                job_dir = self._job_dir(job.user_id, job.id)
                sizes[job.id] = sum(
                    file.stat().st_size for file in job_dir.rglob("*") if file.is_file()
                )
            total_size = sum(sizes.values())
            for job in jobs:
                if total_size <= settings.ASSET_COMPARISON_MAX_STORAGE_BYTES:
                    break
                total_size -= sizes[job.id]
                self._delete_job_files(job.user_id, job.id)
                self._runtime.pop(job.id, None)
                db.delete(job)
            db.commit()

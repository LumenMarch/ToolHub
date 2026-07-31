import asyncio
from contextlib import suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
from starlette.formparsers import MultiPartParser

from app.api.api_router import api_router
from app.db.base_class import Base
from app.db.session import engine
from app.seed import run_seed

# 增大 Starlette multipart 上传限制（默认 max_part_size 仅 1MB，Excel 文件轻松超标）
MultiPartParser.max_part_size = 100 * 1024 * 1024  # 单个 part 最大 100MB

# Create database tables
Base.metadata.create_all(bind=engine)

# 写入默认权限与角色（幂等 — 已有数据时跳过）
run_seed()

app = FastAPI(
    title="ToolHub API",
    openapi_url="/api/v1/openapi.json",
)

# Configure CORS
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Content-Disposition",
        "Location",
        "Tus-Resumable",
        "Upload-Offset",
    ],
)

# Mount all API routes from the single API aggregator
app.include_router(api_router, prefix="/api/v1")

artifact_cleanup_task: asyncio.Task[None] | None = None


def cleanup_task_artifacts() -> None:
    """清理过期上传、任务产物，并按 TTL 和容量限制回收缓存。"""
    from app.api.endpoints.asset_comparison import asset_comparison_job_manager
    from app.services.task_artifacts import task_artifact_store
    from app.services.upload.store import UploadStore

    asset_comparison_job_manager.cleanup()
    UploadStore().cleanup_expired(max_age_hours=24)
    result = task_artifact_store.cleanup()
    logger.info(
        "task artifacts cleaned: expired_tasks={} expired_blobs={} "
        "capacity_blobs={} evicted_bytes={} cache_bytes={} cache_budget_bytes={}",
        result.expired_tasks,
        result.expired_blobs,
        result.capacity_blobs,
        result.evicted_bytes,
        result.cache_bytes,
        result.cache_budget_bytes,
    )


async def cleanup_task_artifacts_periodically() -> None:
    from app.core.config import settings

    interval_seconds = settings.TASK_ARTIFACT_CLEANUP_INTERVAL_HOURS * 3600
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await asyncio.to_thread(cleanup_task_artifacts)
        except Exception:
            logger.exception("task artifact periodic cleanup failed")


@app.on_event("startup")
async def start_task_artifact_cleanup() -> None:
    """启动清理任务并定期回收缓存空间。"""
    global artifact_cleanup_task

    await asyncio.to_thread(cleanup_task_artifacts)
    artifact_cleanup_task = asyncio.create_task(
        cleanup_task_artifacts_periodically(),
        name="task-artifact-cleanup",
    )


@app.on_event("startup")
async def recover_asset_comparison_jobs() -> None:
    """恢复资产核对任务状态并清理过期产物。"""
    from app.api.endpoints.asset_comparison import asset_comparison_job_manager

    asset_comparison_job_manager.recover_interrupted()


@app.on_event("shutdown")
async def shutdown_asset_comparison_jobs() -> None:
    """停止资产核对后台执行器。"""
    from app.api.endpoints.asset_comparison import asset_comparison_job_manager

    asset_comparison_job_manager.shutdown()


@app.on_event("shutdown")
async def shutdown_task_artifact_cleanup() -> None:
    """停止任务产物周期清理。"""
    global artifact_cleanup_task

    if artifact_cleanup_task is None:
        return
    artifact_cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await artifact_cleanup_task
    artifact_cleanup_task = None


@app.get("/")
def read_root():
    return {"message": "Welcome to ToolHub API"}

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


@app.on_event("startup")
async def cleanup_expired_uploads() -> None:
    """启动时清理过期上传句柄、任务产物和内容缓存。"""
    from app.core.config import settings
    from app.services.task_artifacts import task_artifact_store
    from app.services.upload.store import UploadStore

    UploadStore().cleanup_expired(max_age_hours=24)
    task_artifact_store.cleanup_expired_tasks()
    task_artifact_store.cleanup_expired_blobs(
        max_age_hours=settings.TASK_ARTIFACT_BLOB_TTL_HOURS
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


@app.get("/")
def read_root():
    return {"message": "Welcome to ToolHub API"}

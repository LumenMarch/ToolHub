import asyncio
from contextlib import suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from loguru import logger
from starlette.formparsers import MultiPartParser

from app.api.api_router import api_router
from app.db.base_class import Base
from app.db.session import engine, ensure_schema_compat
from app.seed import run_seed

# 增大 Starlette multipart 上传限制（默认 max_part_size 仅 1MB，Excel 文件轻松超标）
MultiPartParser.max_part_size = 100 * 1024 * 1024  # 单个 part 最大 100MB

# Create database tables
Base.metadata.create_all(bind=engine)
ensure_schema_compat()


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

# ===== 前端打包产物托管（可选挂载） =====
# 前端构建产物目录的候选定位方式（按优先级依次尝试）：
#   1) 仓库布局：backend/app/main.py 的 ../.. = 仓库根，其下 frontend/dist；
#      开发模式（源码直接运行）时使用。
#   2) Nuitka frozen 布局：打包时用 --include-data-dir=<dist>=frontend
#      把构建产物放进 bundle，运行时位于 <bundle>/frontend/。
#      Nuitka 编译后 app/main.py 的 __file__ 指向 <bundle>/app/main.py（虚拟路径），
#      因此 parents[1] 即 bundle 目录（实测：parents[2] 是 bundle 的父目录、
#      parent 是 <bundle>/app，均不对），与 --output-dir/产物重命名无关，
#      见 docs/research/windows-offline-deployment.md §7）。
# Nuitka 检测：__compiled__ 是 Nuitka 注入的模块级内置（类似 __file__），
# 普通 CPython 下不存在（NameError），官方推荐用法即 try/except 属性访问。
# （注意：import __compiled__ 在 Nuitka 4.1.3 下不可用，实测 ModuleNotFoundError；
#  必须以模块属性形式访问，且其 containing_dir 是 bundle 的父目录，因此数据路径
#  用 __file__ 的 parents[1] 定位，而不是 containing_dir。）
try:
    __compiled__  # noqa: B018 - Nuitka 注入的伪模块，用于检测 frozen 运行
    _NUITKA_FROZEN = True
except NameError:
    _NUITKA_FROZEN = False

FRONTEND_DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if not FRONTEND_DIST_DIR.is_dir() and _NUITKA_FROZEN:
    FRONTEND_DIST_DIR = Path(__file__).resolve().parents[1] / "frontend"
HAS_FRONTEND_BUILD = FRONTEND_DIST_DIR.is_dir()

if HAS_FRONTEND_BUILD:
    # 低优先级挂载：普通 path operation（含 /api/v1/*）优先，
    # fallback="auto" 使 SPA 路由回退到 index.html。
    app.frontend("/", directory=FRONTEND_DIST_DIR)

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
async def bind_realtime_hub_loop() -> None:
    """绑定实时 hub 到主事件循环，并尝试启用可选 Redis fan-out。"""
    from app.core.config import settings
    from app.services.realtime.hub import realtime_hub

    realtime_hub.set_event_loop(asyncio.get_running_loop())
    if settings.REDIS_URL:
        await realtime_hub.start_redis(
            settings.REDIS_URL,
            channel=settings.REALTIME_REDIS_CHANNEL,
        )


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
async def shutdown_realtime_redis() -> None:
    """关闭可选 Redis Pub/Sub 订阅。"""
    from app.services.realtime.hub import realtime_hub

    await realtime_hub.stop_redis()


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
    if HAS_FRONTEND_BUILD:
        # 存在前端构建产物时直接返回入口页内容（而非 307 重定向到 /index.html）：
        # 重定向会让浏览器地址栏停在 /index.html，而 React Router（BrowserRouter）
        # 路由表里没有该路径，导致 "No routes matched" 白屏。
        return FileResponse(FRONTEND_DIST_DIR / "index.html")
    return {"message": "Welcome to ToolHub API"}

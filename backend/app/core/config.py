import tempfile
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "ToolHub API"
    API_V1_STR: str = "/api/v1"

    # SECURITY WARNING: keep the secret key used in production secret!
    SECRET_KEY: str = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    AUTH_COOKIE_NAME: str = "toolhub_session"
    AUTH_COOKIE_SECURE: bool = False

    # 可选 Redis：设置后 realtime hub 用 Pub/Sub 跨实例 fan-out；
    # 未设置或连接失败时自动回落进程内 hub（单实例仍可用）
    REDIS_URL: str | None = Field(
        default=None,
        validation_alias=AliasChoices("REDIS_URL", "TOOLHUB_REDIS_URL"),
    )
    # 部署级频道名：多套 ToolHub 共用同一 Redis 时必须互不相同，
    # 避免 user_id 重叠导致 session/permission 事件串台
    REALTIME_REDIS_CHANNEL: str = Field(
        default="toolhub:realtime",
        min_length=1,
        validation_alias=AliasChoices(
            "REALTIME_REDIS_CHANNEL",
            "TOOLHUB_REALTIME_REDIS_CHANNEL",
        ),
    )

    # Database
    SQLALCHEMY_DATABASE_URI: str = "sqlite:///./toolhub.db"

    # 任务产物与上传内容缓存
    TASK_ARTIFACT_ROOT: str = str(
        Path(tempfile.gettempdir()) / "toolhub-task-artifacts"
    )
    TASK_ARTIFACT_BLOB_TTL_HOURS: int = Field(default=24 * 7, gt=0)
    TASK_ARTIFACT_BLOB_MAX_DISK_RATIO: float = Field(default=0.2, gt=0, lt=1)
    TASK_ARTIFACT_CLEANUP_INTERVAL_HOURS: float = Field(default=6, gt=0)

    # 资产核对任务
    ASSET_COMPARISON_MAX_ACTIVE_JOBS: int = 1
    ASSET_COMPARISON_JOB_TTL_HOURS: int = 24
    ASSET_COMPARISON_MAX_STORED_JOBS: int = 20
    ASSET_COMPARISON_MAX_STORAGE_BYTES: int = 1024 * 1024 * 1024

    class Config:
        case_sensitive = True


settings = Settings()

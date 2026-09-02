import json
import os
import secrets
import tempfile
from pathlib import Path
from typing import Annotated

import portalocker
from loguru import logger
from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode

# 自动生成的密钥持久化位置（仓库根 .env，已纳入 .gitignore）
_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def _parse_secret_key(content: str) -> str | None:
    """从 .env 文本中解析第一个非空 SECRET_KEY 值。"""
    for raw in content.splitlines():
        line = raw.strip()
        if line.startswith("SECRET_KEY="):
            value = line.split("=", 1)[1].strip().strip('"').strip("'")
            if value:
                return value
    return None


def _load_or_create_secret_key() -> str:
    """优先复用 .env 中已有的 SECRET_KEY；缺失时生成 256 位随机密钥并落盘。

    用跨进程文件锁（portalocker）覆盖 读 → 生成 → 写 → 重读 全流程：
    并发启动的多个进程只会持久化并返回同一把密钥（只认已落盘的值），
    避免负载均衡下各进程使用不同签名密钥导致会话随机失效。
    写入失败不阻断启动（本次进程使用内存密钥），仅记录告警。
    """
    _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        with portalocker.Lock(_ENV_FILE, "a+", encoding="utf-8") as fh:
            fh.seek(0)
            existing = _parse_secret_key(fh.read())
            if existing:
                return existing
            key = secrets.token_hex(32)
            fh.write(f"SECRET_KEY={key}\n")
            fh.flush()
            os.fsync(fh.fileno())
            # 重读确认：返回已持久化的值，而非内存候选值
            fh.seek(0)
            persisted = _parse_secret_key(fh.read())
            if persisted:
                return persisted
            return key
    except OSError:
        logger.warning("SECRET_KEY 写入 {} 失败，本次进程使用内存密钥", _ENV_FILE)
        return secrets.token_hex(32)
    finally:
        try:
            os.chmod(_ENV_FILE, 0o600)
        except OSError:
            pass


class Settings(BaseSettings):
    PROJECT_NAME: str = "ToolHub API"
    API_V1_STR: str = "/api/v1"

    # SECURITY WARNING: keep the secret key used in production secret!
    # 为空（未配置环境变量且仓库根 .env 无值）时由 _load_or_create_secret_key
    # 自动生成 256 位随机密钥并持久化到仓库根 .env。
    SECRET_KEY: str = ""

    @model_validator(mode="after")
    def _ensure_secret_key(self) -> "Settings":
        if not self.SECRET_KEY:
            self.SECRET_KEY = _load_or_create_secret_key()
        return self

    ALGORITHM: str = "HS256"
    # 8 小时有效期；需要长会话时由前端定期续期，而不是放长 token 生命周期。
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8
    AUTH_COOKIE_NAME: str = "toolhub_session"
    # 生产强制 Secure cookie；本地 HTTP 开发用 AUTH_COOKIE_SECURE=false 覆盖。
    AUTH_COOKIE_SECURE: bool = True
    # 仅当部署在可信反向代理之后时开启：开启后审计与限流信任
    # X-Forwarded-For 头；直连部署时该头可被客户端伪造。
    TRUST_PROXY_HEADERS: bool = False

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

    # ===== 本地大模型（TT 时间分析建议）=====
    # 对接本地 llama.cpp server（或任何 OpenAI 兼容端点）。
    # 未配置 LLM_BASE_URL 时，/tools/tt-time/analyze 返回 503，前端给出提示。
    LLM_BASE_URL: str = "http://127.0.0.1:8080/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "ggml-org/gemma-3-4b-it-qat-GGUF:Q4_0"
    LLM_TIMEOUT_SECONDS: float = Field(default=180, gt=0)
    LLM_MAX_TOKENS: int = Field(default=900, ge=16)

    # ===== 用户注册审批 =====
    # 注册接口限流（单实例内存滑动窗口，按 IP）。多实例部署时建议在
    # 网关层统一限流，本配置仅兜底。
    REGISTRATION_RATE_LIMIT_PER_IP: int = Field(default=10, ge=1)
    REGISTRATION_RATE_LIMIT_WINDOW: int = Field(default=3600, ge=1)  # 秒

    # 注册域名白名单：为空表示不限制。
    # 注意：注册流程没有独立 email 字段，白名单按 username 后缀匹配
    # （如 "@example.com"），即用户名必须以任一白名单项结尾。
    # 环境变量支持两种写法：JSON 数组（["@example.com"]）或逗号分隔字符串
    # （"@example.com,@corp.com"）。
    # 字段用 NoDecode 注解：pydantic-settings 默认对 list 类型 env 值先做
    # JSON 解码，逗号分隔字符串不是合法 JSON 会在进入 before validator 前
    # 抛 SettingsError；NoDecode 让原始字符串直接进入下方 validator 解析。
    REGISTRATION_ALLOWED_DOMAINS: Annotated[list[str], NoDecode] = Field(
        default_factory=list
    )

    @field_validator("REGISTRATION_ALLOWED_DOMAINS", mode="before")
    @classmethod
    def _parse_allowed_domains(cls, v: object) -> object:
        """兼容 JSON 数组与逗号分隔字符串两种环境变量写法。

        NoDecode 注解后 env 原始字符串会直接进入本函数：
        - "[\"@a.com\", \"@b.com\"]" → 先尝试 JSON 解析；
        - "@a.com,@b.com" → 按逗号切分并去空白。
        """
        if isinstance(v, str):
            stripped = v.strip()
            if stripped.startswith("["):
                try:
                    parsed = json.loads(stripped)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return v

    # 初始管理员：用户表为空且两项均配置时，启动自动创建超级管理员；
    # 仅配置一项视为配置错误，健康检查将返回 503。
    INITIAL_ADMIN_USERNAME: str = "admin"
    INITIAL_ADMIN_PASSWORD: str = "admin"

    # 待审批/被驳回注册用户保留天数，超过后周期清理任务物理删除。
    REGISTRATION_PENDING_TTL_DAYS: int = Field(default=7, ge=1)

    # 通知中心：已读通知保留天数，超过后周期清理任务物理删除。
    NOTIFICATION_RETENTION_DAYS: int = Field(default=90, ge=1)

    # 用户"在线"判定窗口（分钟）：存在未吊销且 last_seen_at（无则 created_at）
    # 在此窗口内的 UserSession 即视为在线。
    SESSION_ONLINE_WINDOW_MINUTES: int = Field(default=5, ge=1)

    # 已吊销会话保留天数，超过后周期清理任务物理删除。
    SESSION_REVOKED_RETENTION_DAYS: int = Field(default=7, ge=1)

    class Config:
        case_sensitive = True
        env_file = str(_ENV_FILE)


settings = Settings()

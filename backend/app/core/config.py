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

    # ===== 本地大模型（全局 LLM 网关的 env 默认层）=====
    # 这些字段只是「默认层」：运行时可被数据库 llm_config 表逐字段覆盖
    # （见 app/services/llm/settings.py 与 /api/v1/admin/llm/config），
    # 覆盖层为空即回落到这里，因此改 env 仍需重启，改管理台不需要。
    # LLM_PROVIDER 决定用哪套协议：openai_compat（llama.cpp server、
    # vLLM、Ollama /v1 兼容层）或 ollama（Ollama 原生 /api/chat）。
    LLM_ENABLED: bool = True
    LLM_PROVIDER: str = "openai_compat"
    LLM_BASE_URL: str = "http://127.0.0.1:8080/v1"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "ggml-org/gemma-3-4b-it-qat-GGUF:Q4_0"
    # 读超时：本地小模型跑满 3 分钟是常态，不要按「HTTP 应当很快」调小。
    LLM_TIMEOUT_SECONDS: float = Field(default=180, gt=0)
    LLM_CONNECT_TIMEOUT_SECONDS: float = Field(default=5, gt=0)
    # 思考类模型的思考 token 计入 max_tokens（实测 llama.cpp server + K2-Horizon-0.9B：
    # 一句短提示词就花掉 443 个 completion token，而正文只有 12 字）。
    # 默认值必须同时容下「思考 + 正文」，否则模型会先把预算用光、留下空正文。
    LLM_MAX_TOKENS: int = Field(default=1500, ge=16)
    # 分析类结论要可复现，默认取低温；实际输出仍受服务端采样实现影响。
    LLM_TEMPERATURE: float = Field(default=0.2, ge=0, le=2)
    # OpenAI 兼容端点的思考强度（high/medium/low/max/none）。
    # 置空字符串时不发送该字段（思考类模型保持默认思考；不识别此参数的
    # llama.cpp 等端点也不受影响）。思考类小模型注意把 LLM_MAX_TOKENS 调大，
    # 并把服务端上下文一起放大，否则推理会先耗尽上下文预算，导致 content 为空。
    LLM_REASONING_EFFORT: str = ""
    # 上下文窗口（token）。仅 ollama provider 能逐请求生效：Ollama 原生
    # /api/chat 接受 options.num_ctx，而 OpenAI 兼容层历史上直接忽略 num_ctx
    # （见 ollama#5356/#6544，转发补丁 ollama#16825 落地前依赖服务端版本）。
    # 0 表示不发送该字段，此时仍需服务端放大（Ollama: OLLAMA_CONTEXT_LENGTH；
    # llama.cpp: --ctx-size）。
    LLM_NUM_CTX: int = Field(default=0, ge=0)

    # 并发闸门：本地单卡模型的真实并发容量就是 1~2，超发只会让请求在
    # GPU 队列里干等并吃掉 FastAPI sync 端点共享的 40 个线程（实测 anyio
    # 默认 40 tokens），把全站其它接口一起拖死。因此默认串行 + 有限排队，
    # 队满立即 429，不做「假装受理」。
    LLM_MAX_CONCURRENCY: int = Field(default=1, ge=1)
    LLM_MAX_QUEUED: int = Field(default=8, ge=0)
    # 只重试瞬时故障（连接失败/超时/429/5xx），4xx 配置类错误立即失败。
    LLM_MAX_RETRIES: int = Field(default=2, ge=0)
    LLM_RETRY_BASE_DELAY_SECONDS: float = Field(default=0.5, ge=0)
    # 熔断：连续失败达到阈值后，在冷却期内直接拒绝而不再压上游
    # （参照 LiteLLM Router 的 allowed_fails + cooldown_time）。
    LLM_ALLOWED_FAILURES: int = Field(default=3, ge=1)
    LLM_COOLDOWN_SECONDS: float = Field(default=60, gt=0)
    # 结果缓存：切机台筛选来回点时同一统计上下文会重复推理，短 TTL 缓存
    # 直接消掉这部分开销。进程内 TTL+LRU，不写盘（见 services/llm/cache.py）。
    LLM_CACHE_TTL_SECONDS: int = Field(default=900, ge=0)
    LLM_CACHE_MAX_ENTRIES: int = Field(default=128, ge=1)
    # 探活结果缓存，避免每次 /llm/status 都压一次上游。
    LLM_HEALTH_CACHE_TTL_SECONDS: float = Field(default=15, ge=0)

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

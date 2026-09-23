"""LLM 网关配置的运行时覆盖层。

与 ToolMeta 同一套范式（见 CONTEXT.md「Tools Meta = 静态定义 + 运行时覆盖层」）：
env 是默认层，本表是覆盖层，逐字段 nullable —— 字段为空表示「继承 env」。
单行表（id 恒为 1）：本地模型服务本身就一套，多套 profile 的路由与配额
在当前部署形态下没有使用者，不做预设建设。

api_key 以明文入库（与 SECRET_KEY 同库同盘，加密只是把密钥挪到另一个地方）；
对外响应只回掩码，不回原文。
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String

from app.db.base_class import Base


class LlmConfig(Base):
    __tablename__ = "llm_config"

    id = Column(Integer, primary_key=True)
    # 覆盖层总开关：为空时继承 LLM_ENABLED
    enabled = Column(Boolean, nullable=True)
    provider = Column(String, nullable=True)
    base_url = Column(String, nullable=True)
    api_key = Column(String, nullable=True)
    model = Column(String, nullable=True)
    timeout_seconds = Column(Float, nullable=True)
    connect_timeout_seconds = Column(Float, nullable=True)
    max_tokens = Column(Integer, nullable=True)
    temperature = Column(Float, nullable=True)
    reasoning_effort = Column(String, nullable=True)
    num_ctx = Column(Integer, nullable=True)
    max_concurrency = Column(Integer, nullable=True)
    max_queued = Column(Integer, nullable=True)
    max_retries = Column(Integer, nullable=True)
    retry_base_delay_seconds = Column(Float, nullable=True)
    allowed_failures = Column(Integer, nullable=True)
    cooldown_seconds = Column(Float, nullable=True)
    cache_ttl_seconds = Column(Integer, nullable=True)
    # 结果缓存条目上限（LRU 容量）：与 TTL 同为一个覆盖层字段，
    # 只给 TTL 不给容量就不是一个完整的缓存配置
    cache_max_entries = Column(Integer, nullable=True)
    # 探活结果复用时长；None = 沿用 env 的 LLM_HEALTH_CACHE_TTL_SECONDS
    health_cache_ttl_seconds = Column(Float, nullable=True)
    # 配置版本号：每次写入递增，网关据此判断是否需要重建 client / 闸门并清缓存
    version = Column(Integer, nullable=False, default=1)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    updated_by = Column(String, nullable=True)

"""全局 LLM 网关（所有工具共用的唯一模型出口）。

工具侧只需要这三个入口：
    from app.services.llm import ChatMessage, LlmRequest, llm_gateway

编排、闸门、重试、缓存、指标都在网关内部；工具只负责把自己的领域
提示词拼成 LlmRequest。
"""

from __future__ import annotations

from app.services.llm.errors import (
    LlmBusyError,
    LlmCoolingDownError,
    LlmDisabledError,
    LlmEmptyResponseError,
    LlmError,
    LlmNotConfiguredError,
    LlmProtocolError,
    LlmTimeoutError,
    LlmUnreachableError,
    LlmUpstreamClientError,
    LlmUpstreamServerError,
)
from app.services.llm.gateway import LlmGateway, clean_model_text, llm_gateway
from app.services.llm.types import (
    ChatMessage,
    LlmChunk,
    LlmProfile,
    LlmRequest,
    LlmResult,
    LlmUsage,
)

__all__ = [
    "ChatMessage",
    "LlmBusyError",
    "LlmChunk",
    "LlmCoolingDownError",
    "LlmDisabledError",
    "LlmEmptyResponseError",
    "LlmError",
    "LlmGateway",
    "LlmNotConfiguredError",
    "LlmProfile",
    "LlmProtocolError",
    "LlmRequest",
    "LlmResult",
    "LlmTimeoutError",
    "LlmUnreachableError",
    "LlmUpstreamClientError",
    "LlmUpstreamServerError",
    "LlmUsage",
    "clean_model_text",
    "llm_gateway",
]

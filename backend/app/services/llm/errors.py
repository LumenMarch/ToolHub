"""LLM 网关的统一错误契约。

设计要点（参照 one-api 的 shouldRetry 与 LiteLLM 的 cooldown 分类）：
错误必须自带「能不能重试」和「对外是什么 HTTP 语义」这两个判断，
而不是像早期实现那样把所有失败坍缩成一个 503 —— 「模型没配」「推理超时」
「模型名写错导致上游 400」对客户端是三种完全不同的处置。

每个错误类固定四件事：
- code：给前端分支用的稳定字符串；
- http_status：HTTP 语义；
- retryable：重试是否有意义（4xx 配置错重试只会再错一次）；
- retry_after：可恢复故障建议的重试间隔，写进 Retry-After 头。
"""

from __future__ import annotations

from typing import Any, ClassVar

from fastapi import HTTPException


class LlmError(Exception):
    """LLM 网关错误基类；子类只需声明四个类属性。"""

    code: ClassVar[str] = "llm_error"
    http_status: ClassVar[int] = 502
    retryable: ClassVar[bool] = False
    # 建议客户端等待秒数；None 表示不发 Retry-After
    retry_after_seconds: ClassVar[int | None] = None

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        # detail 只进日志与审计，不进响应体，避免泄漏内网端点与上游响应原文
        self.detail = detail

    def to_http_exception(self) -> HTTPException:
        """转成带结构化 code 的 HTTPException，供端点直接 raise。"""
        headers: dict[str, str] = {}
        if self.retry_after_seconds is not None:
            headers["Retry-After"] = str(self.retry_after_seconds)
        return HTTPException(
            status_code=self.http_status,
            detail={
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
            },
            headers=headers or None,
        )

    def to_status_payload(self) -> dict[str, Any]:
        """用于 /llm/status 之类的非抛错路径，返回同一形状的描述。"""
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }


class LlmNotConfiguredError(LlmError):
    """缺少 base_url 或 model —— 只有管理员配置之后才可能成功。"""

    code = "llm_not_configured"
    http_status = 503
    retryable = False


class LlmDisabledError(LlmError):
    """管理员已把模型服务整体关闭（LLM_ENABLED=false / 覆盖层 enabled=false）。"""

    code = "llm_disabled"
    http_status = 503
    retryable = False


class LlmBusyError(LlmError):
    """排队位已满。本地模型容量有限，这里明确拒绝而不是无限排队。"""

    code = "llm_busy"
    http_status = 429
    retryable = True
    retry_after_seconds = 5


class LlmCoolingDownError(LlmError):
    """连续失败已触发熔断，冷却期内不再压上游。"""

    code = "llm_cooldown"
    http_status = 503
    retryable = True
    retry_after_seconds = 30


class LlmUnreachableError(LlmError):
    """连接失败 / DNS / 拒绝连接 —— 端点没起来或地址配错。"""

    code = "llm_unreachable"
    http_status = 503
    retryable = True
    retry_after_seconds = 5


class LlmTimeoutError(LlmError):
    """读超时。本地推理慢是常态，客户端可原样重试。"""

    code = "llm_timeout"
    http_status = 504
    retryable = True
    retry_after_seconds = 5


class LlmUpstreamClientError(LlmError):
    """上游返回 4xx（除 429）：模型名不存在、上下文不够、鉴权失败。重试无用。"""

    code = "llm_upstream_client_error"
    http_status = 502
    retryable = False


class LlmUpstreamServerError(LlmError):
    """上游 5xx / 429 且重试预算已耗尽。"""

    code = "llm_upstream_server_error"
    http_status = 502
    retryable = True
    retry_after_seconds = 10


class LlmProtocolError(LlmError):
    """上游 2xx 但响应体不是预期结构（多半是端点根本不是 OpenAI 兼容）。"""

    code = "llm_bad_response"
    http_status = 502
    retryable = False


class LlmEmptyResponseError(LlmError):
    """上游正常返回但 content 为空 —— 典型原因是思考把上下文预算吃光。"""

    code = "llm_empty_response"
    http_status = 502
    retryable = False


def is_retryable_status(status_code: int) -> bool:
    """上游 HTTP 状态码是否值得重试。

    判定顺序照 one-api controller/relay.go 的 shouldRetry：
    429 与 5xx 重试，400 与 2xx 不重试，其余按可重试处理。
    """
    if status_code == 429:
        return True
    if 500 <= status_code < 600:
        return True
    if 400 <= status_code < 500:
        return False
    return 200 <= status_code < 300

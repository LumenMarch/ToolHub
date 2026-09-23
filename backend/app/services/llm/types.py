"""LLM 网关的数据结构：请求、结果、用量、运行时配置快照。

这里只放纯数据，不做 IO，便于单测直接构造。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    content: str

    def as_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


@dataclass(frozen=True)
class LlmUsage:
    """token 用量；上游未给出时全为 None（各家兼容端点给的法子不一样）。"""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
        }


@dataclass(frozen=True)
class LlmRequest:
    """一次对话补全请求。

    参数优先级：管理台显式覆盖的字段（运行时配置）> 本请求字段 > env 默认。
    None 表示本工具不指定、交给上面的规则决定，而不是「不发给上游」；
    想显式不发某字段请在 provider 里用 0/空串表达。
    """

    messages: tuple[ChatMessage, ...]
    # 调用方标识（如 "tt-time"），只用于指标分组与审计，不参与上游请求
    source: str = "unknown"
    max_tokens: int | None = None
    temperature: float | None = None
    reasoning_effort: str | None = None
    num_ctx: int | None = None
    timeout_seconds: float | None = None
    # 三态缓存语义（参照 LangChain 的 cache=None/False/BaseCache）：
    # None 跟随全局配置；False 强制绕过缓存；True 强制走缓存路径
    use_cache: bool | None = None

    def resolved(self, profile: LlmProfile) -> dict[str, Any]:
        """把请求覆盖值与配置默认值合并成「实际生效参数」。

        优先级：管理台显式覆盖的字段最高，工具内请求参数次之，env 默认兜底。
        """

        def pick(field: str, request_value: Any, profile_value: Any) -> Any:
            if field in profile.overridden_fields:
                return profile_value
            return profile_value if request_value is None else request_value

        reasoning = pick(
            "reasoning_effort", self.reasoning_effort, profile.reasoning_effort
        )
        return {
            "model": profile.model,
            # 0 与 None 一样视为「工具未指定」，避免把 0 当合法值发给上游
            "max_tokens": pick(
                "max_tokens", self.max_tokens or None, profile.max_tokens
            ),
            "temperature": pick("temperature", self.temperature, profile.temperature),
            "reasoning_effort": reasoning or "",
            # 只有 ollama provider 会让它真正生效（openai_compat 直接忽略）
            "num_ctx": pick("num_ctx", self.num_ctx, profile.num_ctx),
        }

    def cache_identity(self, profile: LlmProfile) -> str:
        """缓存键原文：模型身份 + 排序后的生效参数 + 归一化消息。

        参照 LangChain BaseChatModel._get_llm_string() 的做法 —— 参与键的
        必须是「会改变输出的东西」。endpoint 与 provider 不入键：换端口/换
        协议不该让缓存全废；但 model、max_tokens、reasoning_effort 必须入键，
        否则换模型会直接命中上一个模型的答案。
        """
        params = self.resolved(profile)
        # 上下文窗口只影响「能不能算出来」，不影响同一份输入的文字结论，
        # 因此不入键，避免调 ctx 就把缓存清空。
        params.pop("num_ctx", None)
        payload = {
            "params": sorted(params.items()),
            "messages": [msg.as_dict() for msg in self.messages],
        }
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)

    def cache_key(self, profile: LlmProfile) -> str:
        return hashlib.sha256(self.cache_identity(profile).encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class LlmResult:
    content: str
    model: str
    provider: str
    usage: LlmUsage
    elapsed_ms: int
    cached: bool = False
    finish_reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "model": self.model,
            "provider": self.provider,
            "usage": self.usage.as_dict(),
            "elapsedMs": self.elapsed_ms,
            "cached": self.cached,
            "finishReason": self.finish_reason,
        }


@dataclass(frozen=True)
class LlmChunk:
    """流式片段。delta 为增量文本；is_final 的片段带完整结果。"""

    delta: str = ""
    is_final: bool = False
    result: LlmResult | None = None


@dataclass(frozen=True)
class LlmProfile:
    """运行时生效配置快照（env 默认层与 DB 覆盖层合并后的结果）。"""

    provider: str
    base_url: str
    api_key: str
    model: str
    timeout_seconds: float
    connect_timeout_seconds: float
    max_tokens: int
    temperature: float
    reasoning_effort: str
    num_ctx: int
    max_concurrency: int
    max_queued: int
    max_retries: int
    retry_base_delay_seconds: float
    allowed_failures: int
    cooldown_seconds: float
    cache_ttl_seconds: int
    cache_max_entries: int
    # 探活结果复用时长：状态页会反复探活，这个值决定多快反映上游变化
    health_cache_ttl_seconds: float
    # 覆盖层版本号：管理员改配置后递增，网关据此重建 client / 闸门 / 清缓存
    config_version: int = 1
    source: Literal["env", "db"] = "env"
    # 被管理台显式覆盖的字段：这些字段的运行时配置优先级高于工具内请求参数
    overridden_fields: frozenset[str] = frozenset()
    # 总开关：关闭时网关直接回 LlmDisabledError，状态接口照常报告原因
    enabled: bool = True

    @property
    def configured(self) -> bool:
        """是否具备发起推理的最小条件。"""
        return bool(self.base_url.strip() and self.model.strip())

    def describe(self) -> dict[str, Any]:
        """给状态/配置接口用的自描述视图；api_key 永远只回掩码。"""
        return {
            "provider": self.provider,
            "baseUrl": self.base_url,
            "model": self.model,
            "enabled": self.enabled,
            "timeoutSeconds": self.timeout_seconds,
            "connectTimeoutSeconds": self.connect_timeout_seconds,
            "maxTokens": self.max_tokens,
            "temperature": self.temperature,
            "reasoningEffort": self.reasoning_effort,
            "numCtx": self.num_ctx,
            "maxConcurrency": self.max_concurrency,
            "maxQueued": self.max_queued,
            "maxRetries": self.max_retries,
            "retryBaseDelaySeconds": self.retry_base_delay_seconds,
            "allowedFailures": self.allowed_failures,
            "cooldownSeconds": self.cooldown_seconds,
            "cacheTtlSeconds": self.cache_ttl_seconds,
            "cacheMaxEntries": self.cache_max_entries,
            "healthCacheTtlSeconds": self.health_cache_ttl_seconds,
            "configVersion": self.config_version,
            "source": self.source,
            "apiKeySet": bool(self.api_key),
            "apiKeyMask": _mask_secret(self.api_key),
        }


@dataclass(frozen=True)
class ServerCapabilities:
    """服务端自报的能力（llama.cpp 的 /props、Ollama 的 /api/show）。

    为什么需要它：思考能不能分档，不是模型名能推出来的。实测同一台
    llama.cpp（b11067）上，chat_template_caps.supports_reasoning_effort=false
    的模型选 low/high 只会静默无效；而模板里带 enable_thinking 的模型确实
    能被 reasoning_effort=none 关掉思考。这种事应该问服务端，不该让界面猜。

    字段全是 Optional：None = 服务端没上报这一项，不等于 false。界面必须
    区分「不支持」与「不知道」，否则一个不报能力的兼容端点会被误判成
    不支持思考。
    """

    source: str = ""
    build_info: str | None = None
    n_ctx: int | None = None
    total_slots: int | None = None
    # 模板是否支持 reasoning_effort 分档（none/low/medium/high/max）
    reasoning_effort: bool | None = None
    # 能否回传思考内容（supports_preserve_reasoning）
    preserve_reasoning: bool | None = None
    # 模板里有没有思考开关（enable_thinking 之类），即能不能整体开/关
    thinking_toggle: bool | None = None
    # 思考内容是否直接混在 content 里（决定能不能直接拿 content 当结论）
    reasoning_in_content: bool | None = None
    model_ftype: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def thinking_known(self) -> bool:
        """服务端是否就思考能力表过态。"""
        return self.reasoning_effort is not None or self.thinking_toggle is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "buildInfo": self.build_info,
            "nCtx": self.n_ctx,
            "totalSlots": self.total_slots,
            "reasoningEffort": self.reasoning_effort,
            "preserveReasoning": self.preserve_reasoning,
            "thinkingToggle": self.thinking_toggle,
            "reasoningInContent": self.reasoning_in_content,
            "modelFtype": self.model_ftype,
        }


@dataclass
class ProbeOutcome:
    """探活结果。ok 为 False 时 error 描述原因。"""

    ok: bool
    reachable: bool
    models: list[str] = field(default_factory=list)
    error: str | None = None
    checked_at: float = 0.0
    capabilities: ServerCapabilities | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "reachable": self.reachable,
            "models": self.models[:20],
            "error": self.error,
            "capabilities": self.capabilities.as_dict() if self.capabilities else None,
        }


def _mask_secret(value: str) -> str:
    """密钥只回掩码：保留首尾各 2 位供人工比对，中间打码。"""
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return f"{value[:2]}****{value[-2:]}"

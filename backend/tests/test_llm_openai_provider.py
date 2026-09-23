"""OpenAI 兼容 provider 的协议层特征测试。

这些用例锁定网关对 provider 的行为契约（错误分类、payload 形态、流式语义、
能力探测），协议层从手写 httpx 迁移到 openai 官方 SDK 前后都必须保持绿色。
测试用 httpx.MockTransport 全程离线，不依赖任何真实模型服务。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable

import httpx
import pytest

from app.services.llm.errors import (
    LlmEmptyResponseError,
    LlmProtocolError,
    LlmTimeoutError,
    LlmUnreachableError,
    LlmUpstreamClientError,
    LlmUpstreamServerError,
)
from app.services.llm.providers import OpenAICompatProvider, create_provider
from app.services.llm.types import ChatMessage, LlmProfile, LlmRequest

Handler = Callable[[httpx.Request], httpx.Response]


def make_profile(**overrides: object) -> LlmProfile:
    base: dict[str, object] = {
        "provider": "openai_compat",
        "base_url": "http://127.0.0.1:8080/v1",
        "api_key": "",
        "model": "test-model",
        "timeout_seconds": 30.0,
        "connect_timeout_seconds": 5.0,
        "max_tokens": 512,
        "temperature": 0.2,
        "reasoning_effort": "",
        "num_ctx": 0,
        "max_concurrency": 2,
        "max_queued": 4,
        "max_retries": 2,
        "retry_base_delay_seconds": 0.5,
        "allowed_failures": 3,
        "cooldown_seconds": 30.0,
        "cache_ttl_seconds": 60,
        "cache_max_entries": 128,
        "health_cache_ttl_seconds": 5.0,
    }
    base.update(overrides)
    return LlmProfile(**base)  # type: ignore[arg-type]


def make_request(**overrides: object) -> LlmRequest:
    messages = overrides.pop("messages", (ChatMessage(role="user", content="问题"),))
    base: dict[str, object] = {"messages": messages, "source": "test"}
    base.update(overrides)
    return LlmRequest(**base)  # type: ignore[arg-type]


def completion_body(
    content: str | None = "回答",
    *,
    reasoning: str | None = None,
    usage: dict[str, int] | None = None,
    finish_reason: str | None = "stop",
) -> bytes:
    message: dict[str, object] = {"role": "assistant", "content": content}
    if reasoning is not None:
        message["reasoning_content"] = reasoning
    body: dict[str, object] = {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 1,
        "model": "test-model",
        "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
    }
    if usage is not None:
        body["usage"] = usage
    return json.dumps(body).encode()


def chunk_frame(source: dict[str, object]) -> str:
    return (
        "event: message\n"
        + "data: "
        + json.dumps(
            {
                "id": "c1",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "test-model",
                "choices": [{"index": 0, "finish_reason": None, **source}],
            }
        )
        + "\n\n"
    )


class FakeUpstream:
    """可编排的假上游：记录请求、按剧本回应。"""

    def __init__(self, script: Handler) -> None:
        self._script = script
        self.requests: list[httpx.Request] = []

    @property
    def last_body(self) -> dict:
        return json.loads(self.requests[-1].content)

    def provider(
        self, profile: LlmProfile | None = None
    ) -> tuple[OpenAICompatProvider, httpx.AsyncClient]:
        client = httpx.AsyncClient(transport=httpx.MockTransport(self._record))
        return OpenAICompatProvider(client, profile or make_profile()), client

    def _record(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self._script(request)


def json_ok(body: bytes) -> Handler:
    return lambda request: httpx.Response(
        200, headers={"content-type": "application/json"}, content=body
    )


def sse_ok(frames: str, done: bool = True) -> Handler:
    payload = frames + ("data: [DONE]\n\n" if done else "")
    return lambda request: httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        content=payload.encode(),
    )


def status(code: int) -> Handler:
    return lambda request: httpx.Response(
        code, json={"error": {"message": f"upstream {code}"}}
    )


def run(coro):
    return asyncio.run(coro)


def collect_stream(provider: OpenAICompatProvider, request: LlmRequest) -> list[str]:
    async def _go() -> list[str]:
        parts: list[str] = []
        async for delta in provider.stream(request):
            parts.append(delta)
        return parts

    return run(_go())


# ---------------------------------------------------------------------------
# 非流式补全
# ---------------------------------------------------------------------------


def test_complete_parses_content_usage_finish_reason() -> None:
    up = FakeUpstream(
        json_ok(
            completion_body(
                "好的",
                usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            )
        )
    )
    provider, client = up.provider()
    try:
        result = run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert result.content == "好的"
    assert result.usage.prompt_tokens == 10
    assert result.usage.completion_tokens == 5
    assert result.usage.total_tokens == 15
    assert result.finish_reason == "stop"
    assert result.model == "test-model"


def test_complete_tolerates_missing_usage() -> None:
    up = FakeUpstream(json_ok(completion_body("答", usage=None)))
    provider, client = up.provider()
    try:
        result = run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert result.content == "答"
    assert result.usage.prompt_tokens is None
    assert result.usage.total_tokens is None


def test_complete_reads_reasoning_content_extra_field() -> None:
    # llama.cpp 把思考放在非标准的 reasoning_content 字段，正文正常时不应报错
    up = FakeUpstream(json_ok(completion_body("答", reasoning="思考过程")))
    provider, client = up.provider()
    try:
        result = run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert result.content == "答"


def test_complete_empty_content_raises_with_reasoning_hint() -> None:
    up = FakeUpstream(json_ok(completion_body("", reasoning="思" * 42)))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmEmptyResponseError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    # 正文为空时必须告诉用户思考占了多少字符，这是可执行的诊断
    assert "42 字符" in excinfo.value.message
    assert excinfo.value.retryable is False


def test_complete_none_content_treated_as_empty() -> None:
    up = FakeUpstream(json_ok(completion_body(None)))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmEmptyResponseError):
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())


# ---------------------------------------------------------------------------
# 非流式错误分类
# ---------------------------------------------------------------------------


def test_complete_maps_404_to_nonretryable_client_error() -> None:
    up = FakeUpstream(status(404))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUpstreamClientError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert excinfo.value.retryable is False
    assert excinfo.value.message == "模型服务上找不到该模型或该接口，请检查模型名与地址"
    # 上游原文只进 detail（日志/审计），不进对外 message
    assert "upstream 404" not in excinfo.value.message


def test_complete_maps_401_to_auth_error_message() -> None:
    up = FakeUpstream(status(401))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUpstreamClientError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert excinfo.value.message == "模型服务拒绝了请求，请检查 API Key 配置"


def test_complete_maps_429_to_retryable_server_error() -> None:
    up = FakeUpstream(status(429))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUpstreamServerError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert excinfo.value.retryable is True
    assert excinfo.value.message == "模型服务正忙，请稍后重试"


def test_complete_maps_500_to_retryable_server_error() -> None:
    up = FakeUpstream(status(500))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUpstreamServerError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert excinfo.value.retryable is True
    assert excinfo.value.message == "模型服务内部错误"


def test_complete_maps_read_timeout() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timed out", request=request)

    up = FakeUpstream(boom)
    provider, client = up.provider()
    try:
        with pytest.raises(LlmTimeoutError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert excinfo.value.retryable is True


def test_complete_maps_connection_refused() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    up = FakeUpstream(boom)
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUnreachableError) as excinfo:
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert excinfo.value.retryable is True


def test_complete_maps_non_json_2xx_to_protocol_error() -> None:
    up = FakeUpstream(
        lambda request: httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=b"<html>not json</html>",
        )
    )
    provider, client = up.provider()
    try:
        with pytest.raises(LlmProtocolError):
            run(provider.complete(make_request()))
    finally:
        run(client.aclose())


# ---------------------------------------------------------------------------
# 请求 payload 形态
# ---------------------------------------------------------------------------


def test_payload_carries_resolved_params() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider()
    try:
        run(provider.complete(make_request(temperature=0.7, max_tokens=64)))
    finally:
        run(client.aclose())
    body = up.last_body
    assert body["model"] == "test-model"
    assert body["temperature"] == 0.7
    assert body["max_tokens"] == 64
    assert body["messages"] == [{"role": "user", "content": "问题"}]
    assert "num_ctx" not in body


def test_payload_omits_reasoning_effort_when_unset() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider()
    try:
        run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    # 不认这个字段的端点（老 llama.cpp）会直接 400，未配置时必须不发
    assert "reasoning_effort" not in up.last_body


def test_payload_sends_reasoning_effort_when_set() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider(make_profile(reasoning_effort="low"))
    try:
        run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert up.last_body["reasoning_effort"] == "low"


def test_request_timeout_reaches_transport() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider()
    try:
        run(provider.complete(make_request(timeout_seconds=7.0)))
    finally:
        run(client.aclose())
    # 网关的 profile/request 超时必须穿透到 httpx，否则会退回 SDK 默认 600s
    extensions = up.requests[-1].extensions.get("timeout", {})
    assert extensions.get("read") == 7.0
    assert extensions.get("connect") == 5.0  # profile.connect_timeout_seconds


def test_sends_authorization_when_api_key_set() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider(make_profile(api_key="sk-secret"))
    try:
        run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert up.requests[-1].headers["authorization"] == "Bearer sk-secret"


def test_no_api_key_omits_authorization() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider()
    try:
        run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    assert "authorization" not in up.requests[-1].headers


def test_base_url_trailing_slash_normalized() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider(make_profile(base_url="http://127.0.0.1:8080/v1/"))
    try:
        run(provider.complete(make_request()))
    finally:
        run(client.aclose())
    # /v1 必须保留（它是 API 前缀），尾斜杠必须去掉，否则拼出 //chat/completions
    assert up.requests[-1].url.path == "/v1/chat/completions"


def test_provider_does_not_close_shared_client() -> None:
    up = FakeUpstream(json_ok(completion_body()))
    provider, client = up.provider()
    try:
        run(provider.complete(make_request()))
        assert client.is_closed is False  # client 归网关所有，provider 不得关闭
    finally:
        run(client.aclose())


def test_create_provider_falls_back_to_openai_compat() -> None:
    client = httpx.AsyncClient()
    try:
        provider = create_provider(client, make_profile(provider="mystery"))
        assert isinstance(provider, OpenAICompatProvider)
    finally:
        run(client.aclose())


# ---------------------------------------------------------------------------
# 流式补全
# ---------------------------------------------------------------------------


def test_stream_yields_deltas_in_order() -> None:
    frames = chunk_frame(
        {"delta": {"role": "assistant", "content": "你"}}
    ) + chunk_frame({"delta": {"content": "好"}})
    up = FakeUpstream(sse_ok(frames))
    provider, client = up.provider()
    try:
        parts = collect_stream(provider, make_request())
    finally:
        run(client.aclose())
    assert parts == ["你", "好"]
    assert up.last_body["stream"] is True


def test_stream_tolerates_odd_frame_with_message_field() -> None:
    # 少数兼容端点不带 delta，直接在 choice 里给 message
    frames = chunk_frame({"message": {"role": "assistant", "content": "你"}})
    up = FakeUpstream(sse_ok(frames))
    provider, client = up.provider()
    try:
        parts = collect_stream(provider, make_request())
    finally:
        run(client.aclose())
    assert parts == ["你"]


def test_stream_ignores_comment_and_event_lines() -> None:
    payload = (
        "event: message\n"
        + chunk_frame({"delta": {"content": "答"}})
        + ": keep-alive\n"
        + "data: [DONE]\n\n"
    )
    up = FakeUpstream(
        lambda request: httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=payload.encode(),
        )
    )
    provider, client = up.provider()
    try:
        parts = collect_stream(provider, make_request())
    finally:
        run(client.aclose())
    assert parts == ["答"]


def test_stream_garbage_data_line_raises_protocol_error() -> None:
    # 行为差异（相对手写解析器）：坏 data 行不再跳过。SDK 的流迭代器遇到
    # 无法解析的分片就死了（后续分片再也读不到），静默跳过会把上游截断伪装
    # 成完整回答，所以这里宁可抛协议错误让上层感知。
    payload = (
        chunk_frame({"delta": {"content": "你"}})
        + "data: this-is-not-json\n\n"
        + chunk_frame({"delta": {"content": "好"}})
        + "data: [DONE]\n\n"
    )
    up = FakeUpstream(
        lambda request: httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=payload.encode(),
        )
    )
    provider, client = up.provider()
    try:
        with pytest.raises(LlmProtocolError):
            collect_stream(provider, make_request())
    finally:
        run(client.aclose())


def test_stream_empty_content_raises_empty_error() -> None:
    up = FakeUpstream(sse_ok(""))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmEmptyResponseError):
            collect_stream(provider, make_request())
    finally:
        run(client.aclose())


def test_stream_counts_thinking_chars_when_body_empty() -> None:
    frames = chunk_frame({"delta": {"reasoning_content": "想" * 30, "content": None}})
    up = FakeUpstream(sse_ok(frames))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmEmptyResponseError) as excinfo:
            collect_stream(provider, make_request())
    finally:
        run(client.aclose())
    assert "30 字符" in excinfo.value.message


def test_stream_raises_error_before_first_yield_on_500() -> None:
    up = FakeUpstream(status(500))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUpstreamServerError):
            collect_stream(provider, make_request())
    finally:
        run(client.aclose())


def test_stream_raises_timeout_before_first_yield() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("read timed out", request=request)

    up = FakeUpstream(boom)
    provider, client = up.provider()
    try:
        with pytest.raises(LlmTimeoutError):
            collect_stream(provider, make_request())
    finally:
        run(client.aclose())


# ---------------------------------------------------------------------------
# 模型列表探活
# ---------------------------------------------------------------------------


def list_body(items: list[object]) -> bytes:
    return json.dumps({"object": "list", "data": items}).encode()


def test_list_models_filters_bad_entries() -> None:
    up = FakeUpstream(
        json_ok(
            list_body(
                [
                    {"id": "llama-3"},
                    {"id": "qwen"},
                    {"object": "model"},  # 缺 id
                    {"id": 123},  # id 非字符串
                    "not-a-dict",
                ]
            )
        )
    )
    provider, client = up.provider()
    try:
        models = run(provider.list_models())
    finally:
        run(client.aclose())
    assert models == ["llama-3", "qwen"]


def test_list_models_connection_error_is_unreachable() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    up = FakeUpstream(boom)
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUnreachableError):
            run(provider.list_models())
    finally:
        run(client.aclose())


def test_list_models_500_is_server_error() -> None:
    up = FakeUpstream(status(500))
    provider, client = up.provider()
    try:
        with pytest.raises(LlmUpstreamServerError):
            run(provider.list_models())
    finally:
        run(client.aclose())


def test_list_models_uses_short_probe_timeout() -> None:
    up = FakeUpstream(json_ok(list_body([{"id": "a"}])))
    provider, client = up.provider()
    try:
        run(provider.list_models())
    finally:
        run(client.aclose())
    extensions = up.requests[-1].extensions.get("timeout", {})
    # 探活是状态页路径，读超时固定 10s，不跟随 profile 的推理长超时
    assert extensions.get("read") == 10.0


# ---------------------------------------------------------------------------
# 能力探测（llama.cpp /props）
# ---------------------------------------------------------------------------


def props_body() -> bytes:
    return json.dumps(
        {
            "chat_template_caps": {"supports_reasoning_effort": True},
            "default_generation_settings": {
                "n_ctx": 8192,
                "params": {"reasoning_in_content": False},
            },
            "total_slots": 4,
            "chat_template": "{% set enable_thinking = true %}",
            "model_alias": "gpt-oss",
        }
    ).encode()


def test_capabilities_parses_props_at_root() -> None:
    def script(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/props":
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                content=props_body(),
            )
        return httpx.Response(404, json={})

    up = FakeUpstream(script)
    provider, client = up.provider()
    try:
        caps = run(provider.capabilities())
    finally:
        run(client.aclose())
    assert caps is not None
    assert caps.source == "llama.cpp/props"
    assert caps.n_ctx == 8192
    assert caps.total_slots == 4
    assert caps.reasoning_effort is True
    assert caps.thinking_toggle is True


def test_capabilities_returns_none_on_unsupported_endpoint() -> None:
    up = FakeUpstream(lambda request: httpx.Response(404, json={}))
    provider, client = up.provider()
    try:
        caps = run(provider.capabilities())
    finally:
        run(client.aclose())
    # 404 不等于不支持：探测失败必须回 None，不能猜能力集
    assert caps is None

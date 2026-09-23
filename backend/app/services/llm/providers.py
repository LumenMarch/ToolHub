"""模型 Provider 抽象与具体协议实现。

为什么要这一层：只支持 OpenAI 兼容协议时，「上下文窗口只能服务端设」就是硬
约束 —— Ollama 的 OpenAI 兼容层历来直接忽略 num_ctx（见 ollama#5356 / #6544，
转发补丁 ollama#16825 落地前依赖服务端版本），而它原生 /api/chat 的 ModelOptions
支持逐请求 num_ctx / num_predict，think 支持 high/medium/low/max（见
ollama docs/openapi.yaml）。有了 provider 边界，换协议只是换一个实现类，
网关的闸门 / 重试 / 缓存 / 指标一行不用改 —— 这与 LiteLLM（provider 实现 +
Router 编排）和 Open WebUI（每 provider 一套 chat / stream_chat / get_all_models）
是同一条路子。

约定：
- provider 只负责「一次请求 → 归一化结果」，不管闸门、重试、缓存、指标；
- provider 抛错只抛 app.services.llm.errors 里的类型，网关按 retryable 决策；
- 每个实例绑定一个 httpx.AsyncClient（由网关持有、全局长生命周期复用），
  openai_compat 借官方 SDK 用的就是这个 client，因此 provider 不得 close 它。
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, ClassVar

import httpx
import openai
from loguru import logger

from app.services.llm.errors import (
    LlmEmptyResponseError,
    LlmError,
    LlmProtocolError,
    LlmTimeoutError,
    LlmUnreachableError,
    LlmUpstreamClientError,
    LlmUpstreamServerError,
    is_retryable_status,
)
from app.services.llm.types import (
    LlmProfile,
    LlmRequest,
    LlmUsage,
    ServerCapabilities,
)


@dataclass(frozen=True)
class ProviderCompletion:
    """归一化后的补全结果。"""

    content: str
    usage: LlmUsage
    finish_reason: str | None = None
    model: str = ""


def _clean_base_url(raw: str, *, strip_v1: bool) -> str:
    """规范化 base_url：去尾斜杠；ollama 原生协议额外去尾部的 /v1。

    部署里最常见的配错：provider 选了 ollama，base_url 还留着 /v1，
    于是 /api/chat 变成 /v1/api/chat 直接 404。这里兜住。
    """
    url = raw.strip().rstrip("/")
    if strip_v1 and url.endswith("/v1"):
        url = url[: -len("/v1")]
    return url


class BaseLlmProvider(ABC):
    """Provider 基类：只管协议，不管编排。"""

    kind: ClassVar[str] = ""

    def __init__(self, client: httpx.AsyncClient, profile: LlmProfile) -> None:
        self._client = client
        self._profile = profile
        self._base_url = self._normalize_base(profile.base_url)

    def _normalize_base(self, raw: str) -> str:
        return _clean_base_url(raw, strip_v1=False)

    @property
    def profile(self) -> LlmProfile:
        return self._profile

    @abstractmethod
    async def complete(self, request: LlmRequest) -> ProviderCompletion:
        """非流式补全。"""

    @abstractmethod
    async def stream(self, request: LlmRequest) -> AsyncIterator[str]:
        """流式补全，逐段产出正文增量。"""

    @abstractmethod
    async def list_models(self) -> list[str]:
        """列出上游可用模型，同时充当探活手段。"""

    async def capabilities(self) -> ServerCapabilities | None:
        """读取服务端自报的能力；读不到返回 None（不等于不支持）。

        能力探测是 best-effort：任何失败都不能把探活带下水。界面需要
        区分「服务端说不支持」与「服务端没说」，否则一个不报能力的兼容
        端点会被误判成不支持思考。
        """
        return None

    async def _get_metadata(
        self, url: str, *, read_seconds: float = 5
    ) -> httpx.Response:
        """拉一小段元数据。失败不翻译成 LlmError，调用方按「没拿到」处理。"""
        return await self._client.get(
            url,
            headers=self._headers(),
            timeout=httpx.Timeout(
                connect=self._profile.connect_timeout_seconds,
                read=read_seconds,
                write=read_seconds,
                pool=self._profile.connect_timeout_seconds,
            ),
        )

    @staticmethod
    def _json_object(resp: httpx.Response) -> dict[str, Any] | None:
        """响应体是 JSON 对象时返回它，否则 None（包括 4xx/5xx 与非 JSON）。"""
        if resp.status_code >= 400:
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        return body if isinstance(body, dict) else None

    @staticmethod
    def _flag(source: Any, key: str) -> bool | None:
        """只有真正的 bool 才算报过态；缺失或非 bool 都归为 None。"""
        value = source.get(key) if isinstance(source, dict) else None
        return value if isinstance(value, bool) else None

    # ----- 子类共用的 HTTP 机械动作 -----

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._profile.api_key:
            headers["Authorization"] = f"Bearer {self._profile.api_key}"
        return headers

    def _timeout(self, request: LlmRequest) -> httpx.Timeout:
        # 与 resolved() 同一优先级：管理台显式覆盖 > 请求 > env 默认
        read = (
            self._profile.timeout_seconds
            if "timeout_seconds" in self._profile.overridden_fields
            else request.timeout_seconds or self._profile.timeout_seconds
        )
        return httpx.Timeout(
            connect=self._profile.connect_timeout_seconds,
            read=read,
            write=read,
            pool=self._profile.connect_timeout_seconds,
        )

    async def _post_json(
        self, url: str, payload: dict[str, Any], request: LlmRequest
    ) -> dict[str, Any]:
        """POST 并返回 JSON；所有传输/状态异常在此翻译成网关错误类型。"""
        try:
            resp = await self._client.post(
                url,
                json=payload,
                headers=self._headers(),
                timeout=self._timeout(request),
            )
        except httpx.TimeoutException as exc:
            raise LlmTimeoutError("模型推理超时，请稍后重试", detail=str(exc)) from exc
        except httpx.HTTPError as exc:  # 连接失败 / 协议错误 / 被断开
            raise LlmUnreachableError(
                "无法连接模型服务，请确认服务已启动且地址正确", detail=str(exc)
            ) from exc

        if resp.status_code >= 400:
            detail = f"HTTP {resp.status_code}: {resp.text[:300]}"
            message = _upstream_message(resp.status_code)
            if is_retryable_status(resp.status_code):
                raise LlmUpstreamServerError(message, detail=detail)
            raise LlmUpstreamClientError(message, detail=detail)

        try:
            body = resp.json()
        except ValueError as exc:
            raise LlmProtocolError(
                "模型服务返回的不是 JSON，请确认端点协议与 provider 匹配",
                detail=resp.text[:300],
            ) from exc
        if not isinstance(body, dict):
            raise LlmProtocolError("模型服务响应结构异常")
        return body

    @asynccontextmanager
    async def _open_stream(
        self, url: str, payload: dict[str, Any], request: LlmRequest
    ) -> AsyncIterator[httpx.Response]:
        """发起流式请求并在同一个上下文里完成状态码校验。"""
        try:
            async with self._client.stream(
                "POST",
                url,
                json=payload,
                headers=self._headers(),
                timeout=self._timeout(request),
            ) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    detail = f"HTTP {resp.status_code}: {body[:300].decode('utf-8', 'replace')}"
                    message = _upstream_message(resp.status_code)
                    if is_retryable_status(resp.status_code):
                        raise LlmUpstreamServerError(message, detail=detail)
                    raise LlmUpstreamClientError(message, detail=detail)
                yield resp
        except httpx.TimeoutException as exc:
            raise LlmTimeoutError("模型推理超时，请稍后重试", detail=str(exc)) from exc
        except httpx.HTTPError as exc:
            raise LlmUnreachableError(
                "无法连接模型服务，请确认服务已启动且地址正确", detail=str(exc)
            ) from exc


class OpenAICompatProvider(BaseLlmProvider):
    """OpenAI /v1/chat/completions 协议：llama.cpp server、vLLM、Ollama /v1 等。

    协议收发交给 openai 官方 SDK（AsyncOpenAI）：连接复用、SSE 解析、
    状态码/传输错误分类都是 SDK 的职责，本类只保留网关侧的契约——组装请求、
    分段超时、可省略的 Authorization，以及把 SDK 异常翻译成网关错误类型。
    重试仍归网关（tenacity 按 retryable 决策），所以 SDK 的 max_retries=0。
    """

    kind = "openai_compat"

    def __init__(self, client: httpx.AsyncClient, profile: LlmProfile) -> None:
        super().__init__(client, profile)
        # api_key 为空时 SDK 构造期就抛 Missing credentials，用占位 key 过
        # 构造校验；真正不发 Authorization 靠每请求的 Omit 头（见 _auth_override）。
        # http_client 用网关共享的 client，provider 不得 close（关了共享连接池）。
        self._sdk = openai.AsyncOpenAI(
            api_key=profile.api_key or "unused-local-endpoint",
            base_url=self._base_url,
            http_client=client,
            max_retries=0,
        )
        self._auth_override: dict[str, Any] = (
            {}
            if profile.api_key
            else {"extra_headers": {"Authorization": openai.Omit()}}
        )

    def _create_kwargs(self, request: LlmRequest, *, stream: bool) -> dict[str, Any]:
        params = request.resolved(self._profile)
        kwargs: dict[str, Any] = {
            "model": params["model"],
            "messages": [msg.as_dict() for msg in request.messages],
            "temperature": params["temperature"],
            "max_tokens": params["max_tokens"],
            "stream": stream,
            # SDK 客户端默认 read=600s，每次调用必须显式带上网关的分段超时
            "timeout": self._timeout(request),
            **self._auth_override,
        }
        # 只在显式配置时发送：不认这个字段的端点（老 llama.cpp server）会直接 400
        if params["reasoning_effort"]:
            kwargs["reasoning_effort"] = params["reasoning_effort"]
        return kwargs

    async def complete(self, request: LlmRequest) -> ProviderCompletion:
        try:
            completion = await self._sdk.chat.completions.create(
                **self._create_kwargs(request, stream=False)
            )
        except openai.APIError as exc:
            raise _map_openai_error(exc) from exc
        except httpx.HTTPError as exc:  # 共享 client 上未被 SDK 包住的传输错误
            raise _map_openai_error(exc) from exc
        except ValueError as exc:  # 2xx 但响应体不是 JSON（SDK 抛裸 JSONDecodeError）
            raise LlmProtocolError(
                "模型服务返回的不是 JSON，请确认端点协议与 provider 匹配",
                detail=_value_error_detail(exc),
            ) from exc
        return self._parse(completion)

    def _parse(self, completion: Any) -> ProviderCompletion:
        choices = getattr(completion, "choices", None)
        message = getattr(choices[0], "message", None) if choices else None
        if message is None:
            raise LlmProtocolError("模型服务响应结构异常（缺少 choices/message）")
        content = getattr(message, "content", None)
        if not isinstance(content, str) or not content.strip():
            # llama.cpp server 把思考放在独立的 reasoning_content（实测），
            # 而思考 token 计入 max_tokens。正文为空时直接把这件事说出来，
            # 比笼统报「返回空内容」能少走一个完全方方向。
            reasoning = getattr(message, "reasoning_content", None)
            raise _empty_content_error(
                len(reasoning) if isinstance(reasoning, str) else 0
            )
        usage = getattr(completion, "usage", None)
        finish = getattr(choices[0], "finish_reason", None)
        return ProviderCompletion(
            content=content,
            usage=LlmUsage(
                prompt_tokens=_as_int(usage, "prompt_tokens"),
                completion_tokens=_as_int(usage, "completion_tokens"),
                total_tokens=_as_int(usage, "total_tokens"),
            ),
            finish_reason=finish if isinstance(finish, str) else None,
            model=str(getattr(completion, "model", None) or self._profile.model),
        )

    async def stream(self, request: LlmRequest) -> AsyncIterator[str]:
        emitted = False
        thinking_chars = 0
        try:
            chunk_stream = await self._sdk.chat.completions.create(
                **self._create_kwargs(request, stream=True)
            )
        except openai.APIError as exc:
            raise _map_openai_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_openai_error(exc) from exc
        except ValueError as exc:
            raise LlmProtocolError(
                "模型服务返回的不是 JSON，请确认端点协议与 provider 匹配",
                detail=_value_error_detail(exc),
            ) from exc
        try:
            async for chunk in chunk_stream:
                delta, reasoning_chars = _openai_delta_parts(chunk)
                if delta:
                    emitted = True
                    yield delta
                thinking_chars += reasoning_chars
        except openai.APIError as exc:
            raise _map_openai_error(exc) from exc
        except httpx.HTTPError as exc:
            raise _map_openai_error(exc) from exc
        except ValueError as exc:
            # 与手写解析器的唯一行为差异：坏 data 行不再跳过。SDK 迭代器遇到
            # 无法解析的分片就死了，继续走只会静默丢掉后续分片——宁可报协议错。
            raise LlmProtocolError(
                "模型服务返回了无法解析的流式分片",
                detail=_value_error_detail(exc),
            ) from exc
        finally:
            await chunk_stream.close()  # 幂等；关的是这条流，不是共享 client

        if not emitted:
            # 正文一帧都没推到：流式已经发了 200，只能靠异常把原因带给上层。
            # 如果只说「返回空内容」，用户在界面上拿到的是一句无法行动的话；
            # 思考字符数这里本来就看得到，没有理由不说。
            raise _empty_content_error(thinking_chars)

    async def list_models(self) -> list[str]:
        timeout = httpx.Timeout(
            connect=self._profile.connect_timeout_seconds,
            read=10,
            write=10,
            pool=self._profile.connect_timeout_seconds,
        )
        try:
            page = await self._sdk.models.list(timeout=timeout, **self._auth_override)
        except openai.APIStatusError as exc:
            # 探活契约：HTTP >= 400 一律算服务端问题（沿用迁移前的分类）
            raise LlmUpstreamServerError(
                f"模型服务返回 HTTP {exc.status_code}"
            ) from exc
        except ValueError as exc:
            raise LlmProtocolError(
                "模型列表响应不是合法 JSON", detail=_value_error_detail(exc)
            ) from exc
        except openai.APIError as exc:  # 连不上 / 超时（迁移前同样归为不可达）
            raise LlmUnreachableError("无法连接模型服务", detail=str(exc)) from exc
        except httpx.HTTPError as exc:
            raise LlmUnreachableError("无法连接模型服务", detail=str(exc)) from exc
        models: list[str] = []
        for item in getattr(page, "data", None) or []:
            item_id = getattr(item, "id", None)
            if isinstance(item_id, str):
                models.append(item_id)
        return models

    async def capabilities(self) -> ServerCapabilities | None:
        """llama.cpp server 在根路径的 /props 里上报模板能力与默认槽位。

        /v1/models 里没有这些信息；/props 是 Ollama 兼容路径，llama.cpp 把它
        实现在根路径（实测 b11067），所以先试根路径，再退回 base_url 下，
        挡住挂在子路径部署的情况。不识别这个端点的服务端会 404，此时
        返回 None 而不是猜一个能力集。
        """
        root = (
            self._base_url[: -len("/v1")]
            if self._base_url.endswith("/v1")
            else self._base_url
        )
        for url in (f"{root}/props", f"{self._base_url}/props"):
            try:
                resp = await self._get_metadata(url)
            except httpx.HTTPError as exc:
                logger.debug("读取模型服务能力失败 {}: {}", url, exc)
                return None
            body = self._json_object(resp)
            if body and (
                "chat_template_caps" in body or "default_generation_settings" in body
            ):
                return self._parse_props(body)
        return None

    def _parse_props(self, body: dict[str, Any]) -> ServerCapabilities:
        caps = body.get("chat_template_caps")
        generation = body.get("default_generation_settings")
        generation = generation if isinstance(generation, dict) else {}
        params = generation.get("params")
        params = params if isinstance(params, dict) else {}
        template = body.get("chat_template")
        template = template if isinstance(template, str) else ""
        n_ctx = generation.get("n_ctx")
        slots = body.get("total_slots")
        alias = body.get("model_alias")
        ftype = body.get("model_ftype")
        build = body.get("build_info")
        return ServerCapabilities(
            source="llama.cpp/props",
            build_info=build if isinstance(build, str) else None,
            n_ctx=n_ctx if isinstance(n_ctx, int) else None,
            total_slots=slots if isinstance(slots, int) else None,
            # 分档能力由模板声明，实测与行为一致：false 时选 low/high 静默无效
            reasoning_effort=self._flag(caps, "supports_reasoning_effort"),
            preserve_reasoning=self._flag(caps, "supports_preserve_reasoning"),
            # 模板里有 enable_thinking 才能整体开关；这是实测出来的判据
            thinking_toggle=("enable_thinking" in template) if template else None,
            reasoning_in_content=self._flag(params, "reasoning_in_content"),
            model_ftype=ftype if isinstance(ftype, str) else None,
            extra={
                key: value
                for key, value in (("modelAlias", alias),)
                if isinstance(value, str) and value
            },
        )


class OllamaProvider(BaseLlmProvider):
    """Ollama 原生 /api/chat。

    相对 OpenAI 兼容层的实质差别（依据 ollama docs/openapi.yaml）：
    - options.num_ctx / num_predict 可逐请求设置，不必再依赖
      OLLAMA_CONTEXT_LENGTH 或 Modelfile；
    - think 支持 high/medium/low/max（与网关的 reasoning_effort 同语义），
      且思考内容走独立字段，不会污染正文。
    """

    kind = "ollama"

    def _normalize_base(self, raw: str) -> str:
        return _clean_base_url(raw, strip_v1=True)

    @property
    def _chat_url(self) -> str:
        return f"{self._base_url}/api/chat"

    def _payload(self, request: LlmRequest, *, stream: bool) -> dict[str, Any]:
        params = request.resolved(self._profile)
        options: dict[str, Any] = {
            "temperature": params["temperature"],
            "num_predict": params["max_tokens"],
        }
        if params["num_ctx"] > 0:
            options["num_ctx"] = params["num_ctx"]
        payload: dict[str, Any] = {
            "model": params["model"],
            "messages": [msg.as_dict() for msg in request.messages],
            "stream": stream,
            "options": options,
        }
        effort = params["reasoning_effort"]
        if effort == "none":
            payload["think"] = False
        elif effort in ("low", "medium", "high", "max"):
            payload["think"] = effort
        return payload

    async def complete(self, request: LlmRequest) -> ProviderCompletion:
        body = await self._post_json(
            self._chat_url, self._payload(request, stream=False), request
        )
        message = body.get("message")
        if not isinstance(message, dict):
            raise LlmProtocolError("模型服务响应结构异常（缺少 message）")
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise LlmEmptyResponseError(
                "模型返回空内容：多为思考过程占满了上下文预算，请调大 num_ctx"
            )
        # Ollama 用 eval_count / prompt_eval_count 计 token（纳秒级 duration 字段忽略）
        prompt_tokens = _as_int(body, "prompt_eval_count")
        completion_tokens = _as_int(body, "eval_count")
        total = (
            prompt_tokens + completion_tokens
            if prompt_tokens is not None and completion_tokens is not None
            else None
        )
        usage = LlmUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total,
        )
        done_reason = body.get("done_reason")
        return ProviderCompletion(
            content=content,
            usage=usage,
            finish_reason=done_reason if isinstance(done_reason, str) else None,
            model=str(body.get("model") or self._profile.model),
        )

    async def stream(self, request: LlmRequest) -> AsyncIterator[str]:
        payload = self._payload(request, stream=True)
        emitted = False
        thinking_chars = 0
        async with self._open_stream(self._chat_url, payload, request) as resp:
            async for raw in resp.aiter_lines():
                line = raw.strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    logger.debug("忽略无法解析的 Ollama 分片: {}", line[:120])
                    continue
                if not isinstance(chunk, dict):
                    continue
                message = chunk.get("message")
                if not isinstance(message, dict):
                    continue
                # Ollama 原生把思考放在 message.thinking。本机没有 Ollama 可验，
                # 字段不存在时只会退化成「没思考」的通用文案，不影响正确性。
                thinking = message.get("thinking")
                if isinstance(thinking, str):
                    thinking_chars += len(thinking)
                if isinstance(message.get("content"), str) and message["content"]:
                    emitted = True
                    yield message["content"]

        if not emitted:
            raise _empty_content_error(thinking_chars)

    async def list_models(self) -> list[str]:
        try:
            resp = await self._client.get(
                f"{self._base_url}/api/tags",
                headers=self._headers(),
                timeout=httpx.Timeout(
                    connect=self._profile.connect_timeout_seconds,
                    read=10,
                    write=10,
                    pool=self._profile.connect_timeout_seconds,
                ),
            )
        except httpx.HTTPError as exc:
            raise LlmUnreachableError("无法连接 Ollama 服务", detail=str(exc)) from exc
        if resp.status_code >= 400:
            raise LlmUpstreamServerError(f"Ollama 返回 HTTP {resp.status_code}")
        try:
            data = resp.json().get("models", [])
        except ValueError as exc:
            raise LlmProtocolError("Ollama 模型列表响应不是合法 JSON") from exc
        models: list[str] = []
        for item in data if isinstance(data, list) else []:
            if isinstance(item, dict) and isinstance(item.get("name"), str):
                models.append(item["name"])
        return models

    async def capabilities(self) -> ServerCapabilities | None:
        """Ollama 原生：/api/show 会回这个模型的参数定义与聊天模板。

        这里只报服务端确实给了的东西：参数名列表、模板里有没有思考开关、
        默认 num_ctx。分档能力保持 None —— Ollama 用 think 承载思考强度，
        但服务端并不上报「哪些等级可用」，猜一个默认集会把界面说假。
        """
        model = self._profile.model.strip()
        if not model:
            return None
        try:
            resp = await self._client.post(
                f"{self._base_url}/api/show",
                json={"model": model},
                headers=self._headers(),
                timeout=httpx.Timeout(
                    connect=self._profile.connect_timeout_seconds,
                    read=5,
                    write=5,
                    pool=self._profile.connect_timeout_seconds,
                ),
            )
        except httpx.HTTPError as exc:
            logger.debug("读取 Ollama 模型能力失败: {}", exc)
            return None
        body = self._json_object(resp)
        if not body:
            return None
        template = body.get("template")
        template = template if isinstance(template, str) else ""
        definitions = body.get("parameter_definitions")
        definitions = definitions if isinstance(definitions, dict) else {}
        num_ctx = definitions.get("num_ctx")
        default_ctx = num_ctx.get("default") if isinstance(num_ctx, dict) else None
        return ServerCapabilities(
            source="ollama/api-show",
            n_ctx=default_ctx if isinstance(default_ctx, int) else None,
            thinking_toggle=(
                ("enable_thinking" in template or "think" in template)
                if template
                else None
            ),
            extra={
                "parameters": sorted(str(name) for name in definitions),
            },
        )


PROVIDER_REGISTRY: dict[str, type[BaseLlmProvider]] = {
    OpenAICompatProvider.kind: OpenAICompatProvider,
    OllamaProvider.kind: OllamaProvider,
}


def create_provider(client: httpx.AsyncClient, profile: LlmProfile) -> BaseLlmProvider:
    """按 provider 名实例化；未知名字回落到 OpenAI 兼容协议。"""
    impl = PROVIDER_REGISTRY.get(profile.provider.strip() or "openai_compat")
    if impl is None:
        logger.warning(
            "未知 LLM provider '{}'，回落到 openai_compat（可选值: {}）",
            profile.provider,
            "/".join(PROVIDER_REGISTRY),
        )
        impl = OpenAICompatProvider
    return impl(client, profile)


def supported_providers() -> tuple[str, ...]:
    return tuple(PROVIDER_REGISTRY)


def _openai_delta_parts(chunk: Any) -> tuple[str, int]:
    """返回 (正文增量, 本帧思考字符数)。

    llama.cpp server 实测把思考放在 delta.reasoning_content，与正文分帧。思考
    不推给前端，但必须计数：正文为空时只有 provider 知道“钱花在哪了”。

    入参是 SDK 解析出的 Choice 对象；delta 缺失时回落到宽松解析留在
    model_extra 里的 message（少数兼容端点直接给 message.content）。
    """
    choices = getattr(chunk, "choices", None)
    if not choices:
        return "", 0
    choice = choices[0]
    source = getattr(choice, "delta", None)
    if source is None:
        # 少数兼容端点不带 delta，直接给 message.content
        source = getattr(choice, "message", None)
    if source is None:
        return "", 0
    if isinstance(source, dict):  # model_extra 里留下的原始 dict
        content = source.get("content")
        reasoning = source.get("reasoning_content")
    else:
        content = getattr(source, "content", None)
        reasoning = getattr(source, "reasoning_content", None)
    return (
        content if isinstance(content, str) else "",
        len(reasoning) if isinstance(reasoning, str) else 0,
    )


def _empty_content_error(reasoning_chars: int) -> LlmEmptyResponseError:
    """正文为空时的统一诊断：知道思考长度就把话说到位。

    这类模型（实测 MiniCPM5-2B、K2-Horizon）默认开思考，思考 token 计入
    max_tokens：预算不够时整段回答都消失在 think 块里。告诉用户“思考占了
    多少字”比“返回空内容”多给了一条可执行的路：降低思考强度或调大预算。
    """
    if reasoning_chars > 0:
        return LlmEmptyResponseError(
            "模型只产出了思考内容、正文为空：思考 token 计入 max_tokens 预算，"
            f"本次思考约占 {reasoning_chars} 字符，请调大 max_tokens 或在模型配置里关掉思考"
        )
    return LlmEmptyResponseError("模型返回空内容，请确认模型可用且提示词不为空")


def _as_int(container: Any, key: str) -> int | None:
    """从 dict 或对象（SDK 的 pydantic 模型）取整数；bool 和缺失都算没有。"""
    if isinstance(container, dict):
        value = container.get(key)
    elif container is None:
        return None
    else:
        value = getattr(container, key, None)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _value_error_detail(exc: Exception) -> str:
    """JSON 解析错误带出原文片段（进 detail 日志，不进对外 message）。"""
    doc = getattr(exc, "doc", None)
    if isinstance(doc, str):
        return doc[:300]
    return str(exc)[:300]


def _map_openai_error(exc: Exception) -> LlmError:
    """把 SDK / 传输异常翻译成网关错误类型；上游原文只进 detail。

    分类顺序即优先级：超时必须先于连接错误判（APITimeoutError 是
    APIConnectionError 的子类，httpx.TimeoutException 是 HTTPError 的子类）。
    """
    if isinstance(exc, (openai.APITimeoutError, httpx.TimeoutException)):
        return LlmTimeoutError("模型推理超时，请稍后重试", detail=str(exc))
    if isinstance(exc, (openai.APIConnectionError, httpx.HTTPError)):
        return LlmUnreachableError(
            "无法连接模型服务，请确认服务已启动且地址正确", detail=str(exc)
        )
    if isinstance(exc, openai.APIStatusError):
        status = exc.status_code
        message = _upstream_message(status)
        detail = f"HTTP {status}: {str(exc)[:300]}"
        if is_retryable_status(status):
            return LlmUpstreamServerError(message, detail=detail)
        return LlmUpstreamClientError(message, detail=detail)
    # 响应校验失败 / 其余 SDK 错误：请求打出去了但回的东西不符合协议
    return LlmProtocolError(
        "模型服务返回的响应结构异常", detail=_value_error_detail(exc)
    )


def _upstream_message(status_code: int) -> str:
    """把上游状态码翻译成人话（不外泄上游原文）。"""
    if status_code == 401 or status_code == 403:
        return "模型服务拒绝了请求，请检查 API Key 配置"
    if status_code == 404:
        return "模型服务上找不到该模型或该接口，请检查模型名与地址"
    if status_code == 429:
        return "模型服务正忙，请稍后重试"
    if status_code >= 500:
        return "模型服务内部错误"
    return "模型服务拒绝了该请求（可能超出上下文长度或参数不合法）"

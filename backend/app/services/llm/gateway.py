"""全局 LLM 网关：所有工具共用的唯一模型出口。

职责边界（本次重设计的核心，其它都是配套）：
- 领域提示词不属于这里 —— 「TT、机台、IQR」这些字只应出现在各工具自己的
  prompt 模块里；
- 这里只做编排：配置解析 -> 查缓存 -> 排队闸门 -> 重试 -> 熔断 -> 指标；
- 协议差异全部下沉到 providers.py，网关只认 BaseLlmProvider 接口。

并发模型是这套设计里唯一不可妥协的点：
FastAPI 的 sync 端点共享 anyio 默认 40 个线程（实测 total_tokens=40），而
本地模型的真实并发容量是 1~2。旧实现用 sync 端点 + 180 秒超时直连模型，
意味着十几个用户点「生成建议」就能占满这 40 个线程，上传、登录、其它工具
全部跟着排队。因此调用方必须用 async 端点，网关侧再设显式闸门：容量满了
立刻 429 带 Retry-After —— 宁可明确拒绝，也不假装受理然后一起等到超时。
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass
from typing import Any
from weakref import WeakKeyDictionary

import httpx
from loguru import logger
from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
    wait_fixed,
)

from app.services.llm.cache import LlmResultCache
from app.services.llm.errors import (
    LlmBusyError,
    LlmCoolingDownError,
    LlmDisabledError,
    LlmEmptyResponseError,
    LlmError,
    LlmNotConfiguredError,
)
from app.services.llm.metrics import LlmMetrics
from app.services.llm.providers import (
    BaseLlmProvider,
    ProviderCompletion,
    create_provider,
    supported_providers,
)
from app.services.llm.settings import resolve_profile_async
from app.services.llm.types import (
    LlmChunk,
    LlmProfile,
    LlmRequest,
    LlmResult,
    LlmUsage,
    ProbeOutcome,
)

# 退避上限：本地模型抖动通常几秒内恢复，退避太久只是让用户白等
MAX_BACKOFF_SECONDS = 5.0

# 思考类模型泄漏进正文的特殊 token（形如 比 im_start 加尖括号竖线的那种）。
# 只匹配同时含 <| 与 |> 的形式：早期实现用的 "<[^<>]*|[^<>]*>" 过宽，
# 会把正文里合法的 <a|b> 片段（表格、URL）一起吃掉。
_SPECIAL_TOKEN_RE = re.compile(r"<\|[^<>]{0,64}\|>")
_THINK_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_TAG_RE = re.compile(r"</?think\b[^>]*>", re.IGNORECASE)


def clean_model_text(text: str) -> str:
    """通用输出清洗：特殊 token、思考块、包裹正文的代码围栏。

    只做与业务无关的清洗。「能不能出现某个数字」属于工具自己的提示词约束，
    不在全局层兜。
    """
    cleaned = _SPECIAL_TOKEN_RE.sub("", text)
    cleaned = _THINK_BLOCK_RE.sub("", cleaned)
    cleaned = _THINK_TAG_RE.sub("", cleaned)
    stripped = cleaned.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        while lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


def _retry_wait(base: float) -> Any:
    """退避策略：指数 + 抖动；base=0 表示不等待（管理台可以这么配）。"""
    if base <= 0:
        return wait_fixed(0)
    return wait_exponential_jitter(
        initial=base, max=MAX_BACKOFF_SECONDS, jitter=base * 0.4
    )


class _Gate:
    """并发闸门：限制在途请求数，并给等待者设上限。

    等待上限的存在理由：asyncio.Semaphore 自身排队无界，本地模型一旦被超发，
    请求会排到超时，用户看到的是「转圈三分钟后失败」。有界排队 + 429 才能把
    「系统已饱和」这个事实如实反馈给客户端。
    """

    def __init__(self, capacity: int, max_queued: int, metrics: LlmMetrics) -> None:
        self.capacity = max(1, capacity)
        self.max_queued = max(0, max_queued)
        self._metrics = metrics
        self._sem = asyncio.Semaphore(self.capacity)
        self._inflight = 0
        self._queued = 0

    @property
    def inflight(self) -> int:
        return self._inflight

    @property
    def queued(self) -> int:
        return self._queued

    async def acquire(self, *, source: str) -> None:
        """取得执行权；饱和时立即抛 LlmBusyError，绝不无界排队。"""
        if self._inflight >= self.capacity and self._queued >= self.max_queued:
            self._metrics.record_rejection()
            logger.warning(
                "LLM 闸门拒绝请求: source={} inflight={} queued={} capacity={}",
                source,
                self._inflight,
                self._queued,
                self.capacity,
            )
            raise LlmBusyError(
                f"模型服务繁忙（{self.capacity} 路并发已满、{self._queued} 个请求在排队），"
                "请稍后重试"
            )
        self._queued += 1
        self._metrics.set_queued(self._queued)
        try:
            await self._sem.acquire()
        finally:
            # 等待中被取消（客户端断开）时也要把排队计数收回来
            self._queued -= 1
            self._metrics.set_queued(self._queued)
        self._inflight += 1
        self._metrics.enter_inflight()

    def release(self) -> None:
        self._inflight = max(0, self._inflight - 1)
        self._metrics.exit_inflight()
        self._sem.release()


@dataclass
class _LoopRuntime:
    """单个事件循环里的运行时：client / provider / 闸门都绑循环。"""

    client: httpx.AsyncClient
    provider: BaseLlmProvider
    gate: _Gate
    fingerprint: tuple[Any, ...]
    # 在途/排队引用数：配置变更后旧运行时退休而不是立即关闭，
    # 等最后一个持有者松手才关 client（见 release_user）
    users: int = 0
    retired: bool = False

    async def release_user(self) -> None:
        self.users -= 1
        if self.retired and self.users == 0:
            await self.client.aclose()


class LlmGateway:
    """全局模型网关；生命周期由 app lifespan 托管。

    熔断、缓存、指标是跳线程安全的全局状态，跳循环共享才有意义；而 httpx
    AsyncClient 与 asyncio 的信号量/锁都绑事件循环，所以运行时按循环各持一份。
    uvicorn 生产只有一个循环，而测试套件与热重载会反复换循环，共用一份会在第
    二次使用时报 got Future attached to a different loop。
    """

    def __init__(self) -> None:
        self.metrics = LlmMetrics()
        self.cache = LlmResultCache()
        # 弱引用键：循环销毁时运行时自然消失，不会滞留在已关闭的循环上
        self._runtimes: WeakKeyDictionary[asyncio.AbstractEventLoop, _LoopRuntime] = (
            WeakKeyDictionary()
        )
        self._rebuild_locks: WeakKeyDictionary[
            asyncio.AbstractEventLoop, asyncio.Lock
        ] = WeakKeyDictionary()
        self._probe_locks: WeakKeyDictionary[
            asyncio.AbstractEventLoop, asyncio.Lock
        ] = WeakKeyDictionary()
        # 熔断状态（参照 LiteLLM 的 allowed_fails + cooldown_time）
        self._consecutive_failures = 0
        self._cooldown_until = 0.0
        self._last_error: str | None = None
        self._probe: ProbeOutcome | None = None

    # ----- 生命周期 -----

    async def startup(self) -> None:
        """预热配置与连接池；模型服务不可用不阻断应用启动。"""
        try:
            profile = await resolve_profile_async()
            await self._runtime(profile)
            logger.info(
                "LLM 网关就绪: provider={} base_url={} model={} concurrency={} queued={}",
                profile.provider,
                profile.base_url,
                profile.model,
                profile.max_concurrency,
                profile.max_queued,
            )
        except Exception as exc:  # 配置读取异常不阻断启动，状态接口会暴露原因
            logger.warning("LLM 网关预热失败（应用继续启动）: {}", exc)

    async def shutdown(self) -> None:
        """关闭当前循环的运行时；其他循环的运行时随循环销毁。"""
        runtime = self._runtimes.pop(asyncio.get_running_loop(), None)
        if runtime is not None:
            await runtime.client.aclose()

    # ----- 运行时：按配置指纹复用或重建 -----

    async def _runtime(self, profile: LlmProfile) -> _LoopRuntime:
        """配置未变则复用长生命周期连接池；变了才重建并清缓存。

        重建不掐断在途请求：旧运行时标记退休，引用计数归零才关 client。
        立即关闭会把还在旧 provider 上跑的推理（最长 180 秒的流式）和
        排旧闸门队列的请求全打断，一次改配置就可能把自己打进熔断冷却。
        """
        fingerprint = (
            profile.provider,
            profile.base_url,
            profile.connect_timeout_seconds,
            profile.timeout_seconds,
            profile.max_concurrency,
            profile.max_queued,
            profile.config_version,
        )
        loop = asyncio.get_running_loop()
        current = self._runtimes.get(loop)
        if current is not None and current.fingerprint == fingerprint:
            return current

        # 重建锁也是跳循环的：跳循环自己串行化，不需要一把全局锁把所请求串起来
        async with self._loop_lock(self._rebuild_locks, loop):
            current = self._runtimes.get(loop)
            if current is not None and current.fingerprint == fingerprint:
                return current
            if current is not None:
                current.retired = True
                if current.users == 0:
                    await current.client.aclose()
                else:
                    logger.info(
                        "LLM 配置已变更，旧运行时还有 {} 个在途/排队请求，等待其自然结束后关闭",
                        current.users,
                    )
            # 连接池上限跟着闸门走：池子里堆一堆永远拿不到闸门的连接没有任何好处
            client = httpx.AsyncClient(
                limits=httpx.Limits(
                    max_connections=profile.max_concurrency + profile.max_queued + 1,
                    max_keepalive_connections=profile.max_concurrency + 1,
                ),
                timeout=httpx.Timeout(
                    connect=profile.connect_timeout_seconds,
                    read=profile.timeout_seconds,
                    write=profile.timeout_seconds,
                    pool=profile.connect_timeout_seconds,
                ),
                # 显式关闭环境代理：内网直连本地模型，不能让 HTTPS_PROXY 插进来
                trust_env=False,
            )
            runtime = _LoopRuntime(
                client=client,
                provider=create_provider(client, profile),
                # 闸门跟容量同生命期：容量改了闸门不重建就是数据不一致
                gate=_Gate(profile.max_concurrency, profile.max_queued, self.metrics),
                fingerprint=fingerprint,
            )
            self._runtimes[loop] = runtime
            if current is not None:
                logger.info(
                    "LLM 配置已变更，重建运行时并清空缓存 {} 条", self.cache.clear()
                )
            return runtime

    @staticmethod
    def _loop_lock(
        store: WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock],
        loop: asyncio.AbstractEventLoop,
    ) -> asyncio.Lock:
        """每个循环一把锁：避免同一循环内并发重建出两个连接池 / 重复探活。"""
        lock = store.get(loop)
        if lock is None:
            lock = asyncio.Lock()
            store[loop] = lock
        return lock

    @staticmethod
    def _ensure_usable(profile: LlmProfile) -> None:
        """把「现在能不能调」的判断收在一处，各端点不再各写一遍。"""
        if not profile.enabled:
            raise LlmDisabledError("模型服务已被管理员关闭")
        if not profile.configured:
            raise LlmNotConfiguredError("模型服务未配置（缺少服务地址或模型名）")

    # ----- 非流式 -----

    async def complete(self, request: LlmRequest) -> LlmResult:
        """一次补全。返回前已完成清洗、记账与写缓存。"""
        profile = await resolve_profile_async()
        self._ensure_usable(profile)
        started = time.monotonic()

        cache_key = request.cache_key(profile)
        if request.use_cache is not False:
            hit = self.cache.get(cache_key, profile.cache_ttl_seconds)
            if hit is not None:
                self.metrics.record_outcome("cached", source=request.source)
                return LlmResult(
                    content=hit.content,
                    model=hit.model,
                    provider=hit.provider,
                    usage=hit.usage,
                    elapsed_ms=0,
                    cached=True,
                    finish_reason=hit.finish_reason,
                )

        runtime = await self._runtime(profile)
        # 与 _runtime 返回处于同一任务步、中间没有 await：先记引用，
        # 重建方就不会在这一刻把旧 client 判定为空闲而提前关闭
        runtime.users += 1
        provider, gate = runtime.provider, runtime.gate
        # _enter 的拒绝（闸门满 / 冷却）不是模型失败，不能进熔断记账；
        # 单独守卫，失败时只归还引用
        try:
            await self._enter(profile, gate, source=request.source)
        except BaseException:
            await runtime.release_user()
            raise
        try:
            completion = await self._call_with_retry(provider, request, profile)
        except LlmError as exc:
            self._record_failure(exc, profile=profile, source=request.source)
            raise
        finally:
            gate.release()
            await runtime.release_user()

        content = clean_model_text(completion.content)
        if not content:
            empty = LlmEmptyResponseError(
                "模型返回空内容：多为思考过程占满上下文预算，请调大上下文或降低思考强度"
            )
            self._record_failure(empty, profile=profile, source=request.source)
            raise empty

        elapsed_ms = int((time.monotonic() - started) * 1000)
        result = LlmResult(
            content=content,
            model=completion.model or profile.model,
            provider=provider.kind,
            usage=completion.usage,
            elapsed_ms=elapsed_ms,
            cached=False,
            finish_reason=completion.finish_reason,
        )
        self.metrics.record_latency(elapsed_ms, source=request.source)
        self.metrics.record_outcome("ok", source=request.source)
        self.metrics.record_tokens(
            result.usage.prompt_tokens, result.usage.completion_tokens
        )
        self._consecutive_failures = 0
        self.cache.set(
            cache_key, result, profile.cache_ttl_seconds, profile.cache_max_entries
        )
        logger.info(
            "LLM 调用成功: source={} provider={} model={} elapsed={}ms tokens={}",
            request.source,
            provider.kind,
            result.model,
            elapsed_ms,
            result.usage.total_tokens,
        )
        return result

    async def _call_with_retry(
        self, provider: BaseLlmProvider, request: LlmRequest, profile: LlmProfile
    ) -> ProviderCompletion:
        """非流式补全；重试机制交给 tenacity。

        分工是刻意的：tenacity 只管机制（几次、怎么退避、怎么记账），
        「哪些错误值得重试」这个判断留在 LlmError.retryable 里 —— 这是本项目的
        领域知识，任何通用库都不该替我们决定。与 LiteLLM / LangChain 的重试
        实现是同一套分工。
        reraise=True 保证抛的是原始 LlmError 而不是 RetryError，否则端点抓不到错误码。
        """

        def note_retry(state: RetryCallState) -> None:
            exc = state.outcome.exception() if state.outcome else None
            code = getattr(exc, "code", "llm_error")
            detail = getattr(exc, "detail", None) or getattr(exc, "message", str(exc))
            logger.warning(
                "LLM 调用失败，准备重试（第 {} 次，上限 {} 次）: source={} code={} "
                "wait={:.2f}s detail={}",
                state.attempt_number,
                profile.max_retries + 1,
                request.source,
                code,
                state.upcoming_sleep,
                detail,
            )
            self.metrics.record_retry(source=request.source)

        async for attempt in AsyncRetrying(
            retry=retry_if_exception(
                lambda exc: isinstance(exc, LlmError) and exc.retryable
            ),
            stop=stop_after_attempt(profile.max_retries + 1),
            wait=_retry_wait(profile.retry_base_delay_seconds),
            before_sleep=note_retry,
            reraise=True,
        ):
            with attempt:
                return await provider.complete(request)

        # reraise=True + stop_after_attempt 保证循环要么返回要么抛错
        raise AssertionError("LLM 重试循环异常退出")  # pragma: no cover

    # ----- 流式 -----

    async def stream(self, request: LlmRequest) -> AsyncIterator[LlmChunk]:
        """流式补全，逐段产出正文增量，最后一段带完整结果。

        两处刻意与 complete 不同：
        - 闸门在整个流期间持续持有（流式请求同样占着模型）；
        - 重试只发生在第一个正文片段之前，至多一次（见下方注释）。
        """
        profile = await resolve_profile_async()
        self._ensure_usable(profile)
        started = time.monotonic()

        cache_key = request.cache_key(profile)
        if request.use_cache is not False:
            hit = self.cache.get(cache_key, profile.cache_ttl_seconds)
            if hit is not None:
                self.metrics.record_outcome("cached", source=request.source)
                cached = LlmResult(
                    content=hit.content,
                    model=hit.model,
                    provider=hit.provider,
                    usage=hit.usage,
                    elapsed_ms=0,
                    cached=True,
                    finish_reason=hit.finish_reason,
                )
                yield LlmChunk(delta=cached.content, is_final=True, result=cached)
                return

        runtime = await self._runtime(profile)
        runtime.users += 1  # 同 complete：先记引用再进闸门
        provider, gate = runtime.provider, runtime.gate
        # 同 complete：闸门拒绝不进熔断记账，失败时只归还引用
        try:
            await self._enter(profile, gate, source=request.source)
        except BaseException:
            await runtime.release_user()
            raise
        pieces: list[str] = []
        # 流式的重试窗口只到「第一个正文片段」为止：失败点集中在建连与首 token，
        # 已经吐过字再重放会让用户看到重复内容。因此这里不套 tenacity，
        # 而是显式取首片段，至多重试一次。
        attempts = 2 if profile.max_retries > 0 else 1
        try:
            stream_iter: AsyncIterator[str] | None = None
            for attempt in range(attempts):
                candidate = provider.stream(request)
                try:
                    first = await candidate.__anext__()
                except StopAsyncIteration:
                    first = ""  # 上游正常结束但没给正文
                except LlmError as exc:
                    await candidate.aclose()
                    if not exc.retryable or attempt >= attempts - 1:
                        raise
                    logger.warning(
                        "LLM 流式调用失败，准备重试（首片段之前）: source={} code={}",
                        request.source,
                        exc.code,
                    )
                    self.metrics.record_retry(source=request.source)
                    await asyncio.sleep(profile.retry_base_delay_seconds)
                    continue
                stream_iter = candidate
                break

            if stream_iter is not None:
                # aclosing：客户端中途断开时把上游响应连接关掉，
                # 否则半成品生成器只能等 GC，本地模型服务会堆住连接。
                # 首片段也在这个作用域里产出：消费方可能停在第一次
                # yield 处就关闭生成器，那之前它必须已被 aclosing 接管
                async with aclosing(stream_iter):
                    if first:
                        pieces.append(first)
                        yield LlmChunk(delta=first)
                    async for delta in stream_iter:
                        if delta:
                            pieces.append(delta)
                            yield LlmChunk(delta=delta)
        except LlmError as exc:
            self._record_failure(exc, profile=profile, source=request.source)
            raise
        finally:
            gate.release()
            await runtime.release_user()

        content = clean_model_text("".join(pieces))
        if not content:
            empty = LlmEmptyResponseError(
                "模型返回空内容：多为思考过程占满上下文预算，请调大上下文或降低思考强度"
            )
            self._record_failure(empty, profile=profile, source=request.source)
            raise empty

        elapsed_ms = int((time.monotonic() - started) * 1000)
        # 流式不回报 token 用量：要拿 usage 得发 stream_options.include_usage，
        # 严格的服务端会因为这个字段直接 400，不值得为指标冒失败风险。
        result = LlmResult(
            content=content,
            model=profile.model,
            provider=provider.kind,
            usage=LlmUsage(),
            elapsed_ms=elapsed_ms,
            cached=False,
        )
        self.metrics.record_latency(elapsed_ms, source=request.source)
        self.metrics.record_outcome("ok", source=request.source)
        self._consecutive_failures = 0
        self.cache.set(
            cache_key, result, profile.cache_ttl_seconds, profile.cache_max_entries
        )
        yield LlmChunk(is_final=True, result=result)

    # ----- 闸门进入（含冷却判定）-----

    async def _enter(self, profile: LlmProfile, gate: _Gate, *, source: str) -> None:
        remaining = self._cooldown_until - time.monotonic()
        if remaining > 0:
            raise LlmCoolingDownError(
                f"模型服务连续失败已进入冷却，约 {int(remaining) + 1} 秒后自动恢复"
            )
        await gate.acquire(source=source)

    # ----- 失败记账与熔断 -----

    def _record_failure(
        self, exc: LlmError, *, profile: LlmProfile, source: str
    ) -> None:
        self.metrics.record_outcome("error", source=source, code=exc.code)
        self._consecutive_failures += 1
        self._last_error = exc.message
        if self._consecutive_failures < profile.allowed_failures:
            logger.warning(
                "LLM 调用失败: source={} code={} detail={}",
                source,
                exc.code,
                exc.detail or exc.message,
            )
            return
        self._cooldown_until = time.monotonic() + profile.cooldown_seconds
        self._consecutive_failures = 0
        self.metrics.mark_cooldown()
        logger.warning(
            "LLM 连续失败达到 {} 次，进入冷却 {}s: code={} detail={}",
            profile.allowed_failures,
            profile.cooldown_seconds,
            exc.code,
            exc.detail or exc.message,
        )

    def reset_breaker(self) -> None:
        """管理员改配置后调用：立即退出冷却，让新配置马上可验证。"""
        self._consecutive_failures = 0
        self._cooldown_until = 0.0
        self._last_error = None
        self.metrics.clear_cooldown()
        self.invalidate_probe_cache()

    # ----- 状态与探活 -----

    async def probe(self, *, force: bool = False) -> ProbeOutcome:
        """探活上游（顺带列模型）。结果按 TTL 复用，避免状态页把模型压垮。"""
        # TTL 是运行时配置（管理台可覆盖），所以先解析配置再判新鲜度。
        # 配置写入路径会显式 invalidate_probe_cache()，不会因为复用而读到旧结论。
        profile = await resolve_profile_async()
        ttl = profile.health_cache_ttl_seconds
        fresh = (
            self._probe is not None and time.monotonic() - self._probe.checked_at < ttl
        )
        if not force and fresh:
            return self._probe  # type: ignore[return-value]

        async with self._loop_lock(self._probe_locks, asyncio.get_running_loop()):
            fresh = (
                self._probe is not None
                and time.monotonic() - self._probe.checked_at < ttl
            )
            if not force and fresh:
                return self._probe  # type: ignore[return-value]
            now = time.monotonic()
            if not profile.configured:
                outcome = ProbeOutcome(
                    ok=False,
                    reachable=False,
                    error="未配置服务地址或模型名",
                    checked_at=now,
                )
            else:
                # 探活同样经当前 provider 出网，也要占一个引用：否则改配置时
                # 旧运行时就地关 client，会把正在跑的 /models 请求掐掉
                runtime = await self._runtime(profile)
                runtime.users += 1
                try:
                    provider = runtime.provider
                    try:
                        models = await provider.list_models()
                    except LlmError as exc:
                        # 4xx/5xx 说明 TCP 与端口是通的，只有连接类错误才是真不可达
                        outcome = ProbeOutcome(
                            ok=False,
                            reachable=exc.code != "llm_unreachable",
                            error=exc.message,
                            checked_at=now,
                        )
                    else:
                        # 能力跟模型服务走，不跟请求走：同一次探活顺带拉一次，
                        # 结果跟着 probe 缓存一起复用，不会每次状态查询都打 /props
                        try:
                            capabilities = await provider.capabilities()
                        except LlmError as exc:
                            logger.debug("读取服务端能力失败（不影响探活）: {}", exc)
                            capabilities = None
                        outcome = ProbeOutcome(
                            ok=True,
                            reachable=True,
                            models=models,
                            checked_at=now,
                            capabilities=capabilities,
                        )
                finally:
                    await runtime.release_user()
            self._probe = outcome
            return outcome

    def invalidate_probe_cache(self) -> None:
        """配置变更后调用：下一次状态查询重新探活。"""
        self._probe = None

    async def status(self, *, probe: bool = True) -> dict[str, Any]:
        """给 /llm/status 用的全景视图：配置 + 队列 + 指标 + 缓存 + 探活。"""
        profile = await resolve_profile_async()
        runtime = self._runtimes.get(asyncio.get_running_loop())
        gate = runtime.gate if runtime is not None else None
        outcome = await self.probe() if probe and profile.configured else None
        listed = outcome.models if outcome is not None else []
        cooldown_active = time.monotonic() < self._cooldown_until
        # available 是前端按钮态的唯一契约字段：冷却中或探活已明确失败
        # 就不能报「可用」，否则语义只在 enabled+configured 的调用方会被误导
        available = (
            profile.enabled
            and profile.configured
            and not cooldown_active
            and (outcome is None or outcome.ok)
        )
        return {
            "enabled": profile.enabled,
            "configured": profile.configured,
            "available": available,
            "cooldownActive": cooldown_active,
            "lastError": self._last_error,
            "lastProbe": outcome.as_dict() if outcome is not None else None,
            "modelListed": (profile.model in listed) if listed else None,
            "supportedProviders": list(supported_providers()),
            "gate": {
                "capacity": profile.max_concurrency,
                "maxQueued": profile.max_queued,
                "inflight": gate.inflight if gate else 0,
                "queued": gate.queued if gate else 0,
            },
            "cache": self.cache.snapshot(),
            "metrics": self.metrics.snapshot(),
            **profile.describe(),
        }


# 全局单例：所有工具与端点共用这一个网关实例
llm_gateway = LlmGateway()

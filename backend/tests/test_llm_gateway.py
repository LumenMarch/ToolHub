"""网关级行为回归测试。

provider 层的协议测试（test_llm_openai_provider.py）从不触碰 LlmGateway，
gateway.py 里这几段逻辑因此长期裸奔并出过线上事故：

- probe() 曾按 (provider, gate) 元组解包 _runtime() 的新返回值，
  管理台点「测试连接」直接 TypeError；
- status() 的 available 必须把冷却与探活失败算进去；
- 配置重建必须退休旧运行时而不是掐断在途请求（引用计数归零才关 client）。

这里全程离线：create_provider 被替换成桩，不碰任何真实模型服务。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from app.services.llm import gateway as gateway_mod
from app.services.llm.errors import LlmUnreachableError
from app.services.llm.gateway import LlmGateway
from app.services.llm.types import LlmProfile, ProbeOutcome


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
        "max_concurrency": 1,
        "max_queued": 2,
        "max_retries": 0,
        "retry_base_delay_seconds": 0.1,
        "allowed_failures": 3,
        "cooldown_seconds": 30.0,
        "cache_ttl_seconds": 60,
        "cache_max_entries": 128,
        "health_cache_ttl_seconds": 60.0,
    }
    base.update(overrides)
    return LlmProfile(**base)  # type: ignore[arg-type]


class StubProvider:
    """只实现探活会调的两个方法。"""

    def __init__(self, models: Any = None, error: Exception | None = None) -> None:
        self._models = models if models is not None else ["stub-model"]
        self._error = error

    async def list_models(self) -> list[str]:
        if self._error is not None:
            raise self._error
        return list(self._models)

    async def capabilities(self) -> Any:
        return None


def patch_gateway(
    monkeypatch: pytest.MonkeyPatch, profile: LlmProfile, provider: StubProvider
) -> None:
    async def fake_resolve() -> LlmProfile:
        return profile

    monkeypatch.setattr(gateway_mod, "resolve_profile_async", fake_resolve)
    monkeypatch.setattr(
        gateway_mod, "create_provider", lambda client, _profile: provider
    )


def test_probe_reports_models_and_releases_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """回归：probe() 必须能在 _runtime() 返回对象的新签名下工作，且用完松手。"""
    gateway = LlmGateway()
    patch_gateway(monkeypatch, make_profile(), StubProvider())

    async def main() -> None:
        outcome = await gateway.probe(force=True)
        assert outcome.ok and outcome.models == ["stub-model"]
        runtime = gateway._runtimes[asyncio.get_running_loop()]
        assert runtime.users == 0  # 探活不松手的话，旧运行时永远退不掉

    asyncio.run(main())


def test_probe_failure_still_releases_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = LlmGateway()
    patch_gateway(
        monkeypatch,
        make_profile(),
        StubProvider(error=LlmUnreachableError("refused")),
    )

    async def main() -> None:
        outcome = await gateway.probe(force=True)
        assert not outcome.ok and not outcome.reachable
        runtime = gateway._runtimes[asyncio.get_running_loop()]
        assert runtime.users == 0

    asyncio.run(main())


def test_rebuild_retires_old_runtime_until_holders_release() -> None:
    """改配置不得掐断在途请求：旧运行时先退休，引用归零才关 client。"""
    gateway = LlmGateway()

    async def main() -> None:
        old = await gateway._runtime(make_profile())
        old.users += 1  # 模拟一个还在跑的流式请求
        # 换 model 不触发重建（模型不在连接池指纹里）；改容量才触发
        await gateway._runtime(make_profile(max_concurrency=2))
        assert old.retired and not old.client.is_closed
        await old.release_user()
        assert old.client.is_closed

    asyncio.run(main())


def test_status_marks_cooldown_and_failed_probe_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gateway = LlmGateway()
    profile = make_profile()
    patch_gateway(monkeypatch, profile, StubProvider())

    async def main() -> None:
        ok_view = await gateway.status(probe=False)
        assert ok_view["available"] and not ok_view["cooldownActive"]

        gateway._cooldown_until = time.monotonic() + 30.0
        cooling = await gateway.status(probe=False)
        assert not cooling["available"] and cooling["cooldownActive"]
        gateway._cooldown_until = 0.0

        # probe=True + 新鲜缓存：不联网直接复用这条失败结论
        gateway._probe = ProbeOutcome(
            ok=False, reachable=True, error="502", checked_at=time.monotonic()
        )
        failed = await gateway.status(probe=True)
        assert not failed["available"]

    asyncio.run(main())

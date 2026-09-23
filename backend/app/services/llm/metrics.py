"""LLM 网关的运行时观测指标。

只解决一个决策问题：这台机器的模型服务「够不够用、慢在哪、失败在哪」。
没有接 Prometheus，进程内计数 + /llm/status 暴露是当前部署形态
（Nuitka 单产物、单机内网）下成本最低的方案；字段命名按可直接被
将来导出成 metrics 的形式设计。

延迟用固定长度样本池（默认 200 条）算分位数：本地模型单次推理 3~180 秒，
样本量本来就小，保留最近若干条比维护精确直方图更符合实际用途。
"""

from __future__ import annotations

import threading
import time
from collections import Counter, defaultdict, deque
from typing import Any

LATENCY_SAMPLE_SIZE = 200


def _percentile(samples: list[float], pct: float) -> float:
    """最近秩分位数；样本为空时返回 0。"""
    if not samples:
        return 0.0
    ordered = sorted(samples)
    idx = min(len(ordered) - 1, max(0, round((pct / 100) * (len(ordered) - 1))))
    return round(ordered[idx], 1)


class LlmMetrics:
    """线程安全计数器集合。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latencies: deque[float] = deque(maxlen=LATENCY_SAMPLE_SIZE)
        self._outcomes: Counter[str] = Counter()
        self._error_codes: Counter[str] = Counter()
        self._by_source: dict[str, Counter[str]] = defaultdict(Counter)
        self._prompt_tokens = 0
        self._completion_tokens = 0
        self._inflight = 0
        self._queued = 0
        self._peak_queued = 0
        self._rejections = 0
        self._cooldown_since: float | None = None
        self._started_at = time.time()

    def record_latency(self, elapsed_ms: float, *, source: str) -> None:
        with self._lock:
            self._latencies.append(elapsed_ms)
            self._by_source[source]["requests"] += 1

    def record_outcome(
        self, outcome: str, *, source: str, code: str | None = None
    ) -> None:
        """outcome: ok / cached / error / rejected。"""
        with self._lock:
            self._outcomes[outcome] += 1
            self._by_source[source][outcome] += 1
            if code:
                self._error_codes[code] += 1

    def record_tokens(
        self, prompt_tokens: int | None, completion_tokens: int | None
    ) -> None:
        with self._lock:
            self._prompt_tokens += prompt_tokens or 0
            self._completion_tokens += completion_tokens or 0

    def record_retry(self, *, source: str) -> None:
        with self._lock:
            self._by_source[source]["retries"] += 1

    def enter_inflight(self) -> None:
        with self._lock:
            self._inflight += 1

    def exit_inflight(self) -> None:
        with self._lock:
            self._inflight = max(0, self._inflight - 1)

    def set_queued(self, queued: int) -> None:
        with self._lock:
            self._queued = queued
            self._peak_queued = max(self._peak_queued, queued)

    def record_rejection(self) -> None:
        with self._lock:
            self._rejections += 1

    def mark_cooldown(self) -> None:
        with self._lock:
            if self._cooldown_since is None:
                self._cooldown_since = time.time()

    def clear_cooldown(self) -> None:
        with self._lock:
            self._cooldown_since = None

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            samples = list(self._latencies)
            total = sum(self._outcomes.values())
            errors = self._outcomes["error"] + self._outcomes["rejected"]
            return {
                "requests": total,
                "ok": self._outcomes["ok"],
                "cached": self._outcomes["cached"],
                "errors": self._outcomes["error"],
                "rejections": self._rejections,
                "errorPercent": round(errors * 100 / total, 1) if total else 0.0,
                "p50LatencyMs": _percentile(samples, 50),
                "p95LatencyMs": _percentile(samples, 95),
                "maxLatencyMs": round(max(samples), 1) if samples else 0.0,
                "latencySamples": len(samples),
                "promptTokens": self._prompt_tokens,
                "completionTokens": self._completion_tokens,
                "inflight": self._inflight,
                "queued": self._queued,
                "peakQueued": self._peak_queued,
                "errorCodes": dict(self._error_codes),
                "cooldownActive": self._cooldown_since is not None,
                "cooldownSince": self._cooldown_since,
                "uptimeSeconds": round(time.time() - self._started_at),
                "bySource": {
                    src: dict(counter) for src, counter in self._by_source.items()
                },
            }

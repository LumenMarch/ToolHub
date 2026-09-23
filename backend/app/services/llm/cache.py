"""LLM 结果缓存：直接复用 cachetools.TTLCache。

TTL 到期、LRU 淘汰、容量收缩这些边界一律交给 cachetools 保证（十年久经考验的
实现），这里只补它没有的两件事：命中/未命中计数，以及「按调用方给的 ttl 决定
要不要缓存」这条业务规则。

为什么落进程内而不是磁盘：
- 单条结论只有几 KB，TTL 15 分钟，重启后复用价值接近于零；
- 磁盘产物存储（DESIGN.md §2.3）已明确记录了单进程假设与 Windows ACL 注意事项，
  没必要再往里塞一类高频小对象；
- 缓存未命中的代价只是「多推理一次」，不是数据丢失。

调用方（网关）保证「查缓存发生在拿并发闸门之前」：否则缓存命中的请求也要在
GPU 队列后面排队，缓存就失去意义了（LangChain 在 _generate_with_cache 里把
rate_limiter.acquire() 放在缓存查询之后，同理）。
"""

from __future__ import annotations

import threading
from typing import Any

from cachetools import TTLCache

from app.services.llm.types import LlmResult


class LlmResultCache:
    """带命中率统计的 TTL + LRU 缓存。

    cachetools 本身不是线程安全的（它的 @cached 装饰器另外加了锁），而网关里
    await 点会让多个协程交错执行，因此读写仍要在一把锁内完成 —— 操作全是内存
    计算，用 threading.Lock 足够，不需要事件循环原语。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # maxsize 由写入方给定；这里先建一个空壳，实际容量在 set() 里按配置重建
        self._cache: TTLCache[str, LlmResult] = TTLCache(maxsize=1, ttl=1)
        self._max_entries = 1
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def _ensure_shape(self, ttl_seconds: int, max_entries: int) -> None:
        """配置里容量或 TTL 变了就重建缓存，避免旧参数继续生效。"""
        if (
            self._max_entries == max_entries
            and self._cache.ttl == ttl_seconds
            and self._cache.maxsize == max_entries
        ):
            return
        self._cache = TTLCache(maxsize=max_entries, ttl=ttl_seconds)
        self._max_entries = max_entries

    def get(self, key: str, ttl_seconds: int) -> LlmResult | None:
        """取结果；ttl<=0 视为禁用缓存，直接计一次未命中。"""
        if ttl_seconds <= 0:
            with self._lock:
                self._misses += 1
            return None
        with self._lock:
            # cachetools 访问时自行判定条目是否过期，过期即 miss，这里无需自查
            result = self._cache.get(key)
            if result is None:
                self._misses += 1
                return None
            self._hits += 1
            return result

    def set(
        self, key: str, result: LlmResult, ttl_seconds: int, max_entries: int
    ) -> None:
        """写入结果；ttl<=0 或容量为 0 时不缓存。"""
        if ttl_seconds <= 0 or max_entries <= 0:
            return
        with self._lock:
            self._ensure_shape(ttl_seconds, max_entries)
            before = self._cache.currsize
            self._cache[key] = result
            # 超出容量时 cachetools 会先清过期项再按 LRU 淘汰，这里只负责记账
            if before == self._cache.maxsize and self._cache.currsize == before:
                self._evictions += 1

    def clear(self) -> int:
        """清空并返回被丢弃的条目数（配置变更时由网关调用）。"""
        with self._lock:
            removed = self._cache.currsize
            self._cache.clear()
            return removed

    def snapshot(self) -> dict[str, Any]:
        """指标快照；命中率以 (hits+misses) 为分母，未发生过请求时为 0。"""
        with self._lock:
            total = self._hits + self._misses
            return {
                "entries": self._cache.currsize,
                "capacity": self._cache.maxsize,
                "ttlSeconds": self._cache.ttl,
                "hits": self._hits,
                "misses": self._misses,
                "evictions": self._evictions,
                "hitPercent": round(self._hits * 100 / total, 1) if total else 0.0,
            }

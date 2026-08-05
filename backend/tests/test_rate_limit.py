"""注册限流器（滑动窗口）清理行为测试。

回归 PR #49 的 P2：旧实现 _prune 只删空 deque，一次性访问者留下的
"过期但非空"条目永不清理，超过阈值后内存无限增长；且 prune 每请求全量
扫描。修复后：过期/空条目一并删除，且清理最多每窗口执行一次。
"""

import time

from app.core.rate_limit import _SlidingWindowLimiter


class _FakeClient:
    host = "1.2.3.4"


class _FakeRequest:
    """仅提供 _client_ip 需要的 client.host。"""

    client = _FakeClient()


def test_prune_removes_stale_and_empty_entries():
    limiter = _SlidingWindowLimiter(max_requests=10, window_seconds=100)
    limiter._PRUNE_THRESHOLD = 3  # 实例级调小阈值，便于触发清理
    now = time.monotonic()
    limiter._last_prune = now - 1000  # 确保满足窗口间隔，本次必触发 prune
    limiter._hits["stale-a"].append(now - 500)  # 全部时间戳已过期
    limiter._hits["stale-b"].append(now - 500)
    limiter._hits["active"].append(now)  # 窗口内活跃，必须保留
    limiter._hits["empty"]  # 空 deque

    limiter(_FakeRequest())

    assert set(limiter._hits) == {"active", "1.2.3.4"}
    assert len(limiter._hits) <= limiter._PRUNE_THRESHOLD
    # 清理后已记录本次清理时间
    assert limiter._last_prune >= now


def test_prune_converges_with_many_one_time_ips():
    """一次性访问者（过期条目）被批量清理，字典大小收敛不再无限增长。"""
    limiter = _SlidingWindowLimiter(max_requests=10, window_seconds=100)
    limiter._PRUNE_THRESHOLD = 5
    now = time.monotonic()
    limiter._last_prune = now - 1000
    for i in range(50):
        # 每个 IP 只访问过一次且早已过期：旧实现下永不成为空 deque
        limiter._hits[f"one-time-{i}"].append(now - 500)

    limiter(_FakeRequest())

    # 50 个过期条目全部被清理，仅剩当前请求 IP 的新增记录
    assert set(limiter._hits) == {"1.2.3.4"}
    assert "one-time-0" not in limiter._hits
    assert len(limiter._hits) == 1


def test_prune_throttled_to_once_per_window():
    """同一窗口内不重复全量清理：过期条目保留至下一窗口。"""
    limiter = _SlidingWindowLimiter(max_requests=10, window_seconds=100)
    limiter._PRUNE_THRESHOLD = 3
    now = time.monotonic()
    limiter._hits["stale"].append(now - 500)
    limiter._hits["active"].append(now)
    limiter._last_prune = now  # 刚清理过，窗口内不应再清理

    limiter(_FakeRequest())

    # 阈值已满足但窗口间隔未到 → prune 被跳过
    assert "stale" in limiter._hits
    assert limiter._last_prune == now

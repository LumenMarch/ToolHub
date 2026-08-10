"""GET /api/v1/admin/stats/tools 日期范围（days）参数测试。

覆盖：缺省全量、days=N 只统计最近 N 天、days<=0 按全量处理、
以及 count_tool_calls_by_action 不带 since 的回归行为。
"""

from datetime import UTC, datetime, timedelta

from app.crud.crud_audit_log import count_tool_calls_by_action
from app.models.audit_log import AuditLog
from tests.conftest import auth_header


def _seed_tool_calls(db):
    """插入跨越时间边界的审计日志：

    - 3 天前：2 条 tool.qrcode.use、1 条 tool.meta.update
    - 15 天前：1 条 tool.qrcode.use、1 条 tool.color.convert、1 条 tool.meta.bulk_update
    - 额外 1 条非 tool 前缀日志（应始终不计入统计）
    - 额外 2 条 tool.meta.* 管理操作日志（不计入工具调用统计）
    """
    now = datetime.now(UTC)
    recent = (now - timedelta(days=3)).replace(tzinfo=None)
    old = (now - timedelta(days=15)).replace(tzinfo=None)
    db.add_all(
        [
            AuditLog(username="alice", action="tool.qrcode.use", created_at=recent),
            AuditLog(username="alice", action="tool.qrcode.use", created_at=recent),
            AuditLog(username="admin", action="tool.meta.update", created_at=recent),
            AuditLog(username="bob", action="tool.qrcode.use", created_at=old),
            AuditLog(username="bob", action="tool.color.convert", created_at=old),
            AuditLog(username="admin", action="tool.meta.bulk_update", created_at=old),
            AuditLog(username="alice", action="auth.login.failed", created_at=recent),
        ]
    )
    db.commit()


def _tools_stats(admin_client, **params) -> dict[str, int]:
    """调用端点并返回 {action: count} 字典。"""
    client, token = admin_client
    resp = client.get(
        "/api/v1/admin/stats/tools", params=params, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    return {row["action"]: row["count"] for row in resp.json()}


def test_no_days_returns_all(admin_client, db):
    """缺省 days 参数 → 全量统计，与现状一致。"""
    _seed_tool_calls(db)
    stats = _tools_stats(admin_client)
    assert stats["tool.qrcode.use"] == 3
    assert stats["tool.color.convert"] == 1
    assert "auth.login.failed" not in stats  # 非 tool 前缀不计入


def test_days_limits_to_recent(admin_client, db):
    """days=7 → 只包含最近 7 天的 tool.* 调用，边界外被过滤。"""
    _seed_tool_calls(db)
    stats = _tools_stats(admin_client, days=7)
    assert stats["tool.qrcode.use"] == 2
    assert "tool.color.convert" not in stats  # 15 天前，应被过滤


def test_days_zero_or_negative_means_all(admin_client, db):
    """days<=0 → 按全量处理（与缺省一致）。"""
    _seed_tool_calls(db)
    for bad in (0, -5):
        stats = _tools_stats(admin_client, days=bad)
        assert stats["tool.qrcode.use"] == 3
        assert stats["tool.color.convert"] == 1


def test_count_tool_calls_without_since_regression(db):
    """直接调用 CRUD 且不传 since → 全量，行为与改动前一致。"""
    _seed_tool_calls(db)
    rows = dict(count_tool_calls_by_action(db))
    assert rows["tool.qrcode.use"] == 3
    assert rows["tool.color.convert"] == 1
    assert len(rows) == 2


def test_tool_meta_excluded_from_stats(admin_client, db):
    """tool.meta.* 管理操作行不计入统计结果。"""
    _seed_tool_calls(db)
    stats = _tools_stats(admin_client)
    assert "tool.meta.update" not in stats
    assert "tool.meta.bulk_update" not in stats
    rows = dict(count_tool_calls_by_action(db))
    assert "tool.meta.update" not in rows
    assert "tool.meta.bulk_update" not in rows

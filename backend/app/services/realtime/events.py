"""实时通知事件载荷构造（仅 type + 标识，客户端再 REST 拉取）。"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def _at() -> str:
    """UTC ISO-8601 时间戳（秒精度）。"""
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def job_updated_event(
    *,
    job_id: str,
    user_id: int,
    status: str | None = None,
) -> dict[str, Any]:
    """资产核对任务状态/阶段变更通知。"""
    event: dict[str, Any] = {
        "type": "job.updated",
        "job_id": job_id,
        "user_id": user_id,
        "at": _at(),
    }
    if status is not None:
        event["status"] = status
    return event


def job_terminal_event(
    *,
    job_id: str,
    user_id: int,
    status: str,
) -> dict[str, Any]:
    """资产核对任务到达终态。"""
    return {
        "type": "job.terminal",
        "job_id": job_id,
        "user_id": user_id,
        "status": status,
        "at": _at(),
    }


def tools_meta_updated_event() -> dict[str, Any]:
    """管理员变更工具元数据后的广播通知。"""
    return {
        "type": "tools_meta.updated",
        "at": _at(),
    }


def permissions_updated_event(*, user_id: int) -> dict[str, Any]:
    """用户角色/权限变更通知；客户端应重新 GET /users/me。"""
    return {
        "type": "permissions.updated",
        "user_id": user_id,
        "at": _at(),
    }


def session_revoked_event(*, user_id: int) -> dict[str, Any]:
    """会话吊销通知（token_version 已递增）；客户端应登出。"""
    return {
        "type": "session.revoked",
        "user_id": user_id,
        "at": _at(),
    }


def user_status_updated_event(*, user_id: int, status: str) -> dict[str, Any]:
    """用户审批状态变更通知（定向推送目标用户）；客户端刷新 /users/me。"""
    return {
        "type": "user.status.updated",
        "user_id": user_id,
        "status": status,
        "at": _at(),
    }


def user_pending_event(*, user_id: int) -> dict[str, Any]:
    """新注册待审批通知（广播；管理员端据此刷新待审批计数）。

    注：hub 不区分角色推送，前端自行过滤处理。
    """
    return {
        "type": "user.pending",
        "user_id": user_id,
        "at": _at(),
    }

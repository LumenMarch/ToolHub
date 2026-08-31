"""审计日志工具函数。

不使用全局中间件（请求量爆炸），改为在关键 endpoint 内显式调用 log_action。
"""

import json
from typing import Any

from fastapi import Request
from loguru import logger
from sqlalchemy.orm import Session

from app.core.config import settings
from app.crud.crud_audit_log import create_log
from app.models.user import User


def _get_client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    # 仅可信反代配置下信任 XFF（TRUST_PROXY_HEADERS=true）；
    # 直连部署时 X-Forwarded-For 可被客户端伪造，一律用 TCP 对端地址。
    if settings.TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _normalize_detail(detail: Any) -> str | None:
    if detail is None:
        return None
    if isinstance(detail, str):
        return detail
    try:
        return json.dumps(detail, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(detail)


def log_action(
    db: Session,
    *,
    request: Request | None = None,
    user: User | None = None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: Any = None,
) -> None:
    """记录一条审计日志。

    user 为 None 时表示无主体操作（如登录失败）。失败不抛异常，避免影响主流程。
    """
    try:
        create_log(
            db,
            user_id=user.id if user else None,
            username=user.username if user else None,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            detail=_normalize_detail(detail),
            ip_address=_get_client_ip(request),
        )
    except Exception:  # noqa: BLE001
        # 审计日志失败不能阻断业务主流程，但必须可观测。
        logger.exception("audit log write failed action={}", action)

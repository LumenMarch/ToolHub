from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_admin_user
from app.crud.crud_audit_log import get_logs
from app.models.user import User
from app.schemas.audit_log import AuditLogResponse

router = APIRouter()


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int


@router.get("", response_model=AuditLogListResponse)
def list_audit_logs(
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    user_id: int | None = None,
    action: str | None = None,
    action_prefix: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    db: Session = Depends(deps.get_db),
    _: User = Depends(get_current_admin_user),
):
    """查询审计日志，支持多维度筛选。"""
    items, total = get_logs(
        db,
        skip=skip,
        limit=limit,
        user_id=user_id,
        action=action,
        action_prefix=action_prefix,
        date_from=date_from,
        date_to=date_to,
    )
    return {"items": items, "total": total}

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission
from app.crud.crud_tool_meta import bulk_upsert, get_all_metas, upsert_meta
from app.models.user import User
from app.schemas.tool_meta import (
    ToolMetaBulkUpdate,
    ToolMetaResponse,
    ToolMetaUpdate,
)
from app.services.audit import log_action

router = APIRouter()


@router.get("", response_model=list[ToolMetaResponse])
def list_tool_metas(
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("tool_meta:read")),
):
    """列出所有工具元数据覆盖项。"""
    return get_all_metas(db)


@router.patch("/{tool_id}", response_model=ToolMetaResponse)
def update_tool_meta(
    tool_id: str,
    meta_in: ToolMetaUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("tool_meta:write")),
):
    """更新单个工具元数据（不存在则创建）。"""
    meta = upsert_meta(db, tool_id, meta_in)
    log_action(
        db,
        request=request,
        user=admin,
        action="tool.meta.update",
        target_type="tool",
        target_id=tool_id,
        detail=meta_in.model_dump(exclude_none=True),
    )
    return meta


@router.put("", response_model=list[ToolMetaResponse])
def bulk_update_tool_metas(
    payload: ToolMetaBulkUpdate,
    request: Request,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(require_permission("tool_meta:write")),
):
    """批量更新工具元数据（主要用于保存排序）。"""
    metas = bulk_upsert(db, payload.items)
    log_action(
        db,
        request=request,
        user=admin,
        action="tool.meta.bulk_update",
        target_type="tool",
        detail={"count": len(payload.items)},
    )
    return metas

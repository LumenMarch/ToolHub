from sqlalchemy.orm import Session

from app.models.tool_meta import ToolMeta
from app.schemas.tool_meta import ToolMetaBulkItem, ToolMetaUpdate


def get_all_metas(db: Session) -> list[ToolMeta]:
    return db.query(ToolMeta).all()


def get_metas_map(db: Session) -> dict[str, ToolMeta]:
    """返回 {tool_id: ToolMeta} 字典，便于前端 merge。"""
    return {m.tool_id: m for m in db.query(ToolMeta).all()}


def get_meta_by_tool_id(db: Session, tool_id: str) -> ToolMeta | None:
    return db.query(ToolMeta).filter(ToolMeta.tool_id == tool_id).first()


def upsert_meta(
    db: Session, tool_id: str, meta_in: ToolMetaUpdate
) -> ToolMeta:
    """按需更新工具元数据，不存在则新建。"""
    meta = get_meta_by_tool_id(db, tool_id)
    if meta is None:
        meta = ToolMeta(tool_id=tool_id, enabled=True, sort_order=0)
        db.add(meta)

    if meta_in.enabled is not None:
        meta.enabled = meta_in.enabled
    if meta_in.sort_order is not None:
        meta.sort_order = meta_in.sort_order
    if meta_in.custom_name is not None:
        meta.custom_name = meta_in.custom_name
    if meta_in.custom_description is not None:
        meta.custom_description = meta_in.custom_description

    db.commit()
    db.refresh(meta)
    return meta


def bulk_upsert(db: Session, items: list[ToolMetaBulkItem]) -> list[ToolMeta]:
    """批量更新，返回最终状态。"""
    result = []
    for item in items:
        meta = upsert_meta(db, item.tool_id, item)
        result.append(meta)
    return result

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_permission
from app.crud.crud_tool_meta import get_all_metas
from app.models.user import User
from app.schemas.tool_meta import ToolMetaPublicResponse

router = APIRouter()


@router.get("", response_model=list[ToolMetaPublicResponse])
def list_public_tool_metas(
    db: Session = Depends(deps.get_db),
    _: User = Depends(require_permission("tool:use")),
):
    """主控台拉取工具元数据覆盖层。

    需要 tool:use 权限方可使用工具。
    """
    return get_all_metas(db)

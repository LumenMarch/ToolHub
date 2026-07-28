from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import get_current_user
from app.crud.crud_tool_meta import get_all_metas
from app.models.user import User
from app.schemas.tool_meta import ToolMetaPublicResponse

router = APIRouter()


@router.get("", response_model=list[ToolMetaPublicResponse])
def list_public_tool_metas(
    db: Session = Depends(deps.get_db),
    _: User = Depends(get_current_user),
):
    """主控台拉取工具元数据覆盖层。

    任意已登录用户均可访问，用于与前端硬编码的 tools.ts 合并。
    """
    return get_all_metas(db)

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.security import require_user
from app.modules.tool_catalog.schemas import ToolResponse

router = APIRouter(prefix="/api/tools", tags=["工具目录"])
UserDependency = Annotated[str, Depends(require_user)]


@router.get("", response_model=list[ToolResponse])
def list_tools(_: UserDependency) -> list[ToolResponse]:
    return [
        ToolResponse(
            id="csv-compare",
            name="CSV 数据对比",
            description="比较两份 CSV，识别新增、删除和字段变化。",
            category="数据处理",
            status="available",
        )
    ]

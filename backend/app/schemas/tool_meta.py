from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ToolMetaUpdate(BaseModel):
    """单个工具元数据的更新请求，全部字段可选。"""

    enabled: bool | None = None
    sort_order: int | None = None
    custom_name: str | None = None
    custom_description: str | None = None


class ToolMetaBulkItem(ToolMetaUpdate):
    """批量更新时的单项，需指明 tool_id。"""

    tool_id: str


class ToolMetaBulkUpdate(BaseModel):
    """批量更新请求体。"""

    items: list[ToolMetaBulkItem]


class ToolMetaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tool_id: str
    enabled: bool
    sort_order: int
    custom_name: str | None
    custom_description: str | None
    updated_at: datetime


class ToolMetaPublicResponse(BaseModel):
    """主控台拉取的精简结构，只暴露展示所需字段。"""

    tool_id: str
    enabled: bool
    sort_order: int
    custom_name: str | None
    custom_description: str | None

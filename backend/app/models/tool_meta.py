from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String

from app.db.base_class import Base


class ToolMeta(Base):
    """工具元数据覆盖层。

    与前端硬编码的 tools.ts 配合：tools.ts 为全量注册表（含组件），
    本表仅存储运行时可调整的覆盖项（启用/排序/名称/描述）。
    """

    __tablename__ = "tool_metas"

    id = Column(Integer, primary_key=True, index=True)
    # 与前端 tools.ts 的 id 对应
    tool_id = Column(String, unique=True, index=True, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    custom_name = Column(String, nullable=True)
    custom_description = Column(String, nullable=True)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

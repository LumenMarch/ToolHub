from sqlalchemy import Column, Integer, String

from app.db.base_class import Base


class Permission(Base):
    """权限定义表 — 系统中所有可用的权限项。"""

    __tablename__ = "permissions"

    id = Column(Integer, primary_key=True, index=True)
    codename = Column(String, unique=True, nullable=False, index=True)
    description = Column(String, nullable=False)

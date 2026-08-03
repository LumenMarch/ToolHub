from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from app.db.base_class import Base
from app.models.role import user_roles


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    # JWT 会话版本：递增后旧 token（cookie / bearer）全部失效
    token_version = Column(Integer, nullable=False, default=0, server_default="0")

    roles = relationship(
        "Role",
        secondary=user_roles,
        lazy="selectin",
        back_populates="users",
    )

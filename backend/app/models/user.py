from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from app.db.base_class import Base
from app.models.role import user_roles

# 用户审批状态取值（与前端契约一致，勿随意改动字符串值）
USER_STATUS_PENDING = "pending"
USER_STATUS_APPROVED = "approved"
USER_STATUS_REJECTED = "rejected"


class User(Base):
    __tablename__ = "users"
    # 仅新建库时生效；存量库通过 ensure_schema_compat 的 ALTER 补列（无 CHECK），
    # 应用层在写入处统一校验取值。
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_users_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    # 审批状态：注册后 pending，管理员审批通过/驳回；is_active 语义不变（停用）
    status = Column(
        String,
        nullable=False,
        default=USER_STATUS_PENDING,
        server_default=USER_STATUS_PENDING,
    )
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

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
)
from sqlalchemy.orm import relationship

from app.db.base_class import Base
from app.models.role import user_roles

# 用户 ↔ 权限（多对多）— 用户直接持有的工具权限（tool:*:use）。
# 与角色权限是并集关系；仅允许工具权限，管理权限仍只走角色。
user_permissions = Table(
    "user_permissions",
    Base.metadata,
    Column(
        "user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    ),
    Column(
        "permission_id",
        Integer,
        ForeignKey("permissions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

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

    # 用户直接持有的权限（仅 tool:*:use，由 CRUD 层校验）；
    # 有效权限 = 角色权限 ∪ 直接权限（并集）
    direct_permissions = relationship(
        "Permission",
        secondary=user_permissions,
        lazy="selectin",
    )

    @property
    def current_session_id(self) -> str | None:
        """当前请求所用会话的 jti（供前端判断 session.revoked 是否命中本设备）。

        由 get_current_user 在解析 token 时注入 `_current_session_id`；
        ORM 直出（如管理员列表）时为空。
        """
        return getattr(self, "_current_session_id", None)

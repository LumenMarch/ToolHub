from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class UserBase(BaseModel):
    username: str


class UserCreate(UserBase):
    password: str


class UserCreateByAdmin(UserBase):
    """管理员创建用户的请求体。"""

    password: str
    role_ids: list[int] = []


class UserUpdate(BaseModel):
    """管理员修改用户的请求体，全部字段可选。"""

    role_ids: list[int] | None = None
    is_active: bool | None = None
    password: str | None = None


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_active: bool
    # 审批状态：pending / approved / rejected
    status: str = "pending"
    # 当前登录会话的 jti；仅含当前上下文的响应（登录、/users/me）有值，
    # 供前端判断 session.revoked 事件是否命中本设备
    current_session_id: str | None = None
    # 在线状态：存在未吊销且最近 SESSION_ONLINE_WINDOW_MINUTES 分钟内有
    # 活跃记录的会话（参考 GitHub 活跃指示器）
    online: bool = False
    created_at: datetime
    last_login_at: datetime | None
    roles: list[str] = []
    permissions: list[str] = []

    @field_validator("roles", mode="before")
    @classmethod
    def _roles_to_names(cls, v: object) -> list[str]:
        """将 Role ORM 对象列表转为角色名字符串列表。"""
        if v is None:
            return []
        return [getattr(r, "name", str(r)) for r in v]  # type: ignore[arg-type]

    @field_validator("permissions", mode="before")
    @classmethod
    def _permissions_default(cls, v: object) -> list[str]:
        """permissions 不在 ORM 模型上时使用空列表。"""
        if v is None:
            return []
        if isinstance(v, list):
            return v  # type: ignore[return-value]
        return []


class Token(BaseModel):
    access_token: str
    token_type: str

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

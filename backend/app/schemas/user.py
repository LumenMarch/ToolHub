from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserBase(BaseModel):
    username: str


class UserCreate(UserBase):
    password: str


class UserCreateByAdmin(UserBase):
    """管理员创建用户的请求体。"""

    password: str
    is_admin: bool = False


class UserUpdate(BaseModel):
    """管理员修改用户的请求体，全部字段可选。"""

    is_admin: bool | None = None
    is_active: bool | None = None
    password: str | None = None


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    is_admin: bool
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class Token(BaseModel):
    access_token: str
    token_type: str

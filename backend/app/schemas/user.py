from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

# bcrypt 输入上限 72 字节；最小长度防弱口令（与前端表单校验一致）
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 72


def _validate_password_utf8_bytes(value: str) -> str:
    """bcrypt 按 UTF-8 字节截断到 72 字节；超限拒绝而非静默截断成弱哈希。"""
    if len(value.encode("utf-8")) > PASSWORD_MAX_LENGTH:
        raise ValueError(
            f"密码 UTF-8 编码后不得超过 {PASSWORD_MAX_LENGTH} 字节（bcrypt 上限）"
        )
    return value


# min 按字符数（用户感知长度），max 同时受字符数与 UTF-8 字节数约束
PasswordField = Annotated[
    str,
    Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH),
    AfterValidator(_validate_password_utf8_bytes),
]


class UserBase(BaseModel):
    username: str


class UserCreate(UserBase):
    password: PasswordField


class UserCreateByAdmin(UserBase):
    """管理员创建用户的请求体。"""

    password: PasswordField
    role_ids: list[int] = []
    # 创建时一并设置的用户直接工具权限 ID（覆盖式，仅 tool:*:use）；
    # None = 不设置直接权限
    tool_permission_ids: list[int] | None = None


class UserUpdate(BaseModel):
    """管理员修改用户的请求体，全部字段可选。"""

    role_ids: list[int] | None = None
    is_active: bool | None = None
    password: PasswordField | None = None
    # 用户直接持有的工具权限 ID（覆盖式）；None = 不修改，
    # [] = 清空全部直接工具权限。仅接受 tool:*:use 权限。
    tool_permission_ids: list[int] | None = None


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
    # 用户直接持有的工具权限 codename（不含角色授予的），按 codename 排序；
    # 前端据此初始化"自定义工具权限"勾选区
    direct_tool_permissions: list[str] = []

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

    @field_validator("direct_tool_permissions", mode="before")
    @classmethod
    def _direct_tool_permissions_default(cls, v: object) -> list[str]:
        """ORM 传 Permission 对象列表时转为 codename；缺失时为空列表。"""
        if v is None:
            return []
        if isinstance(v, list):
            return [
                getattr(p, "codename", str(p))
                for p in v  # type: ignore[arg-type]
            ]
        return []


class Token(BaseModel):
    access_token: str
    token_type: str

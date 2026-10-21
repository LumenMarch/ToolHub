from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    field_validator,
    model_validator,
)

# bcrypt 输入上限 72 字节；最小长度防弱口令（与前端表单校验一致：admin 用户对话框同样用 6 位）
PASSWORD_MIN_LENGTH = 6
PASSWORD_MAX_LENGTH = 72


def _validate_password_length(value: str) -> str:
    """长度校验用中文提示，替代 Pydantic 的英文原句（前端直接展示该 msg）。

    上限按 UTF-8 字节数（bcrypt 截断点），下限按字符数（用户感知长度）。
    """
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"密码长度至少 {PASSWORD_MIN_LENGTH} 位")
    if len(value.encode("utf-8")) > PASSWORD_MAX_LENGTH:
        raise ValueError(
            f"密码 UTF-8 编码后不得超过 {PASSWORD_MAX_LENGTH} 字节（bcrypt 上限）"
        )
    return value


# 不用 Field(min_length/max_length)：Pydantic 内置约束的 msg 是英文且无法本地化，
# 前端会把 "String should have at least 6 characters" 原样展示给用户。
# 下限按字符数、上限按 UTF-8 字节数（bcrypt 截断点），两条提示均为中文。
PasswordField = Annotated[str, AfterValidator(_validate_password_length)]


class UserBase(BaseModel):
    username: str


class _UserCredentialsBase(UserBase):
    """自助注册与管理员创建的共同校验：账号与密码不得相同。

    用 model_validator(mode="before") 而非端点内检查：密码字段的
    长度约束会先于端点执行，短口令（如 bob/bob）会先被长度校验拦下，
    端点里的判断永远看不到它。放在模型层可让"账号密码不能一样"
    优先于长度错误返回，用户看到的是业务语义提示而不是长度报错。
    """

    @model_validator(mode="before")
    @classmethod
    def _reject_identical_password(cls, data: object) -> object:
        if isinstance(data, dict):
            username = data.get("username")
            password = data.get("password")
            if isinstance(username, str) and username == password:
                raise ValueError("账号密码不能一样")
        return data


class UserCreate(_UserCredentialsBase):
    password: PasswordField


class UserCreateByAdmin(_UserCredentialsBase):
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

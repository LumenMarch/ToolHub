"""用户会话响应模型。"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserSessionResponse(BaseModel):
    """会话信息（管理端与 /users/me/sessions 共用）。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    jti: str
    ip: str | None
    user_agent: str | None
    created_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None

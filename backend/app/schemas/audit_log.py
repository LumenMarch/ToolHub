from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    username: str | None
    action: str
    target_type: str | None
    target_id: str | None
    detail: str | None
    ip_address: str | None
    created_at: datetime

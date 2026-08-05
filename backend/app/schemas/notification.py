"""通知中心响应模型。"""

import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    title: str
    # 库中为 JSON 字符串，返回时解析为对象
    payload: dict = {}
    read_at: datetime | None
    created_at: datetime

    @field_validator("payload", mode="before")
    @classmethod
    def _parse_payload(cls, v: object) -> dict:
        """将 payload 的 JSON 字符串解析为对象；非法/空值回落空 dict。"""
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return v or {}

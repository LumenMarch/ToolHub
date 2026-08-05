"""通知中心模型 — 站内通知（WebSocket 事件仅通知，REST 拉取详情）。

WebSocket 事件只负责提醒客户端"有新通知/状态变更"，
通知详情统一走 GET /notifications 读取；本表是通知的持久化真相源。
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.base_class import Base


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 事件类型（与 WS 事件 type 对齐：user.status.updated / user.pending / job.terminal）
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    # JSON 字符串；API 返回时解析为对象
    payload = Column(Text, nullable=False, default="{}")
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

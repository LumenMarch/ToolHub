"""用户登录会话模型 — 会话级吊销（方案 A）。

每个登录（/token 与 /session）生成一条记录，jti 写入 JWT 的 sid 声明；
get_current_user 校验会话存在且未吊销，实现单会话下线。
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String

from app.db.base_class import Base


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 登录时生成的随机标识，同时是 JWT payload 的 sid 声明
    jti = Column(String, unique=True, nullable=False, index=True)
    ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    # 最近活跃时间（get_current_user 节流更新，60 秒一次）
    last_seen_at = Column(DateTime, nullable=True)
    # 非空 = 已下线（单会话吊销或全局吊销都会置位）
    revoked_at = Column(DateTime, nullable=True)

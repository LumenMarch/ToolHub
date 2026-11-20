from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.base_class import Base


class AtlasMergeJob(Base):
    """Atlas Merge 后台任务状态（REST 为进度真相源）。"""

    __tablename__ = "atlas_merge_jobs"

    id = Column(String(32), primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    upload_id = Column(String(64), nullable=False)
    export_format = Column(String(32), nullable=False, default="insight")
    status = Column(String(16), nullable=False, index=True)
    done = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False, default=0)
    result_json = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    # 提交请求的 TCP 对端地址；Worker 进程没有 Request 对象，审计时复用此列。
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    # 终态后保留到该时间；活跃任务为 NULL，不参与清理。
    expires_at = Column(DateTime, nullable=True, index=True)

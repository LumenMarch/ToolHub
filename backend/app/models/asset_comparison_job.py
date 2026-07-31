from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.base_class import Base


class AssetComparisonJob(Base):
    __tablename__ = "asset_comparison_jobs"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "client_request_id",
            name="uq_asset_comparison_job_request",
        ),
    )

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    client_request_id = Column(String(64), nullable=False)
    status = Column(String(32), nullable=False, index=True)
    input_json = Column(Text, nullable=False)
    results_json = Column(Text, nullable=False, default="[]")
    artifacts_json = Column(Text, nullable=False, default="{}")
    remarks_json = Column(Text, nullable=False, default="{}")
    reviews_json = Column(Text, nullable=False, default="{}")
    progress_json = Column(Text, nullable=False, default="{}")
    error_message = Column(Text, nullable=True)
    annotation_revision = Column(Integer, nullable=False, default=0)
    finalized_revision = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False, index=True)

    artifact_records = relationship(
        "AssetComparisonArtifact",
        back_populates="job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

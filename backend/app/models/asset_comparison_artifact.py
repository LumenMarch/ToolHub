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


class AssetComparisonArtifact(Base):
    __tablename__ = "asset_comparison_artifacts"
    __table_args__ = (
        UniqueConstraint(
            "job_id",
            "artifact_key",
            name="uq_asset_comparison_artifact_key",
        ),
    )

    id = Column(Integer, primary_key=True)
    job_id = Column(
        String(36),
        ForeignKey("asset_comparison_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    artifact_key = Column(String(64), nullable=False)
    module_key = Column(String(16), nullable=True)
    status = Column(String(32), nullable=False)
    relative_path = Column(Text, nullable=True)
    filename = Column(Text, nullable=True)
    content_type = Column(String(128), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    checksum = Column(String(64), nullable=True)
    annotation_revision = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    job = relationship("AssetComparisonJob", back_populates="artifact_records")

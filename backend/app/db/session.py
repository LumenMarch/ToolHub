from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def ensure_schema_compat() -> None:
    """为既有 SQLite 库补齐 create_all 不会添加的新列。

    项目未使用 Alembic；create_all 只建表不改列。
    启动时幂等检查并 ALTER，保证旧库可平滑升级。
    """
    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(users)")).fetchall()
        column_names = {row[1] for row in rows}
        if "token_version" not in column_names:
            conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN token_version "
                    "INTEGER NOT NULL DEFAULT 0"
                )
            )

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
        # 审批状态列：存量用户视为已审批（旧系统注册即通过）；
        # is_active=False 只表示"被停用"，与审批状态无关，同样回填 approved。
        # ALTER 后列为 NULL（SQLite 不支持带 CHECK 的 ADD COLUMN），
        # 由应用层保证新写入值合法；此 UPDATE 幂等且只命中迁移产生的 NULL。
        if "status" not in column_names:
            conn.execute(text("ALTER TABLE users ADD COLUMN status VARCHAR"))
            conn.execute(
                text("UPDATE users SET status = 'approved' WHERE status IS NULL")
            )

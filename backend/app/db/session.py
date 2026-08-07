from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

engine = create_engine(
    settings.SQLALCHEMY_DATABASE_URI, connect_args={"check_same_thread": False}
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:
    """针对 SQLite 数据库连接设置必要的 PRAGMA 参数。

    1. journal_mode=WAL: 启用 Write-Ahead Logging 预写式日志模式，提高高并发读写性能，
       解决默认 delete 模式（全库锁）导致后台任务与 WebSocket 推送并发时的卡顿与冲突。
    2. busy_timeout=5000: 设置锁超时等待时间为 5000 毫秒 (5 秒)，
       避免并发读写发生轻微锁竞争时立即报错 "database is locked"。
    3. foreign_keys=ON: SQLite 默认不开启外键约束，导致 ORM/数据库层的级联删除 (CASCADE)
       （例如删除角色/用户时清理 role_permissions、user_roles 等关联中间表）无法生效；
       在此每连接显式开启外键支持，保证级联删除与外键完整性约束正确执行。
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA busy_timeout=5000;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()


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

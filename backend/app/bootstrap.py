"""数据库初始化与存量数据迁移入口。

Alembic 负责 schema；本模块只负责幂等的种子数据与语义迁移。
多副本部署时必须在 API/Worker 启动前单独执行一次，不能放进每个进程的
startup，否则并发进程会重复写入同一批种子行。
"""

from loguru import logger

from app.seed import (
    migrate_admin_permissions,
    migrate_per_tool_permissions,
    migrate_retired_roles,
    migrate_retired_tools,
    run_seed,
)


def main() -> None:
    run_seed()
    migrate_per_tool_permissions()
    migrate_admin_permissions()
    migrate_retired_roles()
    migrate_retired_tools()
    logger.info("bootstrap completed")


if __name__ == "__main__":
    main()

"""数据库初始化 — 首次启动时写入默认权限和角色。

仅在 permissions 表为空时执行（幂等）。
"""

from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.permission import Permission
from app.models.role import Role

PERMISSIONS = [
    ("user:read", "查看用户列表与详情"),
    ("user:write", "创建/修改/删除用户，分配角色"),
    ("audit:read", "查看审计日志"),
    ("tool_meta:read", "查看工具元数据"),
    ("tool_meta:write", "修改工具元数据（启用/禁用/排序）"),
    ("stats:read", "查看统计面板"),
    ("tool:use", "使用工具"),
    ("role:read", "查看角色与权限定义"),
    ("role:write", "创建/编辑/删除角色，分配权限"),
]

# 角色名 → 权限 codename 列表
ROLES = {
    "超级管理员": [
        "user:read",
        "user:write",
        "audit:read",
        "tool_meta:read",
        "tool_meta:write",
        "stats:read",
        "tool:use",
        "role:read",
        "role:write",
    ],
    "用户管理员": ["user:read", "user:write", "role:read"],
    "审计员": ["audit:read"],
    "工具管理员": ["tool_meta:read", "tool_meta:write"],
    "统计查看者": ["stats:read"],
    "工具使用者": ["tool:use"],
}


def _seed_all(db: Session) -> None:
    """写入权限和角色（同一事务，失败时整体回滚）。"""
    # 写入权限
    perm_map: dict[str, Permission] = {}
    for codename, description in PERMISSIONS:
        perm = Permission(codename=codename, description=description)
        db.add(perm)
        perm_map[codename] = perm

    # 写入角色并挂权限
    for name, perm_names in ROLES.items():
        role = Role(name=name)
        role.permissions = [perm_map[p] for p in perm_names]
        db.add(role)

    db.commit()


def run_seed() -> None:
    """如果权限表为空则写入初始数据。同一事务保证权限和角色同时写入或同时回滚。"""
    db = SessionLocal()
    try:
        if db.scalars(select(Permission)).first() is not None:
            return
        _seed_all(db)
    finally:
        db.close()


def ensure_initial_admin() -> str | None:
    """用户表为空时引导创建初始管理员；返回错误信息或 None。

    - 用户表非空：不做任何事（存量库已有用户），返回 None；
    - 用户表为空且 INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD
      均配置：创建 approved 用户并分配"超级管理员"+"工具使用者"角色；
    - 仅配置其中一项：视为配置错误，返回错误信息；
    - 均未配置：返回错误信息（系统将无法审批新注册用户），
      由 main.py 记录 ERROR 日志并使健康检查返回 503。

    与 run_seed 职责互补：run_seed 负责权限/角色种子数据，
    本函数负责引导首个管理员账号。
    """
    from sqlalchemy.exc import IntegrityError

    from app.core.config import settings
    from app.core.security import get_password_hash
    from app.crud.crud_role import get_role_by_name
    from app.crud.crud_user import count_users
    from app.models.user import USER_STATUS_APPROVED, User

    db = SessionLocal()
    try:
        if count_users(db) > 0:
            return None

        username = (settings.INITIAL_ADMIN_USERNAME or "").strip()
        password = settings.INITIAL_ADMIN_PASSWORD or ""
        if username and not password:
            return (
                "配置错误：INITIAL_ADMIN_USERNAME 已设置但 INITIAL_ADMIN_PASSWORD 为空"
            )
        if not username and password:
            return (
                "配置错误：INITIAL_ADMIN_PASSWORD 已设置但 INITIAL_ADMIN_USERNAME 为空"
            )
        if not username:
            return (
                "未配置初始管理员：INITIAL_ADMIN_USERNAME / "
                "INITIAL_ADMIN_PASSWORD 未设置，系统将无法审批新注册用户"
            )

        super_admin = get_role_by_name(db, "超级管理员")
        tool_user = get_role_by_name(db, "工具使用者")
        if super_admin is None or tool_user is None:
            return (
                "配置错误：权限种子数据缺失（超级管理员/工具使用者角色），"
                "请确认 run_seed 已执行"
            )

        admin = User(
            username=username,
            hashed_password=get_password_hash(password),
            is_active=True,
            status=USER_STATUS_APPROVED,
            roles=[super_admin, tool_user],
        )
        db.add(admin)
        try:
            db.commit()
        except IntegrityError:
            # 多 worker 并发启动竞态：两个实例同时看到空表并插入同名用户，
            # 后提交者命中唯一约束。按软失败契约返回错误信息，不中断启动。
            db.rollback()
            return (
                "配置错误：初始管理员创建失败（并发启动竞态或用户名冲突），"
                "请重试启动或更换 INITIAL_ADMIN_USERNAME"
            )
        logger.warning(
            "初始管理员引导完成：username={} status=approved "
            "roles=[超级管理员, 工具使用者]",
            username,
        )
        return None
    finally:
        db.close()

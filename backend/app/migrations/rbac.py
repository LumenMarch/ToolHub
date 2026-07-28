"""RBAC 数据迁移 — 从 is_admin 二元模型迁移到 Role-Based Access Control。

在应用启动时执行，通过检查 permissions 表是否已有数据来判断是否已迁移。
"""

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.crud.crud_role import get_role_by_name
from app.db.session import SessionLocal
from app.models.permission import Permission
from app.models.role import Role

# 9 个权限定义
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

# 6 个默认角色 — 角色名 → 权限 codename 列表
ROLES = {
    "超级管理员": [
        "user:read", "user:write",
        "audit:read",
        "tool_meta:read", "tool_meta:write",
        "stats:read",
        "tool:use",
        "role:read", "role:write",
    ],
    "用户管理员": ["user:read", "user:write"],
    "审计员": ["audit:read"],
    "工具管理员": ["tool_meta:read", "tool_meta:write"],
    "统计查看者": ["stats:read"],
    "工具使用者": ["tool:use"],
}


def _seed_permissions(db: Session) -> dict[str, Permission]:
    """写入 9 条权限，返回 codename → Permission 映射。"""
    mapping: dict[str, Permission] = {}
    for codename, description in PERMISSIONS:
        perm = Permission(codename=codename, description=description)
        db.add(perm)
        mapping[codename] = perm
    db.commit()
    return mapping


def _seed_roles(db: Session, perm_map: dict[str, Permission]) -> dict[str, Role]:
    """写入 6 个默认角色并挂上对应权限，返回 name → Role 映射。"""
    mapping: dict[str, Role] = {}
    for name, perm_names in ROLES.items():
        role = Role(name=name, description="")
        role.permissions = [perm_map[p] for p in perm_names]
        db.add(role)
        mapping[name] = role
    db.commit()
    return mapping


def _migrate_existing_users(db: Session, roles: dict[str, Role]) -> None:
    """将现有 is_admin=True 的用户挂上超级管理员角色，
    普通用户挂上工具使用者角色。通过原始 SQL 读取旧 is_admin 列。"""
    super_admin = roles["超级管理员"]
    tool_user = roles["工具使用者"]

    # 检查 is_admin 列是否仍存在于 SQLite 中
    result = db.execute(text("PRAGMA table_info(users)"))
    columns = {row[1] for row in result.fetchall()}
    if "is_admin" not in columns:
        return

    rows = db.execute(text("SELECT id, is_admin FROM users")).fetchall()
    for user_id, is_admin in rows:
        if is_admin:
            db.execute(
                text("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (:uid, :rid)"),
                {"uid": user_id, "rid": super_admin.id},
            )
            db.execute(
                text("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (:uid, :rid)"),
                {"uid": user_id, "rid": tool_user.id},
            )
        else:
            db.execute(
                text("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (:uid, :rid)"),
                {"uid": user_id, "rid": tool_user.id},
            )
    db.commit()


def run_rbac_migration() -> None:
    """执行 RBAC 迁移（幂等 — 已有数据时跳过 seed + migrate）。"""
    db = SessionLocal()
    try:
        existing = db.query(Permission).first()
        if existing is not None:
            # 已迁移过，跳过
            return

        perm_map = _seed_permissions(db)
        roles = _seed_roles(db, perm_map)
        _migrate_existing_users(db, roles)
    finally:
        db.close()

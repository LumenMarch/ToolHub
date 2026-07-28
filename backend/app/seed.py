"""数据库初始化 — 首次启动时写入默认权限和角色。

仅在 permissions 表为空时执行（幂等）。
"""

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
        if db.query(Permission).first() is not None:
            return
        _seed_all(db)
    finally:
        db.close()

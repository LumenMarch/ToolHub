"""数据库初始化 — 首次启动时写入默认权限和角色。

仅在 permissions 表为空时执行（幂等）。
"""

from loguru import logger
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.models.permission import Permission
from app.models.role import Role
from app.models.user import User

# 每个工具一条 tool:<id>:use（id 与前端 tools.ts 的 toolsConfig 完全一致）：
# 细粒度授权后，工具使用权限不再由粗粒度的 tool:use 控制。
# 该列表同时供存量库迁移脚本（migrate_per_tool_permissions）复用。
TOOL_PERMISSIONS = [
    ("tool:qrcode:use", "使用二维码生成工具"),
    ("tool:asset-comparison:use", "使用资产核对工具"),
    ("tool:attendance-organizer:use", "使用出勤资料整理工具"),
    ("tool:atlas-merge:use", "使用AtlasLog Merge工具"),
    ("tool:cpk-charts:use", "使用OPP工具"),
    ("tool:calendar:use", "使用日历工具"),
    ("tool:image-to-pdf:use", "使用图片转PDF工具"),
    ("tool:box-plot:use", "使用箱线图工具"),
    ("tool:tt-time:use", "使用TT时间计算工具"),
    ("tool:retest-rate:use", "使用重测率统计工具"),
]

TOOL_PERMISSION_CODENAMES = [codename for codename, _ in TOOL_PERMISSIONS]


# 已下线工具的存量 tool:<id>:use。仅列明确下线的 id，避免误删手工加的权限。
RETIRED_TOOL_PERMISSIONS = (
    "tool:color-picker:use",
    "tool:pwd-generator:use",
    "tool:string-analyzer:use",
    "tool:health:use",
    "tool:sixty-seconds:use",
)

PERMISSIONS = [
    ("user:read", "查看用户列表与详情"),
    ("user:write", "创建/修改/删除用户，分配角色"),
    ("audit:read", "查看审计日志"),
    ("tool_meta:read", "查看工具元数据"),
    ("tool_meta:write", "修改工具元数据（启用/禁用/排序）"),
    ("stats:read", "查看统计面板"),
    ("role:read", "查看角色与权限定义"),
    ("role:write", "创建/编辑/删除角色，分配权限"),
    *TOOL_PERMISSIONS,
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
        "role:read",
        "role:write",
        *TOOL_PERMISSION_CODENAMES,
    ],
    "用户管理员": ["user:read", "user:write", "role:read"],
    "审计员": ["audit:read"],
    "工具管理员": ["tool_meta:read", "tool_meta:write"],
    "统计查看者": ["stats:read"],
    "工具使用者": TOOL_PERMISSION_CODENAMES,
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


def migrate_per_tool_permissions() -> None:
    """存量库数据迁移：粗粒度 tool:use → tool:<id>:use，并让工具全量角色跟进新工具。

    run_seed 仅在 permissions 表为空时播种，存量库（permissions 非空）不会自动
    获得新 codename，因此启动时额外执行本函数：
    1. 补齐缺失的 tool:<id>:use 权限（含"表内无任何工具权限"的边角情况）；
    2. 把**任何**持有 tool:use 的角色替换为全部工具权限——语义等价：
       以前能用所有工具，迁移后也能用所有工具（覆盖自定义角色）；
    3. 删除 permissions 表中无角色引用的残留 tool:use 记录；
    4. 工具目录新增后，内置工具角色（ROLES 声明全量工具权限的角色：
       超级管理员/工具使用者）自动补齐缺失的工具权限（幂等）；
       自定义角色不受影响，需管理员手动分配。
    重复执行无副作用（所有步骤均为 no-op）。
    """
    db = SessionLocal()
    try:
        perms = db.scalars(select(Permission)).all()
        perm_map = {p.codename: p for p in perms}

        # 1) 补齐缺失的工具权限 codename
        for codename, description in TOOL_PERMISSIONS:
            if codename not in perm_map:
                perm = Permission(codename=codename, description=description)
                db.add(perm)
                perm_map[codename] = perm

        # 2) 替换所有持有 tool:use 的角色（含自定义角色，语义等价）
        roles = db.scalars(select(Role)).all()
        replaced = False
        for role in roles:
            codenames = [p.codename for p in role.permissions]
            if "tool:use" not in codenames:
                continue
            role.permissions = [perm_map[c] for c in codenames if c != "tool:use"] + [
                perm_map[c] for c in TOOL_PERMISSION_CODENAMES
            ]
            replaced = True

        # 3) 清理无角色引用的残留 tool:use 记录
        old = perm_map.get("tool:use")
        if old is not None:
            referencing = any(
                any(p.codename == "tool:use" for p in role.permissions)
                for role in roles
            )
            if not referencing:
                db.delete(old)

        # 4) 内置工具角色跟进：声明全量工具权限的角色（超级管理员/工具使用者）
        #    自动补齐工具目录新增的权限（幂等）；自定义角色不受影响
        caught_up = False
        for role_name, role_codenames in ROLES.items():
            if not set(TOOL_PERMISSION_CODENAMES) <= set(role_codenames):
                continue
            role = next((r for r in roles if r.name == role_name), None)
            if role is None:
                continue
            codenames = {p.codename for p in role.permissions}
            missing = [c for c in TOOL_PERMISSION_CODENAMES if c not in codenames]
            if missing:
                role.permissions = list(role.permissions) + [
                    perm_map[c] for c in missing
                ]
                caught_up = True

        db.commit()
        if replaced or old is not None or caught_up:
            logger.info(
                "per-tool permission migration applied: tool:use → {} 条 tool:<id>:use"
                "（内置工具角色补齐 {} 条）",
                len(TOOL_PERMISSIONS),
                len(TOOL_PERMISSION_CODENAMES),
            )
    finally:
        db.close()


def migrate_retired_tool_permissions() -> None:
    """清理已下线工具的存量 tool:*:use 权限（幂等）。

    run_seed / migrate_per_tool_permissions 只补齐、不删除。工具下线后，
    存量库会残留对应权限行及其角色/用户直接授权。启动时按
    RETIRED_TOOL_PERMISSIONS 白名单逐条摘掉关联并删除权限行；
    表中无匹配行时为 no-op。同一事务提交，失败整体回滚。
    """
    db = SessionLocal()
    try:
        retired = db.scalars(
            select(Permission).where(Permission.codename.in_(RETIRED_TOOL_PERMISSIONS))
        ).all()
        if not retired:
            return

        retired_ids = {perm.id for perm in retired}
        retired_codenames = [
            codename
            for codename in RETIRED_TOOL_PERMISSIONS
            if any(perm.codename == codename for perm in retired)
        ]

        roles = db.scalars(select(Role).options(selectinload(Role.permissions))).all()
        for role in roles:
            kept = [perm for perm in role.permissions if perm.id not in retired_ids]
            if len(kept) != len(role.permissions):
                role.permissions = kept

        users = db.scalars(
            select(User).options(selectinload(User.direct_permissions))
        ).all()
        for user in users:
            kept = [
                perm for perm in user.direct_permissions if perm.id not in retired_ids
            ]
            if len(kept) != len(user.direct_permissions):
                user.direct_permissions = kept

        for perm in retired:
            db.delete(perm)

        db.commit()
        logger.info("已清理下线工具权限: {}", "、".join(retired_codenames))
    except Exception:
        db.rollback()
        raise
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

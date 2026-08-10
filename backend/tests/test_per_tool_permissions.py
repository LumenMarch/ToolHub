"""per-tool 权限（tool:<id>:use）守卫与存量库迁移测试。

覆盖：
- require_tool_permission：无权限 403（文案区分"无权限"）；有权限但工具被
  管理员禁用 403（文案区分"已禁用"）；
- 自定义角色只持有一项工具权限：该工具可用、其它工具 403（细粒度授权生效）；
- require_any_tool_permission：持有任一工具权限放行（GET /tools-meta 200），
  零工具权限 403；
- 迁移脚本 migrate_per_tool_permissions：对模拟存量库（旧 seed 建库）幂等、
  自定义角色同样获得全部工具权限、tool:use 记录被清理；
- 公开端点（OPTIONS /upload/tus、GET /tools/sixty-seconds/hitokoto）不受影响。
"""

from sqlalchemy import delete, select

from app.models.permission import Permission
from app.models.role import Role
from app.models.tool_meta import ToolMeta
from app.seed import (
    PERMISSIONS,
    TOOL_PERMISSION_CODENAMES,
    migrate_per_tool_permissions,
)
from tests.conftest import auth_header, login, register

QRCODE_URL = "/api/v1/tools/qrcode"
STRING_URL = "/api/v1/tools/string/process"
TOOLS_META_URL = "/api/v1/tools-meta"


def _approve(client, admin_token: str, user_id: int, role_ids=None) -> None:
    """审批用户（默认分配"工具使用者"角色，即全部工具权限）。"""
    payload = {"role_ids": role_ids} if role_ids is not None else None
    resp = client.post(
        f"/api/v1/admin/users/{user_id}/approve",
        json=payload,
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text


# ---------- require_tool_permission ----------


def test_tool_endpoint_forbidden_without_permission(client):
    """零工具权限（未审批用户）：工具端点 403，文案为"无权限"。"""
    register(client, "alice")
    token = login(client, "alice").json()["access_token"]
    resp = client.post(
        QRCODE_URL,
        json={"text": "hello"},
        headers=auth_header(token),
    )
    assert resp.status_code == 403
    assert "需要 tool:qrcode:use 权限" in resp.json()["detail"]


def test_tool_endpoint_forbidden_when_disabled(admin_client, db):
    """有权限但工具被管理员禁用：工具端点 403，文案为"已禁用"。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    _approve(client, admin_token, alice_id)
    token = login(client, "alice").json()["access_token"]

    # 启用状态下调用成功
    ok = client.post(QRCODE_URL, json={"text": "hello"}, headers=auth_header(token))
    assert ok.status_code == 200, ok.text

    # 禁用 qrcode 工具后调用被拒
    meta = db.scalars(select(ToolMeta).where(ToolMeta.tool_id == "qrcode")).first()
    if meta is None:
        meta = ToolMeta(tool_id="qrcode", enabled=True, sort_order=0)
        db.add(meta)
    meta.enabled = False
    db.commit()

    resp = client.post(QRCODE_URL, json={"text": "hello"}, headers=auth_header(token))
    assert resp.status_code == 403
    assert "工具 qrcode 已被禁用" in resp.json()["detail"]


def test_per_tool_granularity_custom_role(admin_client, db):
    """自定义角色只持有一项工具权限：该工具可用，其它工具 403。"""
    client, _ = admin_client
    qrcode_perm = db.scalars(
        select(Permission).where(Permission.codename == "tool:qrcode:use")
    ).one()
    role = Role(name="二维码专用")
    role.permissions = [qrcode_perm]
    db.add(role)

    # 直接在库中创建用户并赋予自定义角色（approve 的提权校验要求管理员
    # 自身持有被授予的角色，此处聚焦权限守卫本身，故绕过审批流程）
    from app.core.security import get_password_hash
    from app.models.user import USER_STATUS_APPROVED, User

    alice = User(
        username="alice",
        hashed_password=get_password_hash("pw-123456"),
        is_active=True,
        status=USER_STATUS_APPROVED,
        roles=[role],
    )
    db.add(alice)
    db.commit()
    token = login(client, "alice").json()["access_token"]

    ok = client.post(QRCODE_URL, json={"text": "hi"}, headers=auth_header(token))
    assert ok.status_code == 200, ok.text

    denied = client.post(
        STRING_URL,
        json={"text": "abc", "action": "hash_md5"},
        headers=auth_header(token),
    )
    assert denied.status_code == 403
    assert "需要 tool:string-analyzer:use 权限" in denied.json()["detail"]


# ---------- require_any_tool_permission ----------


def test_tools_meta_forbidden_without_any_tool_permission(client):
    """零工具权限：GET /tools-meta 403。"""
    register(client, "alice")
    token = login(client, "alice").json()["access_token"]
    resp = client.get(TOOLS_META_URL, headers=auth_header(token))
    assert resp.status_code == 403
    assert "需要任一工具使用权限" in resp.json()["detail"]


def test_tools_meta_allows_any_tool_permission(admin_client):
    """持有任一工具权限（工具使用者）：GET /tools-meta 200。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    _approve(client, admin_token, alice_id)
    token = login(client, "alice").json()["access_token"]
    resp = client.get(TOOLS_META_URL, headers=auth_header(token))
    assert resp.status_code == 200


# ---------- 存量库迁移 ----------


def test_migration_noop_on_fresh_seed(db):
    """新部署（run_seed 已播种新权限）：迁移为 no-op，重复执行无副作用。"""
    codenames_before = set(db.scalars(select(Permission.codename)).all())
    assert "tool:use" not in codenames_before
    assert set(TOOL_PERMISSION_CODENAMES) <= codenames_before

    migrate_per_tool_permissions()
    assert set(db.scalars(select(Permission.codename)).all()) == codenames_before

    migrate_per_tool_permissions()
    assert set(db.scalars(select(Permission.codename)).all()) == codenames_before


def test_migration_upgrades_legacy_db_and_is_idempotent(db):
    """模拟存量库（旧 seed：8 管理权限 + tool:use）迁移。

    - 11 条新 codename 补齐、tool:use 记录被清理；
    - 持有 tool:use 的角色（含自定义角色）全部获得 11 条工具权限，
      同时保留原有非工具权限；
    - 重复执行无副作用。
    """
    # 重建旧版数据：清空后按旧 seed 写入
    db.execute(delete(Role))
    db.execute(delete(Permission))
    admin_perms = [p for p in PERMISSIONS if not p[0].startswith("tool:")]
    old_perms = admin_perms + [("tool:use", "使用工具")]
    perm_map = {}
    for codename, description in old_perms:
        perm = Permission(codename=codename, description=description)
        db.add(perm)
        perm_map[codename] = perm
    db.flush()

    super_admin = Role(name="超级管理员")
    super_admin.permissions = [
        perm_map[c]
        for c in [
            "user:read",
            "user:write",
            "audit:read",
            "tool_meta:read",
            "tool_meta:write",
            "stats:read",
            "tool:use",
            "role:read",
            "role:write",
        ]
    ]
    tool_user = Role(name="工具使用者")
    tool_user.permissions = [perm_map["tool:use"]]
    custom = Role(name="财务专用")
    custom.permissions = [perm_map["audit:read"], perm_map["tool:use"]]
    db.add_all([super_admin, tool_user, custom])
    db.commit()

    # 执行迁移
    migrate_per_tool_permissions()

    # 迁移后：11 条新 codename 全部存在，tool:use 已删除
    db.expire_all()
    codenames = set(db.scalars(select(Permission.codename)).all())
    assert "tool:use" not in codenames
    assert set(TOOL_PERMISSION_CODENAMES) <= codenames

    # 所有角色（含自定义）均持有全部 11 条工具权限
    for role in db.scalars(select(Role)).all():
        role_codenames = {p.codename for p in role.permissions}
        assert set(TOOL_PERMISSION_CODENAMES) <= role_codenames, role.name

    # 自定义角色保留原有非工具权限
    custom_role = db.scalars(select(Role).where(Role.name == "财务专用")).one()
    custom_codenames = {p.codename for p in custom_role.permissions}
    assert "audit:read" in custom_codenames

    # 幂等：再次执行无副作用（权限集与角色权限均不变）
    migrate_per_tool_permissions()
    db.expire_all()
    assert set(db.scalars(select(Permission.codename)).all()) == codenames
    for role in db.scalars(select(Role)).all():
        assert set(TOOL_PERMISSION_CODENAMES) <= {
            p.codename for p in role.permissions
        }, role.name


def test_migration_inserts_tool_permissions_when_none_exist(db):
    """表内无任何 tool: 前缀权限且无 tool:use：迁移直接插入 11 条新 codename。"""
    db.execute(delete(Role))
    db.execute(delete(Permission))
    db.add_all(
        [
            Permission(codename="user:read", description="查看用户列表与详情"),
            Permission(codename="audit:read", description="查看审计日志"),
        ]
    )
    db.commit()

    migrate_per_tool_permissions()

    codenames = set(db.scalars(select(Permission.codename)).all())
    assert "tool:use" not in codenames
    assert set(TOOL_PERMISSION_CODENAMES) <= codenames

    # 幂等
    migrate_per_tool_permissions()
    assert set(db.scalars(select(Permission.codename)).all()) == codenames


# ---------- 公开端点回归 ----------


def test_public_endpoints_stay_public(client):
    """OPTIONS /upload/tus（CORS 预检）与 GET /tools/sixty-seconds/hitokoto 保持公开。"""
    resp = client.options("/api/v1/upload/tus")
    assert resp.status_code == 204
    resp = client.get("/api/v1/tools/sixty-seconds/hitokoto")
    assert resp.status_code == 200

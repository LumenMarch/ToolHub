"""用户直接绑定工具权限（tool:*:use）测试。

覆盖：
- 并集语义：直接权限与角色权限合并生效（自定义工具 + 管理角色并存，
  工具端点与管理端点同时可用）；
- set_user_direct_permissions 拒绝非 tool:*:use 权限（400），
  且校验在任何写入之前完成（无部分提交）；
- PATCH tool_permission_ids 三种语义：设置 / 清空 / None（不修改）；
- /users/me 与管理员列表返回 direct_tool_permissions；
- 直接权限变更推送 permissions.updated，不递增 token_version（旧 token 仍有效）；
- approve 支持 tool_permission_ids（同事务写入 + 补推权限刷新）。
"""

from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.permission import Permission
from app.models.role import Role, user_roles
from app.models.user import User, user_permissions
from app.models.user_session import UserSession
from app.services.realtime.hub import realtime_hub
from tests.conftest import auth_header, login, register

QRCODE_URL = "/api/v1/tools/qrcode"
CALENDAR_URL = "/api/v1/tools/calendar/info"


def _perm_id(db, codename: str) -> int:
    return (
        db.scalars(select(Permission).where(Permission.codename == codename)).one().id
    )


def _approve(client, admin_token: str, user_id: int, role_ids=None) -> None:
    """审批用户（默认分配"工具使用者"角色，即全部工具权限）。"""
    payload = {"role_ids": role_ids} if role_ids is not None else None
    resp = client.post(
        f"/api/v1/admin/users/{user_id}/approve",
        json=payload,
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text


# ---------- 并集合并 ----------


def test_direct_permissions_merge_with_role_permissions(admin_client, db):
    """并集：直接工具权限 + 管理角色权限同时生效，互不影响。"""
    client, root_token = admin_client
    user_admin_role = db.scalars(select(Role).where(Role.name == "用户管理员")).one()
    tool_role = db.scalars(select(Role).where(Role.name == "工具使用者")).one()

    # 受限管理员：用户管理员 + 工具使用者（root 创建，无超级管理员角色）
    created = client.post(
        "/api/v1/admin/users",
        json={
            "username": "user-admin",
            "password": "ua-123456",
            "role_ids": [user_admin_role.id, tool_role.id],
        },
        headers=auth_header(root_token),
    )
    assert created.status_code == 201, created.text
    ua_token = login(client, "user-admin", "ua-123456").json()["access_token"]

    # alice 由受限管理员审批为"用户管理员"：角色只有管理权限，无工具权限
    alice_id = register(client, "alice").json()["id"]
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"role_ids": [user_admin_role.id]},
        headers=auth_header(ua_token),
    )
    assert resp.status_code == 200, resp.text

    # 受限管理员给 alice 设置直接工具权限（qrcode）
    qrcode_id = _perm_id(db, "tool:qrcode:use")
    patch = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": [qrcode_id]},
        headers=auth_header(ua_token),
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["direct_tool_permissions"] == ["tool:qrcode:use"]

    token = login(client, "alice").json()["access_token"]
    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    body = me.json()
    # 并集：角色（用户管理员：user:read / user:write / role:read）+ 直接（qrcode）
    assert set(body["permissions"]) == {
        "user:read",
        "user:write",
        "role:read",
        "tool:qrcode:use",
    }
    assert body["direct_tool_permissions"] == ["tool:qrcode:use"]

    # 工具端点：直接权限放行
    ok = client.post(QRCODE_URL, json={"text": "hello"}, headers=auth_header(token))
    assert ok.status_code == 200, ok.text
    # 未授予的其它工具仍 403
    denied = client.post(
        CALENDAR_URL,
        json={"date": "2026-08-08"},
        headers=auth_header(token),
    )
    assert denied.status_code == 403
    assert "需要 tool:calendar:use 权限" in denied.json()["detail"]
    # 管理端点：角色权限放行
    audit = client.get("/api/v1/admin/users", headers=auth_header(token))
    assert audit.status_code == 200


# ---------- 拒绝非工具权限 ----------


def test_patch_rejects_non_tool_permission_400(admin_client, db):
    """直接权限仅接受 tool:*:use：传管理权限 400，且无部分提交。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    _approve(client, admin_token, alice_id)

    user_write_id = _perm_id(db, "user:write")
    # 同时携带 is_active，验证校验先于任何写入（无部分提交）
    resp = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": [user_write_id], "is_active": False},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 400
    assert "不是工具使用权限" in resp.json()["detail"]

    alice = db.query(User).filter(User.username == "alice").one()
    assert alice.is_active is True
    assert alice.direct_permissions == []

    # 不存在的权限 ID 同样 400
    resp2 = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": [99999]},
        headers=auth_header(admin_token),
    )
    assert resp2.status_code == 400
    assert "不存在" in resp2.json()["detail"]


# ---------- PATCH 三种语义 ----------


def test_patch_tool_permission_ids_set_clear_none(admin_client, db):
    """PATCH tool_permission_ids 三种语义：设置 / 清空 / None（不修改）。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    _approve(client, admin_token, alice_id)
    headers = auth_header(admin_token)

    qrcode_id = _perm_id(db, "tool:qrcode:use")
    calendar_id = _perm_id(db, "tool:calendar:use")

    # 设置：覆盖为指定集合（响应按 codename 排序）
    resp = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": [qrcode_id, calendar_id]},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["direct_tool_permissions"] == [
        "tool:calendar:use",
        "tool:qrcode:use",
    ]

    # None（省略字段）：不修改直接权限
    resp = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"is_active": True},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["direct_tool_permissions"] == [
        "tool:calendar:use",
        "tool:qrcode:use",
    ]

    # 清空：[] → 直接权限为空
    resp = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": []},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["direct_tool_permissions"] == []

    # /users/me 同步反映
    token = login(client, "alice").json()["access_token"]
    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    assert me.json()["direct_tool_permissions"] == []

    # 管理员列表同样带 direct_tool_permissions
    listing = client.get("/api/v1/admin/users", headers=headers).json()
    alice_item = next(u for u in listing["items"] if u["username"] == "alice")
    assert "direct_tool_permissions" in alice_item
    assert alice_item["direct_tool_permissions"] == []


# ---------- 自保护 ----------


def test_patch_self_tool_permission_ids_rejected(admin_client, db):
    """自保护：管理员不能修改自己的直接工具权限（防止绕过前端约束自行授权）。"""
    client, admin_token = admin_client
    root_id = db.query(User).filter(User.username == "root").one().id
    qrcode_id = _perm_id(db, "tool:qrcode:use")

    resp = client.patch(
        f"/api/v1/admin/users/{root_id}",
        json={"tool_permission_ids": [qrcode_id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 400
    assert "Cannot change your own tool permissions" in resp.json()["detail"]

    # 回归：修改他人直接权限不受影响
    alice_id = register(client, "alice").json()["id"]
    _approve(client, admin_token, alice_id)
    ok = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": [qrcode_id]},
        headers=auth_header(admin_token),
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["direct_tool_permissions"] == ["tool:qrcode:use"]


# ---------- 推送不递增 token_version ----------


def test_direct_permissions_change_pushes_event_without_bumping_token_version(
    admin_client, db, monkeypatch
):
    """直接权限变更：推 permissions.updated，不递增 token_version（旧 token 仍有效）。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    _approve(client, admin_token, alice_id)
    alice_token = login(client, "alice").json()["access_token"]
    assert (
        client.get("/api/v1/users/me", headers=auth_header(alice_token)).status_code
        == 200
    )

    qrcode_id = _perm_id(db, "tool:qrcode:use")
    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    resp = client.patch(
        f"/api/v1/admin/users/{alice_id}",
        json={"tool_permission_ids": [qrcode_id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text

    events = [e for e in recorded if e["type"] == "permissions.updated"]
    assert len(events) == 1
    assert events[0]["user_id"] == alice_id
    assert not any(e["type"] == "session.revoked" for e in recorded)

    # 旧 token 未失效：直接权限已并入权限集
    me = client.get("/api/v1/users/me", headers=auth_header(alice_token))
    assert me.status_code == 200
    assert "tool:qrcode:use" in me.json()["direct_tool_permissions"]
    assert "tool:qrcode:use" in me.json()["permissions"]


# ---------- approve 带直接权限 ----------


def test_approve_with_tool_permission_ids(admin_client, db, monkeypatch):
    """approve 接受 tool_permission_ids：同事务写入并补推权限刷新。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    qrcode_id = _perm_id(db, "tool:qrcode:use")

    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"tool_permission_ids": [qrcode_id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["direct_tool_permissions"] == ["tool:qrcode:use"]
    # 默认"工具使用者"角色（全部工具）+ 直接权限并集
    assert {"tool:qrcode:use", "tool:calendar:use"} <= set(body["permissions"])
    assert "user:read" not in body["permissions"]

    # 补推权限刷新；既有状态事件不受影响
    events = [e for e in recorded if e["type"] == "permissions.updated"]
    assert len(events) == 1
    assert events[0]["user_id"] == alice_id
    status_events = [e for e in recorded if e["type"] == "user.status.updated"]
    assert len(status_events) == 1
    assert status_events[0]["status"] == "approved"


def test_approve_empty_role_ids_with_direct_permissions(admin_client, db):
    """role_ids=[] + tool_permission_ids：不分配任何角色，仅授予直接工具权限
    （区别于省略 role_ids 时默认"工具使用者"角色）。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    qrcode_id = _perm_id(db, "tool:qrcode:use")

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"role_ids": [], "tool_permission_ids": [qrcode_id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["roles"] == []
    assert body["direct_tool_permissions"] == ["tool:qrcode:use"]
    # 无默认角色兜底：权限仅来自直接授权
    assert body["permissions"] == ["tool:qrcode:use"]


def test_approve_rejects_non_tool_permission_id(admin_client, db):
    """approve 校验先于提交：非工具权限 400，用户保持 pending、无部分写入。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    user_write_id = _perm_id(db, "user:write")

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"tool_permission_ids": [user_write_id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 400
    assert "不是工具使用权限" in resp.json()["detail"]

    alice = db.query(User).filter(User.username == "alice").one()
    assert alice.status == "pending"
    assert alice.roles == []
    assert alice.direct_permissions == []


# ---------- 管理员创建用户带直接权限 ----------


def test_create_user_with_tool_permission_ids(admin_client, db):
    """管理员创建用户带 tool_permission_ids：直接权限落库，/users/me 与列表响应可见。"""
    client, admin_token = admin_client
    qrcode_id = _perm_id(db, "tool:qrcode:use")

    resp = client.post(
        "/api/v1/admin/users",
        json={
            "username": "bob",
            "password": "bob-123456",
            "tool_permission_ids": [qrcode_id],
        },
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["direct_tool_permissions"] == ["tool:qrcode:use"]

    token = login(client, "bob", "bob-123456").json()["access_token"]
    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    body = me.json()
    assert body["direct_tool_permissions"] == ["tool:qrcode:use"]
    assert "tool:qrcode:use" in body["permissions"]

    # 管理员列表响应同样带 direct_tool_permissions
    listing = client.get("/api/v1/admin/users", headers=auth_header(admin_token)).json()
    bob_item = next(u for u in listing["items"] if u["username"] == "bob")
    assert bob_item["direct_tool_permissions"] == ["tool:qrcode:use"]


def test_create_user_rejects_non_tool_permission_id(admin_client, db):
    """创建校验先于提交：非工具权限 400，用户未创建（无部分写入）。"""
    client, admin_token = admin_client
    user_write_id = _perm_id(db, "user:write")

    resp = client.post(
        "/api/v1/admin/users",
        json={
            "username": "bob",
            "password": "bob-123456",
            "tool_permission_ids": [user_write_id],
        },
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 400
    assert "不是工具使用权限" in resp.json()["detail"]

    # 未部分提交：用户不存在
    assert db.query(User).filter(User.username == "bob").first() is None


# ---------- 删除用户与关联数据清理 ----------


def test_delete_user_with_direct_permissions_cleans_up(admin_client, db):
    """删除持有直接工具权限且登录过的用户：204，user_permissions / 会话无残留，
    审计日志按设计保留（user_id 置空、冗余 username 仍可读）。
    （回归：audit_logs 外键未声明 CASCADE，曾导致 DELETE 500。）"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    qrcode_id = _perm_id(db, "tool:qrcode:use")

    # 审批授予直接权限，并让 alice 登录（产生 user.login 审计 + 会话行）
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"role_ids": [], "tool_permission_ids": [qrcode_id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert login(client, "alice").status_code == 200

    resp = client.delete(
        f"/api/v1/admin/users/{alice_id}", headers=auth_header(admin_token)
    )
    assert resp.status_code == 204, resp.text

    # 用户与直接权限关联行均已清理
    assert db.query(User).filter(User.id == alice_id).first() is None
    assert (
        db.execute(
            select(user_permissions.c.permission_id).where(
                user_permissions.c.user_id == alice_id
            )
        ).all()
        == []
    )
    # 登录会话随用户删除（user_sessions 级联）
    assert (
        db.execute(select(UserSession).where(UserSession.user_id == alice_id)).all()
        == []
    )
    # 审计日志保留：user_id 置空，冗余 username 仍指向原用户
    logs = (
        db.execute(select(AuditLog).where(AuditLog.username == "alice")).scalars().all()
    )
    assert len(logs) == 1
    assert logs[0].action == "user.login"
    assert logs[0].user_id is None


def test_delete_user_with_roles_regression(admin_client, db):
    """删除有角色的用户：回归不受影响——204，user_roles 无残留。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    tool_role = db.scalars(select(Role).where(Role.name == "工具使用者")).one()

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"role_ids": [tool_role.id]},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text

    resp = client.delete(
        f"/api/v1/admin/users/{alice_id}", headers=auth_header(admin_token)
    )
    assert resp.status_code == 204, resp.text

    assert db.query(User).filter(User.id == alice_id).first() is None
    assert (
        db.execute(
            select(user_roles.c.role_id).where(user_roles.c.user_id == alice_id)
        ).all()
        == []
    )

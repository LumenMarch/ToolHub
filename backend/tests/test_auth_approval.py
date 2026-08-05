"""用户注册审批流程测试。

覆盖：注册状态/角色、初始管理员引导与健康检查、审批/驳回/恢复、
列表筛选与 total、TTL 清理（先吊销再删除）、限流、域名白名单、
登录语义与实时事件推送。
"""

import json
from datetime import datetime, timedelta

from app.core.config import settings
from app.crud.crud_role import get_role_by_name
from app.main import cleanup_expired_unapproved_users
from app.models.user import User
from app.services.realtime.hub import realtime_hub
from tests.conftest import auth_header, login, register

# ---------- 注册 ----------


def test_register_creates_pending_user_without_roles(client, db):
    resp = register(client, "alice")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["roles"] == []
    assert body["permissions"] == []
    assert body["is_active"] is True

    # 首个用户不再自动成为超级管理员
    user = db.query(User).filter(User.username == "alice").one()
    assert user.status == "pending"
    assert user.roles == []
    assert db.query(User).count() == 1


def test_register_duplicate_username(client):
    register(client, "alice")
    resp = register(client, "alice")
    assert resp.status_code == 400


def test_pending_user_can_login_and_read_me(client):
    register(client, "alice")
    resp = login(client, "alice")
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]

    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    assert me.json()["status"] == "pending"
    assert me.json()["roles"] == []
    # 锁死 pending 零权限契约
    assert me.json()["permissions"] == []


def test_register_broadcasts_user_pending_event(client, monkeypatch):
    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    register(client, "alice")
    types = [event["type"] for event in recorded]
    assert "user.pending" in types
    pending = next(e for e in recorded if e["type"] == "user.pending")
    assert pending["user_id"] == 1


# ---------- 初始管理员 bootstrap 与健康检查 ----------


def test_healthz_fails_without_initial_admin(client):
    resp = client.get("/healthz")
    assert resp.status_code == 503
    assert "INITIAL_ADMIN_USERNAME" in resp.json()["reason"]


def test_initial_admin_bootstrap_and_healthz_ok(admin_client):
    client, token = admin_client
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    body = me.json()
    assert body["username"] == "root"
    assert body["status"] == "approved"
    assert "超级管理员" in body["roles"]
    assert "工具使用者" in body["roles"]


def test_initial_admin_partial_config_returns_error(monkeypatch):
    # 只配置用户名不配置密码 → ensure_initial_admin 返回配置错误信息。
    # 直接调用引导函数而非新建第二个 TestClient，避免破坏共享 app 生命周期；
    # 健康检查 503 契约已由 test_healthz_fails_without_initial_admin 覆盖。
    from app.seed import ensure_initial_admin

    monkeypatch.setattr(settings, "INITIAL_ADMIN_USERNAME", "root")
    err = ensure_initial_admin()
    assert err is not None
    assert "INITIAL_ADMIN_PASSWORD" in err


def test_ensure_initial_admin_idempotent(db):
    """连续调用两次 ensure_initial_admin 不抛异常、不重复创建。"""
    from app.seed import ensure_initial_admin

    settings.INITIAL_ADMIN_USERNAME = "root"
    settings.INITIAL_ADMIN_PASSWORD = "root-pass-123"
    assert ensure_initial_admin() is None
    # 第二次调用：用户表已非空，直接跳过
    assert ensure_initial_admin() is None
    assert db.query(User).filter(User.username == "root").count() == 1


# ---------- 审批 / 驳回 / 恢复 ----------


def test_approve_assigns_default_tool_role(admin_client, db):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["roles"] == ["工具使用者"]

    # 审批后登录成功，权限含 tool:use
    login_resp = login(client, "alice")
    assert login_resp.status_code == 200
    me = client.get(
        "/api/v1/users/me",
        headers=auth_header(login_resp.json()["access_token"]),
    )
    assert me.json()["status"] == "approved"
    assert "tool:use" in me.json()["permissions"]

    # 审计日志
    logs = client.get(
        "/api/v1/admin/audit?action=user.approve",
        headers=auth_header(token),
    ).json()
    assert logs["total"] == 1
    assert logs["items"][0]["target_id"] == str(alice_id)


def test_approve_with_explicit_role_ids(admin_client, db):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    super_admin = get_role_by_name(db, "超级管理员")

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"role_ids": [super_admin.id]},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["roles"] == ["超级管理员"]
    assert resp.json()["status"] == "approved"


def test_approve_requires_user_write_permission(client):
    # 无管理员：普通用户调审批接口应 403
    alice_id = register(client, "alice").json()["id"]
    login_resp = login(client, "alice")
    token = login_resp.json()["access_token"]
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(token),
    )
    assert resp.status_code == 403


def test_approve_cannot_grant_role_above_admin(admin_client, db):
    """提权防护：低阶管理员不能授予自己未持有的角色。"""
    client, token = admin_client
    # 受限管理员：用户管理员 + 工具使用者（不含超级管理员）
    user_admin_role = get_role_by_name(db, "用户管理员")
    tool_role = get_role_by_name(db, "工具使用者")
    resp = client.post(
        "/api/v1/admin/users",
        json={
            "username": "user-admin",
            "password": "ua-123456",
            "role_ids": [user_admin_role.id, tool_role.id],
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    ua_token = login(client, "user-admin", "ua-123456").json()["access_token"]

    pending_id = register(client, "alice").json()["id"]
    super_role = get_role_by_name(db, "超级管理员")

    # 授予高于自身权限的角色 → 400
    r = client.post(
        f"/api/v1/admin/users/{pending_id}/approve",
        json={"role_ids": [super_role.id]},
        headers=auth_header(ua_token),
    )
    assert r.status_code == 400
    assert "高于自身权限" in r.json()["detail"]

    # 授予自身持有的角色 → 200（用户仍为 pending，可继续审批）
    r2 = client.post(
        f"/api/v1/admin/users/{pending_id}/approve",
        json={"role_ids": [tool_role.id]},
        headers=auth_header(ua_token),
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["roles"] == ["工具使用者"]


def test_approve_invalid_role_id_400(admin_client):
    """approve 带不存在的 role_id 应 400，而非静默丢弃后 200。"""
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        json={"role_ids": [99999]},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "不存在" in resp.json()["detail"]


def test_approve_nonexistent_user_404(admin_client):
    client, token = admin_client
    resp = client.post(
        "/api/v1/admin/users/999/approve",
        headers=auth_header(token),
    )
    assert resp.status_code == 404


def test_approve_non_pending_user_rejected(admin_client):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    client.post(f"/api/v1/admin/users/{alice_id}/approve", headers=auth_header(token))
    # 再次审批已 approved 用户应 400
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(token),
    )
    assert resp.status_code == 400


def test_reject_and_login_error_message(admin_client):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/reject",
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"

    # 被驳回用户登录返回 401 与区分文案
    login_resp = login(client, "alice")
    assert login_resp.status_code == 401
    assert "申请已被拒绝" in login_resp.json()["detail"]
    assert "7 天后释放" in login_resp.json()["detail"]

    # 审计日志
    logs = client.get(
        "/api/v1/admin/audit?action=user.reject",
        headers=auth_header(token),
    ).json()
    assert logs["total"] == 1


def test_reject_revokes_existing_sessions(admin_client):
    """reject 必须吊销用户既有会话：旧 token 立即失效。"""
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    old_token = login(client, "alice").json()["access_token"]
    # 驳回前 token 可用
    assert (
        client.get("/api/v1/users/me", headers=auth_header(old_token)).status_code
        == 200
    )

    client.post(f"/api/v1/admin/users/{alice_id}/reject", headers=auth_header(token))
    # 驳回后旧 token 因 token_version 递增而失效
    resp = client.get("/api/v1/users/me", headers=auth_header(old_token))
    assert resp.status_code == 401


def test_rejected_user_token_denied_by_status(client, db):
    """get_current_user 对 rejected 状态直接拦截（纵深防御）。"""
    alice_id = register(client, "alice").json()["id"]
    token = login(client, "alice").json()["access_token"]
    # 模拟会话未吊销但状态被驳回（直接改库，隔离验证状态检查本身）
    user = db.query(User).filter(User.id == alice_id).one()
    user.status = "rejected"
    db.commit()
    resp = client.get("/api/v1/users/me", headers=auth_header(token))
    assert resp.status_code == 401


def test_reject_with_reason_in_audit(admin_client):
    """reject 的 reason 写入审计 detail，不展示给用户。"""
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/reject",
        json={"reason": "公司邮箱域名不符"},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    logs = client.get(
        "/api/v1/admin/audit?action=user.reject",
        headers=auth_header(token),
    ).json()
    assert logs["total"] == 1
    detail = json.loads(logs["items"][0]["detail"])
    assert detail["username"] == "alice"
    assert detail["reason"] == "公司邮箱域名不符"


def test_reject_only_pending(admin_client):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    client.post(f"/api/v1/admin/users/{alice_id}/reject", headers=auth_header(token))
    # 再次驳回 rejected 用户应 400
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/reject",
        headers=auth_header(token),
    )
    assert resp.status_code == 400


def test_reapprove_rejected_user_via_approve(admin_client):
    """restore 场景：approve 兼容 rejected 用户，可直接恢复并重新登录。"""
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    client.post(f"/api/v1/admin/users/{alice_id}/reject", headers=auth_header(token))
    assert login(client, "alice").status_code == 401

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"
    assert login(client, "alice").status_code == 200


def test_approve_pushes_status_event(admin_client, monkeypatch):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    client.post(f"/api/v1/admin/users/{alice_id}/approve", headers=auth_header(token))
    events = [e for e in recorded if e["type"] == "user.status.updated"]
    assert len(events) == 1
    assert events[0]["status"] == "approved"
    assert events[0]["user_id"] == alice_id


def test_reject_pushes_status_event(admin_client, monkeypatch):
    client, token = admin_client
    alice_id = register(client, "alice").json()["id"]
    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    client.post(f"/api/v1/admin/users/{alice_id}/reject", headers=auth_header(token))
    events = [e for e in recorded if e["type"] == "user.status.updated"]
    assert len(events) == 1
    assert events[0]["status"] == "rejected"
    assert events[0]["user_id"] == alice_id


# ---------- 列表筛选与 total ----------


def test_admin_users_list_status_filter_and_total(admin_client):
    client, token = admin_client
    headers = auth_header(token)

    # 3 个待审批 + 1 个已审批（root 由 bootstrap 创建）
    alice_id = register(client, "alice").json()["id"]
    register(client, "bob")
    carol_id = register(client, "carol").json()["id"]
    client.post(f"/api/v1/admin/users/{alice_id}/approve", headers=headers)

    all_resp = client.get("/api/v1/admin/users", headers=headers)
    assert all_resp.status_code == 200
    body = all_resp.json()
    assert body["total"] == 4
    assert len(body["items"]) == 4
    assert {u["status"] for u in body["items"]} == {"pending", "approved"}

    pending_resp = client.get("/api/v1/admin/users?status=pending", headers=headers)
    assert pending_resp.json()["total"] == 2
    assert all(u["status"] == "pending" for u in pending_resp.json()["items"])

    multi_resp = client.get(
        "/api/v1/admin/users?status=pending,rejected", headers=headers
    )
    assert multi_resp.json()["total"] == 2

    rejected = client.post(f"/api/v1/admin/users/{carol_id}/reject", headers=headers)
    assert rejected.status_code == 200
    multi_resp2 = client.get(
        "/api/v1/admin/users?status=pending,rejected", headers=headers
    )
    # bob(pending) + carol(rejected)
    assert multi_resp2.json()["total"] == 2

    # approved 筛选
    approved_resp = client.get("/api/v1/admin/users?status=approved", headers=headers)
    assert approved_resp.json()["total"] == 2

    invalid_resp = client.get("/api/v1/admin/users?status=bogus", headers=headers)
    assert invalid_resp.status_code == 422


def test_admin_created_user_is_approved(admin_client):
    client, token = admin_client
    resp = client.post(
        "/api/v1/admin/users",
        json={"username": "ops", "password": "pw-123456", "role_ids": []},
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "approved"


# ---------- TTL 清理（先吊销再删除） ----------


def test_ttl_cleanup_revokes_and_deletes(client, db, monkeypatch):
    register(client, "old-pending")
    register(client, "old-rejected")
    register(client, "fresh-pending")

    # 手动把前两个用户的创建时间改到 TTL 之前
    old = datetime.utcnow() - timedelta(days=settings.REGISTRATION_PENDING_TTL_DAYS + 1)
    for username in ("old-pending", "old-rejected"):
        user = db.query(User).filter(User.username == username).one()
        user.created_at = old
    # 将 old-rejected 置为 rejected
    db.query(User).filter(User.username == "old-rejected").update(
        {"status": "rejected"}
    )
    db.commit()

    revoked: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: revoked.append(event)
    )

    removed = cleanup_expired_unapproved_users()
    assert removed == 2

    # 过期用户被物理删除，先吊销会话（session.revoked 事件携带 user_id）
    remaining = {u.username for u in db.query(User).all()}
    assert remaining == {"fresh-pending"}
    revoked_ids = {
        e["user_id"]
        for e in revoked
        if e["type"] == "session.revoked" and "user_id" in e
    }
    assert len(revoked_ids) == 2


def test_ttl_cleanup_keeps_recent_pending(client, db):
    register(client, "fresh-pending")
    removed = cleanup_expired_unapproved_users()
    assert removed == 0
    assert db.query(User).filter(User.username == "fresh-pending").one() is not None


def test_ttl_cleanup_skips_approved_user(client, db):
    """已审批用户即使创建时间超过 TTL 也绝不能被清理。"""
    register(client, "old-pending")
    user = db.query(User).filter(User.username == "old-pending").one()
    user.created_at = datetime.utcnow() - timedelta(
        days=settings.REGISTRATION_PENDING_TTL_DAYS + 1
    )
    user.status = "approved"
    db.commit()

    removed = cleanup_expired_unapproved_users()
    assert removed == 0
    assert db.query(User).filter(User.username == "old-pending").count() == 1


def test_ttl_cleanup_rechecks_status_before_delete(client, db, monkeypatch):
    """TOCTOU 防护：SELECT 之后、删除之前用户被审批 → 不误删。"""
    import app.crud.crud_user as crud_user

    real_query = crud_user.get_unapproved_users_older_than

    def fake_query(db_session, cutoff):
        users = real_query(db_session, cutoff)
        # 模拟清理线程完成 SELECT 后、执行删除前管理员完成了审批
        for u in users:
            u.status = "approved"
        db_session.commit()
        return users

    monkeypatch.setattr(crud_user, "get_unapproved_users_older_than", fake_query)
    register(client, "old-pending")
    user = db.query(User).filter(User.username == "old-pending").one()
    user.created_at = datetime.utcnow() - timedelta(
        days=settings.REGISTRATION_PENDING_TTL_DAYS + 1
    )
    db.commit()

    removed = cleanup_expired_unapproved_users()
    assert removed == 0
    assert db.query(User).filter(User.username == "old-pending").count() == 1


# ---------- 限流 ----------


def test_register_rate_limited(client):
    # 上限从配置读取，避免与默认值字面量耦合
    limit = settings.REGISTRATION_RATE_LIMIT_PER_IP
    for i in range(limit):
        resp = register(client, f"user{i}")
        assert resp.status_code == 200, resp.text
    # 下一次注册（同一 IP）应被限流
    resp = register(client, "spammer")
    assert resp.status_code == 429


# ---------- 域名白名单 ----------


def test_registration_domain_whitelist(client, monkeypatch):
    monkeypatch.setattr(settings, "REGISTRATION_ALLOWED_DOMAINS", ["@corp.com"])
    resp = register(client, "alice")
    assert resp.status_code == 403
    assert "白名单" in resp.json()["detail"]

    ok = register(client, "bob@corp.com")
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "pending"

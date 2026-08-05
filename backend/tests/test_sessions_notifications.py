"""会话管理（方案 A）与通知中心测试。

覆盖：登录建会话/JWT sid、单会话与全局吊销、logout、管理端点权限与幂等、
通知落库（approve/reject/pending/job.terminal）、通知 API 流、清理函数。
"""

import json
import uuid
from datetime import datetime, timedelta

import jwt as pyjwt

from app.core.config import settings
from app.main import cleanup_expired_sessions_and_notifications
from app.models.asset_comparison_job import AssetComparisonJob
from app.models.notification import Notification
from app.models.user import User
from app.models.user_session import UserSession
from app.services.realtime.hub import realtime_hub
from app.services.realtime.sessions import revoke_user_sessions
from tests.conftest import auth_header, login, register


def _decode_sid(token: str) -> str:
    payload = pyjwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    return payload["sid"]


# ---------- 登录建会话与 sid ----------


def test_login_creates_session_and_token_has_sid(admin_client, db):
    client, admin_token = admin_client
    sid = _decode_sid(admin_token)
    root = db.query(User).filter(User.username == "root").one()
    session = db.query(UserSession).filter(UserSession.jti == sid).one()
    assert session.user_id == root.id
    assert session.revoked_at is None
    assert session.created_at is not None


def test_users_me_has_current_session_id(client):
    register(client, "alice")
    token = login(client, "alice").json()["access_token"]
    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    # current_session_id 与 token 的 sid 一致，供前端判断 session.revoked 命中
    assert me.json()["current_session_id"] == _decode_sid(token)

    # /users/me/sessions：当前用户自己的会话（含本次登录）
    sessions = client.get("/api/v1/users/me/sessions", headers=auth_header(token))
    assert sessions.status_code == 200
    body = sessions.json()
    assert len(body) == 1
    assert body[0]["jti"] == _decode_sid(token)
    assert set(body[0]) == {
        "id",
        "jti",
        "ip",
        "user_agent",
        "created_at",
        "last_seen_at",
        "revoked_at",
    }


# ---------- 会话吊销 ----------


def test_revoke_single_session_keeps_other_sessions(admin_client, db):
    client, admin_token = admin_client
    root_id = db.query(User).filter(User.username == "root").one().id

    token_a = login(client, "root", "root-pass-123").json()["access_token"]
    token_b = login(client, "root", "root-pass-123").json()["access_token"]
    assert (
        client.get("/api/v1/users/me", headers=auth_header(token_a)).status_code == 200
    )

    sessions = client.get(
        f"/api/v1/admin/users/{root_id}/sessions",
        headers=auth_header(admin_token),
    ).json()
    session_a = next(s for s in sessions if s["jti"] == _decode_sid(token_a))

    resp = client.post(
        f"/api/v1/admin/users/{root_id}/sessions/{session_a['id']}/revoke",
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["revoked_at"] is not None
    assert resp.json()["jti"] == session_a["jti"]

    # 被吊销会话的 token 401，同用户另一会话的 token 仍可用
    assert (
        client.get("/api/v1/users/me", headers=auth_header(token_a)).status_code == 401
    )
    assert (
        client.get("/api/v1/users/me", headers=auth_header(token_b)).status_code == 200
    )


def test_revoke_user_sessions_marks_all_revoked(client, db):
    register(client, "alice")
    token_a = login(client, "alice").json()["access_token"]
    token_b = login(client, "alice").json()["access_token"]
    alice = db.query(User).filter(User.username == "alice").one()

    revoke_user_sessions(db, alice)

    sessions = db.query(UserSession).filter(UserSession.user_id == alice.id).all()
    assert len(sessions) == 2
    assert all(s.revoked_at is not None for s in sessions)
    # 全局吊销后 token 因 tv/sid 双重失效
    assert (
        client.get("/api/v1/users/me", headers=auth_header(token_a)).status_code == 401
    )
    assert (
        client.get("/api/v1/users/me", headers=auth_header(token_b)).status_code == 401
    )


def test_logout_revokes_session(client, db):
    register(client, "alice")
    token = login(client, "alice").json()["access_token"]
    resp = client.post("/api/v1/auth/logout", headers=auth_header(token))
    assert resp.status_code == 204
    alice = db.query(User).filter(User.username == "alice").one()
    session = db.query(UserSession).filter(UserSession.user_id == alice.id).one()
    assert session.revoked_at is not None
    # 注销后 token 失效
    assert client.get("/api/v1/users/me", headers=auth_header(token)).status_code == 401


def test_session_revoked_event_carries_sid(admin_client, monkeypatch):
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    alice_token = login(client, "alice").json()["access_token"]
    alice_sid = _decode_sid(alice_token)
    sessions = client.get(
        f"/api/v1/admin/users/{alice_id}/sessions",
        headers=auth_header(admin_token),
    ).json()
    session_id = next(s["id"] for s in sessions if s["jti"] == alice_sid)

    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/sessions/{session_id}/revoke",
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200
    events = [e for e in recorded if e["type"] == "session.revoked"]
    assert len(events) == 1
    # 单会话吊销：事件必须带 sid 键（前端据此判断是否命中本设备）
    assert "sid" in events[0]
    assert events[0]["sid"] == alice_sid
    assert events[0]["user_id"] == alice_id


def test_global_revoke_event_omits_sid(client, db, monkeypatch):
    """全局吊销的事件载荷省略 sid 键，避免前端误判为"其它设备被踢"。"""
    register(client, "alice")
    login(client, "alice")
    alice = db.query(User).filter(User.username == "alice").one()

    recorded: list[dict] = []
    monkeypatch.setattr(
        realtime_hub, "publish", lambda event, **kwargs: recorded.append(event)
    )
    revoke_user_sessions(db, alice)

    events = [e for e in recorded if e["type"] == "session.revoked"]
    assert len(events) == 1
    assert "sid" not in events[0]
    assert events[0]["user_id"] == alice.id


# ---------- 会话管理端点权限 / 404 / 幂等 ----------


def test_admin_sessions_endpoints_permissions_404_idempotent(admin_client, db):
    client, admin_token = admin_client
    root_id = db.query(User).filter(User.username == "root").one().id

    # 普通用户无 user:read / user:write
    register(client, "bob")
    bob_token = login(client, "bob").json()["access_token"]
    assert (
        client.get(
            f"/api/v1/admin/users/{root_id}/sessions",
            headers=auth_header(bob_token),
        ).status_code
        == 403
    )
    assert (
        client.post(
            f"/api/v1/admin/users/{root_id}/sessions/1/revoke",
            headers=auth_header(bob_token),
        ).status_code
        == 403
    )

    # 用户 / 会话不存在
    assert (
        client.get(
            "/api/v1/admin/users/999/sessions",
            headers=auth_header(admin_token),
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/admin/users/{root_id}/sessions/99999/revoke",
            headers=auth_header(admin_token),
        ).status_code
        == 404
    )

    # 跨用户会话：carol 的会话挂在 root 名下 → 404
    register(client, "carol")
    carol_sid = _decode_sid(login(client, "carol").json()["access_token"])
    carol_session = db.query(UserSession).filter(UserSession.jti == carol_sid).one()
    assert (
        client.post(
            f"/api/v1/admin/users/{root_id}/sessions/{carol_session.id}/revoke",
            headers=auth_header(admin_token),
        ).status_code
        == 404
    )

    # 重复吊销幂等：两次均 200（目标用额外登录的会话，避免吊销 admin_token 自身）
    login(client, "root", "root-pass-123")
    root_sessions = client.get(
        f"/api/v1/admin/users/{root_id}/sessions",
        headers=auth_header(admin_token),
    ).json()
    admin_sid = _decode_sid(admin_token)
    target = next(s["id"] for s in root_sessions if s["jti"] != admin_sid)
    first = client.post(
        f"/api/v1/admin/users/{root_id}/sessions/{target}/revoke",
        headers=auth_header(admin_token),
    )
    second = client.post(
        f"/api/v1/admin/users/{root_id}/sessions/{target}/revoke",
        headers=auth_header(admin_token),
    )
    assert first.status_code == 200
    assert second.status_code == 200

    # 审计日志
    logs = client.get(
        "/api/v1/admin/audit?action=user.session_revoke",
        headers=auth_header(admin_token),
    ).json()
    assert logs["total"] >= 1


# ---------- 通知落库 ----------


def test_approve_reject_create_notifications(admin_client, db):
    client, admin_token = admin_client

    alice_id = register(client, "alice").json()["id"]
    client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(admin_token),
    )
    approved = db.query(Notification).filter(Notification.user_id == alice_id).one()
    assert approved.type == "user.status.updated"
    assert approved.title == "注册申请已通过"
    assert json.loads(approved.payload) == {"status": "approved"}

    bob_id = register(client, "bob").json()["id"]
    client.post(
        f"/api/v1/admin/users/{bob_id}/reject",
        json={"reason": "域名不符"},
        headers=auth_header(admin_token),
    )
    rejected = db.query(Notification).filter(Notification.user_id == bob_id).one()
    assert rejected.title == "注册申请被拒绝"
    payload = json.loads(rejected.payload)
    assert payload["status"] == "rejected"
    assert payload["reason"] == "域名不符"


def test_register_pending_notifies_only_user_write(admin_client, db):
    client, admin_token = admin_client
    root_id = db.query(User).filter(User.username == "root").one().id
    # 建一个无角色的 approved 用户（无 user:write）
    client.post(
        "/api/v1/admin/users",
        json={"username": "plain", "password": "pw-123456", "role_ids": []},
        headers=auth_header(admin_token),
    )
    plain_id = db.query(User).filter(User.username == "plain").one().id

    alice_id = register(client, "alice").json()["id"]

    root_notifs = (
        db.query(Notification)
        .filter(Notification.user_id == root_id, Notification.type == "user.pending")
        .all()
    )
    assert len(root_notifs) == 1
    assert json.loads(root_notifs[0].payload) == {
        "user_id": alice_id,
        "username": "alice",
    }
    assert db.query(Notification).filter(Notification.user_id == plain_id).count() == 0


def test_approve_survives_notification_write_failure(admin_client, monkeypatch):
    """通知写库失败不影响审批结果（状态已生效，重试会被 400 挡住，必须容错）。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]

    def boom(db, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr("app.api.endpoints.admin_users.create_notification", boom)
    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "approved"
    assert resp.json()["roles"] == ["工具使用者"]


def test_register_survives_notification_fanout_failure(admin_client, monkeypatch, db):
    """注册的待审批通知 fan-out 失败不破坏注册（用户已创建，不能 500）。"""
    client, admin_token = admin_client
    root_id = db.query(User).filter(User.username == "root").one().id

    def boom(db, entries):
        raise RuntimeError("disk full")

    monkeypatch.setattr("app.api.endpoints.auth.create_notifications", boom)
    resp = register(client, "alice")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "pending"
    # 用户已创建，但无任何通知残留
    assert db.query(User).filter(User.username == "alice").count() == 1
    assert db.query(Notification).filter(Notification.user_id == root_id).count() == 0


def test_job_terminal_creates_notification(client, db):
    from app.api.endpoints.asset_comparison import asset_comparison_job_manager

    register(client, "alice")
    alice = db.query(User).filter(User.username == "alice").one()
    # input_json 真实结构：{"version": 1, "fingerprint": ..., "files": {key: {"filename": ...}}}
    job = AssetComparisonJob(
        id=str(uuid.uuid4()),
        user_id=alice.id,
        client_request_id="req-1",
        status="running",
        input_json=json.dumps(
            {
                "version": 1,
                "fingerprint": "abc",
                "files": {
                    "上架明细": {
                        "filename": "上架明细.xlsx",
                        "relativePath": "input/上架明细.xlsx",
                        "sizeBytes": 1024,
                        "sha256": "x",
                    }
                },
            }
        ),
        results_json="[]",
        artifacts_json="{}",
        remarks_json="{}",
        reviews_json="{}",
        progress_json="{}",
        expires_at=datetime.utcnow() + timedelta(hours=1),
    )
    db.add(job)
    db.commit()

    asset_comparison_job_manager._notify_job(
        job_id=job.id, user_id=alice.id, status="complete"
    )

    notification = db.query(Notification).filter(Notification.user_id == alice.id).one()
    assert notification.type == "job.terminal"
    # 标题取 files 首项文件名，而非顶层 version 整数（回归：旧实现得到 "1 · ..."）
    assert notification.title == "上架明细.xlsx · 资产核对任务已完成"
    payload = json.loads(notification.payload)
    assert payload["job_id"] == job.id
    assert payload["status"] == "complete"
    assert payload["job_name"] == "上架明细.xlsx"


def test_job_terminal_title_falls_back_without_files(client, db):
    """input_json 无 files（或取不到文件名）时退回纯文案标题。"""
    from app.api.endpoints.asset_comparison import asset_comparison_job_manager

    register(client, "bob")
    bob = db.query(User).filter(User.username == "bob").one()
    job = AssetComparisonJob(
        id=str(uuid.uuid4()),
        user_id=bob.id,
        client_request_id="req-2",
        status="running",
        input_json=json.dumps({"version": 1, "fingerprint": "abc"}),
        results_json="[]",
        artifacts_json="{}",
        remarks_json="{}",
        reviews_json="{}",
        progress_json="{}",
        expires_at=datetime.utcnow() + timedelta(hours=1),
    )
    db.add(job)
    db.commit()

    asset_comparison_job_manager._notify_job(
        job_id=job.id, user_id=bob.id, status="failed"
    )

    notification = db.query(Notification).filter(Notification.user_id == bob.id).one()
    assert notification.title == "资产核对任务执行失败"
    assert "job_name" not in json.loads(notification.payload)


# ---------- 通知 API ----------


def test_notifications_api_flow(client, db):
    from app.crud.crud_notification import (
        create_notification,
        mark_notification_read,
    )

    register(client, "alice")
    token = login(client, "alice").json()["access_token"]
    headers = auth_header(token)
    alice = db.query(User).filter(User.username == "alice").one()

    create_notification(
        db, user_id=alice.id, type="test", title="通知一", payload={"k": 1}
    )
    create_notification(db, user_id=alice.id, type="test", title="通知二")
    create_notification(db, user_id=alice.id, type="test", title="通知三")
    first = db.query(Notification).filter(Notification.title == "通知一").one()
    mark_notification_read(db, first)

    # 列表:payload 解析为对象、total 正确
    listing = client.get("/api/v1/notifications", headers=headers)
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] == 3
    items = body["items"]
    assert len(items) == 3
    payloads = {item["title"]: item["payload"] for item in items}
    assert payloads["通知一"] == {"k": 1}
    assert all(
        set(item) == {"id", "type", "title", "payload", "read_at", "created_at"}
        for item in items
    )

    # 未读筛选与计数
    unread = client.get("/api/v1/notifications?unread_only=true", headers=headers)
    assert unread.json()["total"] == 2
    count = client.get("/api/v1/notifications/unread-count", headers=headers)
    assert count.json()["count"] == 2

    # 单条已读（幂等）
    nid = items[0]["id"]
    assert (
        client.post(f"/api/v1/notifications/{nid}/read", headers=headers).status_code
        == 200
    )
    assert (
        client.post(f"/api/v1/notifications/{nid}/read", headers=headers).status_code
        == 200
    )
    assert (
        client.get("/api/v1/notifications/unread-count", headers=headers).json()[
            "count"
        ]
        == 1
    )

    # 跨用户隔离：读别人的通知 → 404
    register(client, "bob")
    bob_token = login(client, "bob").json()["access_token"]
    assert (
        client.post(
            f"/api/v1/notifications/{nid}/read",
            headers=auth_header(bob_token),
        ).status_code
        == 404
    )

    # 全部已读
    assert (
        client.post("/api/v1/notifications/read-all", headers=headers).status_code
        == 200
    )
    assert (
        client.get("/api/v1/notifications/unread-count", headers=headers).json()[
            "count"
        ]
        == 0
    )


# ---------- 在线状态 ----------


def test_get_users_online_ids(client, db):
    """get_users 批量在线判定：活跃会话进 online_ids，无会话/旧会话/已吊销不进。"""
    from app.crud.crud_user import get_users

    # alice：登录有活跃会话（last_seen 为空按 created_at 算）→ 在线
    alice_id = register(client, "alice").json()["id"]
    login(client, "alice")
    # bob：注册未登录 → 无会话 → 离线
    bob_id = register(client, "bob").json()["id"]
    # carol：登录后 last_seen 改旧 → 离线
    carol_id = register(client, "carol").json()["id"]
    carol_sid = _decode_sid(login(client, "carol").json()["access_token"])
    carol_session = db.query(UserSession).filter(UserSession.jti == carol_sid).one()
    carol_session.last_seen_at = datetime.utcnow() - timedelta(minutes=30)
    # dave：登录后吊销会话 → 离线
    dave_id = register(client, "dave").json()["id"]
    dave_sid = _decode_sid(login(client, "dave").json()["access_token"])
    dave_session = db.query(UserSession).filter(UserSession.jti == dave_sid).one()
    dave_session.revoked_at = datetime.utcnow()
    db.commit()

    items, total, online_ids = get_users(db)
    assert total == 4
    assert {u.id for u in items} == {alice_id, bob_id, carol_id, dave_id}
    assert online_ids == {alice_id}


def test_admin_users_list_online_field(admin_client):
    client, admin_token = admin_client
    headers = auth_header(admin_token)
    register(client, "alice")
    register(client, "bob")
    login(client, "alice")

    body = client.get("/api/v1/admin/users", headers=headers).json()
    online_map = {u["username"]: u["online"] for u in body["items"]}
    # root 由 admin_client 登录 → 在线；alice 登录 → 在线；bob 未登录 → 离线
    assert online_map["root"] is True
    assert online_map["alice"] is True
    assert online_map["bob"] is False


def test_register_offline_login_online(client):
    """注册响应 online=False（无会话），登录响应 online=True（会话刚创建）。"""
    resp = register(client, "alice")
    assert resp.status_code == 200
    assert resp.json()["online"] is False

    session_resp = client.post(
        "/api/v1/auth/session",
        data={"username": "alice", "password": "pw-123456"},
    )
    assert session_resp.status_code == 200
    assert session_resp.json()["online"] is True

    token = login(client, "alice").json()["access_token"]
    me = client.get("/api/v1/users/me", headers=auth_header(token))
    assert me.status_code == 200
    assert me.json()["online"] is True


def test_approve_response_online_reflects_session(admin_client):
    """单用户管理响应同样计算在线状态（approve 场景）。"""
    client, admin_token = admin_client
    alice_id = register(client, "alice").json()["id"]
    login(client, "alice")  # pending 用户可登录 → 有活跃会话

    resp = client.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200
    assert resp.json()["online"] is True


# ---------- 清理 ----------


def test_cleanup_expired_sessions_and_notifications(client, db):
    register(client, "alice")
    alice = db.query(User).filter(User.username == "alice").one()

    old_revoked = UserSession(
        user_id=alice.id,
        jti="old-revoked",
        revoked_at=datetime.utcnow() - timedelta(days=8),
    )
    old_active = UserSession(
        user_id=alice.id,
        jti="old-active",
        last_seen_at=datetime.utcnow() - timedelta(days=30),
    )
    fresh = UserSession(
        user_id=alice.id,
        jti="fresh",
        last_seen_at=datetime.utcnow(),
    )
    old_read = Notification(
        user_id=alice.id,
        type="test",
        title="old-read",
        payload="{}",
        read_at=datetime.utcnow() - timedelta(days=100),
    )
    recent_read = Notification(
        user_id=alice.id,
        type="test",
        title="recent-read",
        payload="{}",
        read_at=datetime.utcnow(),
    )
    unread = Notification(
        user_id=alice.id,
        type="test",
        title="unread",
        payload="{}",
        read_at=None,
    )
    db.add_all([old_revoked, old_active, fresh, old_read, recent_read, unread])
    db.commit()

    removed = cleanup_expired_sessions_and_notifications()
    # 2 个过期会话 + 1 条过期已读通知
    assert removed == 3

    jtis = {s.jti for s in db.query(UserSession).all()}
    assert jtis == {"fresh"}
    titles = {n.title for n in db.query(Notification).all()}
    assert titles == {"recent-read", "unread"}

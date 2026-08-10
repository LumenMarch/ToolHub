"""工具端点审计日志测试：主要动作端点应产生对应 tool.<slug>.<op> 审计记录，
轮询/公开/辅助端点不产生审计噪音。"""

import json

from sqlalchemy import select

from app.api.endpoints.asset_comparison import asset_comparison_job_manager
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.attendance import attendance_result_cache
from tests.conftest import auth_header

QR_URL = "/api/v1/tools/qrcode"
ASSET_URL = "/api/v1/tools/asset"


class _NoopExecutor:
    """占位执行器：拦截后台任务提交，避免测试中启动真实比对线程。"""

    def submit(self, fn, *args, **kwargs):
        return None

    def shutdown(self, *args, **kwargs):
        return None


def _tool_logs(db, action: str) -> list[AuditLog]:
    return list(
        db.scalars(
            select(AuditLog).where(AuditLog.action == action).order_by(AuditLog.id)
        )
    )


def test_qrcode_generate_writes_audit(admin_client, db):
    """此前无审计的 qrcode 工具：生成成功后落 tool.qrcode.generate。"""
    client, token = admin_client
    resp = client.post(
        QR_URL,
        json={"text": "audit-check", "size": 256, "level": "M"},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    logs = _tool_logs(db, "tool.qrcode.generate")
    assert len(logs) == 1
    log = logs[0]
    assert log.target_type == "tool"
    assert log.target_id == "qrcode"
    assert log.username == "root"
    detail = json.loads(log.detail)
    assert detail["size"] == 256
    assert detail["level"] == "M"


def test_asset_compare_writes_audit_and_poll_is_silent(
    admin_client, db, tmp_path, monkeypatch
):
    """POST /jobs 落 tool.asset.compare；随后轮询 GET /jobs/{id} 不产生审计噪音。"""
    # 拦截后台比对线程，保持测试确定性
    monkeypatch.setattr(asset_comparison_job_manager, "_executor", _NoopExecutor())

    client, token = admin_client
    inputs = {}
    for key in (
        "thisFinance",
        "lastFinance",
        "thisSFC",
        "lastSFC",
        "thisNotes",
        "lastNotes",
        "thisCustomer",
        "lastCustomer",
        "departmentData",
        "custodianData",
        "driData",
    ):
        p = tmp_path / f"{key}.xlsx"
        p.write_bytes(b"fake")
        inputs[key] = str(p)
    inputs["clientRequestId"] = "test-client-req-0001"

    resp = client.post(f"{ASSET_URL}/jobs", json=inputs, headers=auth_header(token))
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["jobId"]

    logs = _tool_logs(db, "tool.asset.compare")
    assert len(logs) == 1
    assert logs[0].target_type == "tool"
    assert logs[0].target_id == "asset-comparison"
    detail = json.loads(logs[0].detail)
    assert detail["job_id"] == job_id
    assert detail["input_count"] == 11

    # 轮询端点不产生新审计
    poll = client.get(f"{ASSET_URL}/jobs/{job_id}", headers=auth_header(token))
    assert poll.status_code == 200
    assert len(_tool_logs(db, "tool.asset.compare")) == 1


def test_attendance_download_writes_audit(admin_client, db):
    """补齐的 attendance 下载端点：落 tool.attendance.download 并带 result_id。"""
    client, token = admin_client
    root = db.scalars(select(User).where(User.username == "root")).one()
    cached = attendance_result_cache.put(
        user_id=root.id,
        filename="出勤整理_完整.xlsx",
        content=b"fake xlsx content",
    )

    resp = client.get(
        f"/api/v1/tools/attendance/results/{cached.result_id}/download",
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    logs = _tool_logs(db, "tool.attendance.download")
    assert len(logs) == 1
    log = logs[0]
    assert log.target_type == "tool"
    assert log.target_id == "attendance"
    assert log.user_id == root.id
    detail = json.loads(log.detail)
    assert detail["result_id"] == cached.result_id

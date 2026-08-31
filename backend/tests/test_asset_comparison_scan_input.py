"""资产核对任务输入安全测试：/jobs 只接受 scan_id，拒绝路径注入与越权。

回归保护：
- 请求体不再存在任何路径字段（extra="forbid" 层拒绝）；
- 文件定位只发生在服务端受管 scan 目录内（按用户隔离）；
- /scan 响应只返回文件名，不泄露服务器绝对路径。
"""

from datetime import datetime

from dateutil.relativedelta import relativedelta

from app.api.endpoints.asset_comparison import asset_comparison_job_manager
from tests.conftest import auth_header, tus_upload

ASSET_URL = "/api/v1/tools/asset"


class _NoopExecutor:
    """占位执行器：拦截后台任务提交，避免测试中启动真实比对线程。"""

    def submit(self, fn, *args, **kwargs):
        return None

    def shutdown(self, *args, **kwargs):
        return None


def _input_filenames() -> dict[str, str]:
    """构造能通过 /scan 关键词与年月规则匹配的输入文件名。"""
    now = datetime.now()
    this_month = now.strftime("%Y%m")
    last_month = (now - relativedelta(months=1)).strftime("%Y%m")
    return {
        "thisFinance": f"财务资产{this_month}.xlsx",
        "lastFinance": f"财务资产{last_month}.xlsx",
        "thisSFC": f"SFC资产{this_month}.xlsx",
        "lastSFC": f"SFC资产{last_month}.xlsx",
        "thisNotes": f"Notes资产{this_month}.xlsx",
        "lastNotes": f"Notes资产{last_month}.xlsx",
        "thisCustomer": f"客户资产{this_month}.xlsx",
        "lastCustomer": f"客户资产{last_month}.xlsx",
        "custodianData": "财务保管人.xlsx",
        "departmentData": "财务保管部门.xlsx",
        "driData": "客户系统DRI.xlsx",
    }


def _scan_all_inputs(client, token) -> str:
    """上传全部输入文件并扫描，返回 scan_id。"""
    upload_ids = [
        tus_upload(client, token, filename, b"fake")
        for filename in _input_filenames().values()
    ]
    resp = client.post(
        f"{ASSET_URL}/scan",
        json={"upload_ids": upload_ids},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["scan_id"]


def test_scan_response_contains_filenames_only(admin_client, monkeypatch):
    """/scan 响应只含文件名，不泄露服务器绝对路径。"""
    monkeypatch.setattr(asset_comparison_job_manager, "_executor", _NoopExecutor())
    client, token = admin_client
    scan_id = _scan_all_inputs(client, token)

    upload_ids = [
        tus_upload(client, token, filename, b"fake")
        for filename in _input_filenames().values()
    ]
    resp = client.post(
        f"{ASSET_URL}/scan",
        json={"upload_ids": upload_ids},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["scan_id"] == scan_id or body["scan_id"]
    for value in body["data"].values():
        # 匹配成功的值是文件名；未匹配为空串；均不得出现路径分隔符
        if value:
            assert "/" not in value
            assert "\\" not in value


def test_jobs_rejects_incomplete_scan(admin_client, monkeypatch):
    """扫描结果缺必需输入键（部分匹配）时创建任务必须 422。"""
    monkeypatch.setattr(asset_comparison_job_manager, "_executor", _NoopExecutor())
    client, token = admin_client

    # 只上传一个文件（只能匹配 thisFinance 一个键）
    now = datetime.now()
    upload_id = tus_upload(
        client,
        token,
        f"财务资产{now.strftime('%Y%m')}.xlsx",
        b"fake",
    )
    scan_resp = client.post(
        f"{ASSET_URL}/scan",
        json={"upload_ids": [upload_id]},
        headers=auth_header(token),
    )
    assert scan_resp.status_code == 200, scan_resp.text
    scan_id = scan_resp.json()["scan_id"]

    resp = client.post(
        f"{ASSET_URL}/jobs",
        json={"scanId": scan_id, "clientRequestId": "test-req-partial"},
        headers=auth_header(token),
    )
    assert resp.status_code == 422, resp.text
    assert "缺少必需输入" in resp.json()["detail"]


def test_jobs_rejects_path_fields(admin_client, monkeypatch):
    """请求体携带路径字段必须被 422 拒绝（schema 层）。"""
    monkeypatch.setattr(asset_comparison_job_manager, "_executor", _NoopExecutor())
    client, token = admin_client
    scan_id = _scan_all_inputs(client, token)

    payload = {
        "scanId": scan_id,
        "clientRequestId": "test-req-0002",
        "thisFinance": "/etc/passwd",
        "departmentData": "/tmp/some.xlsx",
    }
    resp = client.post(f"{ASSET_URL}/jobs", json=payload, headers=auth_header(token))
    assert resp.status_code == 422, resp.text


def test_jobs_rejects_unknown_scan(admin_client, monkeypatch):
    """不存在的 scan_id 必须被拒绝。"""
    monkeypatch.setattr(asset_comparison_job_manager, "_executor", _NoopExecutor())
    client, token = admin_client

    payload = {
        "scanId": "a" * 32,
        "clientRequestId": "test-req-0003",
    }
    resp = client.post(f"{ASSET_URL}/jobs", json=payload, headers=auth_header(token))
    assert resp.status_code == 422, resp.text
    assert "扫描会话不存在" in resp.json()["detail"]


def test_cross_user_scan_id_denied(admin_client, client, monkeypatch):
    """B 用户不能使用 A 用户的 scan_id 建任务（按用户隔离）。"""
    monkeypatch.setattr(asset_comparison_job_manager, "_executor", _NoopExecutor())
    admin, admin_token = admin_client
    scan_id = _scan_all_inputs(admin, admin_token)

    # 注册并审批 alice（获"工具使用者"角色 → 有 asset-comparison 权限）
    resp = client.post(
        "/api/v1/auth/register",
        json={"username": "alice", "password": "alice-pass-123"},
    )
    assert resp.status_code == 200, resp.text
    alice_id = resp.json()["id"]
    resp = admin.post(
        f"/api/v1/admin/users/{alice_id}/approve",
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200, resp.text
    resp = client.post(
        "/api/v1/auth/token",
        data={"username": "alice", "password": "alice-pass-123"},
    )
    alice_token = resp.json()["access_token"]

    resp = client.post(
        f"{ASSET_URL}/jobs",
        json={"scanId": scan_id, "clientRequestId": "alice-req-0001"},
        headers=auth_header(alice_token),
    )
    assert resp.status_code == 422, resp.text
    assert "扫描会话不存在" in resp.json()["detail"]

    # alice 用自己的 scan 可正常建任务
    alice_scan = _scan_all_inputs(client, alice_token)
    resp = client.post(
        f"{ASSET_URL}/jobs",
        json={"scanId": alice_scan, "clientRequestId": "alice-req-0002"},
        headers=auth_header(alice_token),
    )
    assert resp.status_code == 202, resp.text

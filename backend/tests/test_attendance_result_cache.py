"""出勤结果缓存的容量边界回归测试。

``put`` 必须保证返回的句柄指向仍然存在的产物，并且一次写入不能连带清掉
其他用户的结果。这两条不变量在单个结果超过 ``max_bytes`` 时最容易破坏：
条目先被写入并计数，再被执行淘汰，最后仍被返回。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from app.api.endpoints import attendance as attendance_endpoint
from app.models.user import User
from app.services.attendance import AttendanceResultTooLargeError
from app.services.attendance.cache import AttendanceResultCache
from app.services.task_artifacts import TaskArtifactStore
from app.services.upload.store import UploadNotFoundError
from tests.conftest import auth_header, tus_upload


def _cache(root: Path, **kwargs) -> AttendanceResultCache:
    return AttendanceResultCache(artifact_store=TaskArtifactStore(root), **kwargs)


def test_put_returns_live_entry(tmp_path: Path):
    cache = _cache(tmp_path, max_bytes=1024)

    entry = cache.put(user_id=1, filename="ok.xlsx", content=b"O" * 512)

    assert entry.content_path.exists()
    assert cache.get(entry.result_id, 1).content == b"O" * 512


def test_oversized_result_is_rejected_before_writing(tmp_path: Path):
    cache = _cache(tmp_path, max_bytes=1024)

    with pytest.raises(AttendanceResultTooLargeError):
        cache.put(user_id=1, filename="big.xlsx", content=b"X" * 1025)

    # 拒绝必须发生在落盘之前：没有条目、没有计数、没有残留任务目录
    assert cache._entries == {}
    assert cache._total_bytes == 0
    assert list(tmp_path.rglob("manifest.json")) == []


def test_oversized_result_keeps_other_principals_entries(tmp_path: Path):
    cache = _cache(tmp_path, max_bytes=1024)
    small = cache.put(user_id=9, filename="small.xlsx", content=b"S" * 512)

    with pytest.raises(AttendanceResultTooLargeError):
        cache.put(user_id=10, filename="big.xlsx", content=b"L" * 2048)

    assert cache.get(small.result_id, 9).content == b"S" * 512
    assert small.content_path.exists()


def test_put_never_returns_an_evicted_entry(tmp_path: Path):
    """每个结果都在上限内时，旧条目被淘汰，新条目必须仍然可用。"""
    cache = _cache(tmp_path, max_bytes=1000)

    first = cache.put(user_id=1, filename="first.xlsx", content=b"A" * 600)
    second = cache.put(user_id=1, filename="second.xlsx", content=b"B" * 600)

    assert not first.content_path.exists()
    assert second.content_path.exists()
    assert cache.get(second.result_id, 1).content == b"B" * 600


def test_analyze_maps_oversized_result_to_413(admin_client, db, monkeypatch):
    """路由层：缓存拒绝必须变成明确的 413，且不留下源上传。"""
    client, token = admin_client
    attendance_id = tus_upload(client, token, "attendance.xlsx", b"fake")
    shift_id = tus_upload(client, token, "shift.xlsx", b"fake")

    monkeypatch.setattr(
        attendance_endpoint.AttendanceService,
        "analyze",
        lambda *args, **kwargs: object(),
    )
    monkeypatch.setattr(
        attendance_endpoint.AttendanceService,
        "export",
        lambda *args, **kwargs: b"X" * 2048,
    )
    monkeypatch.setattr(attendance_endpoint.attendance_result_cache, "max_bytes", 1024)

    resp = client.post(
        "/api/v1/tools/attendance/analyze",
        json={"attendance_upload_id": attendance_id, "shift_upload_id": shift_id},
        headers=auth_header(token),
    )

    assert resp.status_code == 413, resp.text
    assert "缓存上限" in resp.json()["detail"]

    root = db.scalars(select(User).where(User.username == "root")).one()
    for upload_id in (attendance_id, shift_id):
        with pytest.raises(UploadNotFoundError):
            attendance_endpoint.store.get_owned_info(upload_id, root.id)

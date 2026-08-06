"""sixty_seconds 每日新闻（POST /tools/sixty-seconds/daily）服务与端点测试。

不真连外网：用 unittest.mock 替换 urllib.request.urlopen，按精确 URL 分发模拟
镜像响应；缓存目录通过 get_daily_news 的 cache_dir 参数或 monkeypatch
tempfile.gettempdir 隔离。
"""

import json
import tempfile
import urllib.error
import urllib.request
from datetime import datetime
from unittest import mock

from app.services.sixty_seconds import daily as daily_service
from tests.conftest import auth_header

URL = "/api/v1/tools/sixty-seconds/daily"

FIXED_NOW = datetime(2026, 8, 6, 10, 0, 0)

SAMPLE_JSON = {
    "date": "2026-08-06",
    "news": ["第一条新闻", "第二条新闻"],
    "cover": "https://example.com/cover.jpg",
    "tip": "今日微语",
    "image": "https://example.com/image.png",
    "link": "https://example.com/article",
    "updated": "2026/08/06 01:00:00",
    "updated_at": 1780000000000,
}


def mirror_url(date: str, index: int) -> str:
    """第 index 个镜像对某日期的完整 URL。"""
    return daily_service._MIRROR_TEMPLATES[index].format(date=date)


class FakeResponse:
    """模拟 urllib 响应对象。"""

    def __init__(
        self, status: int, body: dict | bytes, headers: dict | None = None
    ) -> None:
        self.status = status
        if isinstance(body, bytes):
            self._body = body
            default_ct = "image/png"
        else:
            self._body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            default_ct = "application/json"
        self.headers = headers or {"Content-Type": default_ct}

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args) -> None:
        return None


def make_fake_urlopen(spec: dict):
    """spec: {精确 URL: (status, data) 或 (status, data, headers)}；未收录的 URL 视为 404（抛 HTTPError）。

    返回 Mock（带 call_count），便于断言请求次数。
    """

    def _call(request_or_url, *args, **kwargs):
        url = (
            request_or_url.full_url
            if hasattr(request_or_url, "full_url")
            else str(request_or_url)
        )
        item = spec.get(url)
        if item is None:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        if len(item) == 3:
            status, data, headers = item
        else:
            status, data = item
            headers = None
        if status != 200:
            raise urllib.error.HTTPError(url, status, "Error", {}, None)
        return FakeResponse(status, data, headers)

    return mock.Mock(side_effect=_call)


def all_mirrors_fail_spec(dates: list[str]) -> dict:
    return {mirror_url(d, i): None for d in dates for i in range(4)}


# ---------- 服务层 ----------


def test_first_mirror_success_writes_cache(tmp_path, monkeypatch):
    """首个镜像 200 + 合法 JSON：结果含 news/day_of_week/lunar，且写入缓存文件。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {mirror_url(date, 0): (200, SAMPLE_JSON)}
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(date=date, cache_dir=cache_dir, now=FIXED_NOW)

    assert result is not None
    assert result["date"] == date
    assert result["news"] == [
        {"title": "第一条新闻", "link": ""},
        {"title": "第二条新闻", "link": ""},
    ]
    assert result["day_of_week"] == "星期四"
    assert result["lunar_date"] == "二〇二六年六月廿四"
    assert result["tip"] == SAMPLE_JSON["tip"]
    assert result["updated_at"] == SAMPLE_JSON["updated_at"]
    assert result["api_updated"] == "2026-08-06 10:00:00"
    assert result["api_updated_at"] == int(FIXED_NOW.timestamp() * 1000)

    cached = json.loads((cache_dir / f"{date}.json").read_text(encoding="utf-8"))
    assert cached["news"] == SAMPLE_JSON["news"]
    # 原子写：不留临时文件
    assert not list(cache_dir.glob("*.tmp"))


def test_fourth_mirror_success_after_404s(tmp_path, monkeypatch):
    """前 3 个镜像 404，第 4 个成功。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {
        mirror_url(date, 0): None,
        mirror_url(date, 1): None,
        mirror_url(date, 2): None,
        mirror_url(date, 3): (200, SAMPLE_JSON),
    }
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(date=date, cache_dir=cache_dir, now=FIXED_NOW)

    assert result is not None
    assert result["date"] == date
    assert result["news"][0]["title"] == "第一条新闻"
    # 只请求了该日期，未深入日期链的其它日期
    assert urllib.request.urlopen.call_count == 4


def test_empty_news_skips_to_next_mirror(tmp_path, monkeypatch):
    """news 为空数组视为失败，继续尝试下一个镜像。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {
        mirror_url(date, 0): (200, {**SAMPLE_JSON, "news": []}),
        mirror_url(date, 1): (200, {**SAMPLE_JSON, "news": "not-a-list"}),
        mirror_url(date, 2): (200, SAMPLE_JSON),
    }
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(date=date, cache_dir=cache_dir, now=FIXED_NOW)

    assert result is not None
    assert result["news"] == [
        {"title": "第一条新闻", "link": ""},
        {"title": "第二条新闻", "link": ""},
    ]


def test_all_fail_uses_yesterday_cache(tmp_path, monkeypatch):
    """全部镜像失败但缓存目录有昨天文件：返回缓存数据。"""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    yesterday = {**SAMPLE_JSON, "date": "2026-08-05", "news": ["昨天新闻"]}
    (cache_dir / "2026-08-05.json").write_text(
        json.dumps(yesterday, ensure_ascii=False), encoding="utf-8"
    )
    spec = all_mirrors_fail_spec(["2026-08-06", "2026-08-05", "2026-08-04"])
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(
        date="2026-08-06", cache_dir=cache_dir, now=FIXED_NOW
    )

    assert result is not None
    assert result["date"] == "2026-08-05"
    assert result["news"] == [{"title": "昨天新闻", "link": ""}]
    assert result["day_of_week"] == "星期三"
    assert result["lunar_date"] == "二〇二六年六月廿三"
    # 网络确实全部失败过（今天 4 个镜像都被尝试）
    assert urllib.request.urlopen.call_count == 4


def test_all_fail_uses_nearest_offchain_cache(tmp_path, monkeypatch):
    """全部失败且链内无缓存：取缓存目录中日期最近的其它文件。"""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    for d, news in (("2026-08-01", "更远"), ("2026-08-02", "更近")):
        (cache_dir / f"{d}.json").write_text(
            json.dumps({**SAMPLE_JSON, "date": d, "news": [news]}, ensure_ascii=False),
            encoding="utf-8",
        )
    spec = all_mirrors_fail_spec(["2026-08-06", "2026-08-05", "2026-08-04"])
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(
        date="2026-08-06", cache_dir=cache_dir, now=FIXED_NOW
    )

    assert result is not None
    assert result["date"] == "2026-08-02"
    assert result["news"] == [{"title": "更近", "link": ""}]


def test_cache_hit_without_network(tmp_path, monkeypatch):
    """命中缓存（非 force_update）直接返回，不发起网络请求。"""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "2026-08-06.json").write_text(
        json.dumps(SAMPLE_JSON, ensure_ascii=False), encoding="utf-8"
    )
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen({}))

    result = daily_service.get_daily_news(
        date="2026-08-06", cache_dir=cache_dir, now=FIXED_NOW
    )

    assert result is not None
    assert result["news"][0]["title"] == "第一条新闻"
    assert urllib.request.urlopen.call_count == 0


def test_force_update_bypasses_cache(tmp_path, monkeypatch):
    """force_update=true 绕过缓存重新拉取并覆盖缓存。"""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    stale = {**SAMPLE_JSON, "news": ["旧新闻"]}
    (cache_dir / "2026-08-06.json").write_text(
        json.dumps(stale, ensure_ascii=False), encoding="utf-8"
    )
    fresh = {**SAMPLE_JSON, "news": ["新新闻"]}
    spec = {mirror_url("2026-08-06", 0): (200, fresh)}
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(
        date="2026-08-06", force_update=True, cache_dir=cache_dir, now=FIXED_NOW
    )

    assert result is not None
    assert result["news"] == [{"title": "新新闻", "link": ""}]
    cached = json.loads((cache_dir / "2026-08-06.json").read_text(encoding="utf-8"))
    assert cached["news"] == ["新新闻"]


def test_date_chain_falls_back_to_yesterday(tmp_path, monkeypatch):
    """请求日期失败时按日期链回退到昨天。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {
        **all_mirrors_fail_spec([date]),
        mirror_url("2026-08-05", 0): (200, {**SAMPLE_JSON, "date": "2026-08-05"}),
    }
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(date=date, cache_dir=cache_dir, now=FIXED_NOW)

    assert result is not None
    assert result["date"] == "2026-08-05"
    assert result["day_of_week"] == "星期三"


def test_all_fail_no_cache_returns_none(tmp_path, monkeypatch):
    """全部失败且无任何缓存：返回 None（端点转 502）。"""
    cache_dir = tmp_path / "cache"
    spec = all_mirrors_fail_spec(["2026-08-06", "2026-08-05", "2026-08-04"])
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    result = daily_service.get_daily_news(
        date="2026-08-06", cache_dir=cache_dir, now=FIXED_NOW
    )

    assert result is None


# ---------- 端点层 ----------


def test_endpoint_returns_result(admin_client, monkeypatch, tmp_path):
    """带认证调用端点：返回 {"result": {...}}，含 news 与 day_of_week。"""
    client, token = admin_client
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    date = "2026-08-06"
    spec = {mirror_url(date, 0): (200, SAMPLE_JSON)}
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    resp = client.post(URL, json={"date": date}, headers=auth_header(token))

    assert resp.status_code == 200, resp.text
    result = resp.json()["result"]
    assert result["news"][0]["title"] == "第一条新闻"
    assert result["day_of_week"] == "星期四"
    assert result["lunar_date"]
    # 缓存写入到 monkeypatch 后的临时目录
    assert (tmp_path / "toolhub-60s-cache" / f"{date}.json").is_file()


def test_endpoint_502_when_all_fail(admin_client, monkeypatch, tmp_path):
    """全部失败且无缓存：端点返回 502 + 中文 detail。"""
    client, token = admin_client
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen({}))

    resp = client.post(URL, json={}, headers=auth_header(token))

    assert resp.status_code == 502
    assert resp.json()["detail"] == "获取 60s 数据失败,请稍后重试"


def test_endpoint_invalid_date_400(admin_client, monkeypatch, tmp_path):
    """非法日期格式返回 400。"""
    client, token = admin_client
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))

    resp = client.post(URL, json={"date": "2026-13-99"}, headers=auth_header(token))

    assert resp.status_code == 400
    assert "YYYY-MM-DD" in resp.json()["detail"]


def test_endpoint_requires_auth(client):
    """未认证调用返回 401。"""
    resp = client.post(URL, json={})
    assert resp.status_code == 401


# ---------- 图片端点与服务测试 ----------

IMAGE_URL = "/api/v1/tools/sixty-seconds/image"
VALID_PNG_BYTES = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRtest_image_data"


def image_mirror_url(date: str, index: int) -> str:
    """第 index 个图片镜像对某日期的完整 URL。"""
    return daily_service._IMAGE_MIRROR_TEMPLATES[index].format(date=date)


def test_image_first_mirror_success_writes_cache(tmp_path, monkeypatch):
    """首个图片镜像 200 + 合法 PNG：返回 bytes 且写入缓存文件。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {image_mirror_url(date, 0): (200, VALID_PNG_BYTES)}
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    res = daily_service.get_daily_image(date, cache_dir=cache_dir)

    assert res == (date, VALID_PNG_BYTES)
    cache_file = cache_dir / f"{date}.png"
    assert cache_file.is_file()
    assert cache_file.read_bytes() == VALID_PNG_BYTES


def test_image_first_two_fail_third_succeeds(tmp_path, monkeypatch):
    """前 2 个图片镜像失败，第 3 个成功。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {image_mirror_url(date, 2): (200, VALID_PNG_BYTES)}
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    res = daily_service.get_daily_image(date, cache_dir=cache_dir)

    assert res == (date, VALID_PNG_BYTES)
    assert urllib.request.urlopen.call_count == 3
    assert (cache_dir / f"{date}.png").is_file()


def test_image_all_fail_no_cache_returns_none(tmp_path, monkeypatch):
    """全部图片镜像失败且无缓存：返回 None。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen({}))

    res = daily_service.get_daily_image(date, cache_dir=cache_dir)

    assert res is None


def test_image_cache_hit_and_force_update(tmp_path, monkeypatch):
    """命中缓存（非 force_update）0 网络调用；force_update=true 绕过并更新缓存。"""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    date = "2026-08-06"
    cached_bytes = b"\x89PNGcached_data"
    (cache_dir / f"{date}.png").write_bytes(cached_bytes)

    spec = {image_mirror_url(date, 0): (200, VALID_PNG_BYTES)}
    mock_urlopen = make_fake_urlopen(spec)
    monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

    res1 = daily_service.get_daily_image(date, force_update=False, cache_dir=cache_dir)
    assert res1 == (date, cached_bytes)
    assert mock_urlopen.call_count == 0

    res2 = daily_service.get_daily_image(date, force_update=True, cache_dir=cache_dir)
    assert res2 == (date, VALID_PNG_BYTES)
    assert mock_urlopen.call_count == 1
    assert (cache_dir / f"{date}.png").read_bytes() == VALID_PNG_BYTES


def test_image_non_png_content_skips_mirror(tmp_path, monkeypatch):
    """镜像返回非 PNG 内容（魔数不符）视为失败，继续下一镜像。"""
    cache_dir = tmp_path / "cache"
    date = "2026-08-06"
    spec = {
        image_mirror_url(date, 0): (200, b"<html>HTML Error</html>"),
        image_mirror_url(date, 1): (200, VALID_PNG_BYTES),
    }
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    res = daily_service.get_daily_image(date, cache_dir=cache_dir)

    assert res == (date, VALID_PNG_BYTES)
    assert urllib.request.urlopen.call_count == 2


def test_image_endpoint_success(admin_client, monkeypatch, tmp_path):
    """调用图片端点：返回 base64 可解码且魔数正确、data_uri 前缀正确。"""
    import base64

    client, token = admin_client
    date = "2026-08-06"
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    spec = {image_mirror_url(date, 0): (200, VALID_PNG_BYTES)}
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen(spec))

    resp = client.post(IMAGE_URL, json={"date": date}, headers=auth_header(token))

    assert resp.status_code == 200
    res = resp.json()["result"]
    assert res["date"] == date
    assert res["mime_type"] == "image/png"
    decoded = base64.b64decode(res["base64"])
    assert decoded == VALID_PNG_BYTES
    assert decoded.startswith(b"\x89PNG")
    assert res["data_uri"] == f"data:image/png;base64,{res['base64']}"


def test_image_endpoint_502_when_all_fail(admin_client, monkeypatch, tmp_path):
    """全部图片镜像失败且无缓存：端点返回 502。"""
    client, token = admin_client
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(urllib.request, "urlopen", make_fake_urlopen({}))

    resp = client.post(IMAGE_URL, json={}, headers=auth_header(token))

    assert resp.status_code == 502
    assert resp.json()["detail"] == "获取 60s 图片失败,请稍后重试"


def test_image_endpoint_invalid_date_400(admin_client, monkeypatch, tmp_path):
    """非法日期格式返回 400。"""
    client, token = admin_client
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))

    resp = client.post(
        IMAGE_URL, json={"date": "invalid-date"}, headers=auth_header(token)
    )

    assert resp.status_code == 400
    assert "YYYY-MM-DD" in resp.json()["detail"]

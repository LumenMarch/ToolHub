"""qrcode_tools 端点测试：PNG 生成、level/size/text 校验。"""

import base64
import io

from PIL import Image

from tests.conftest import auth_header

QR_URL = "/api/v1/tools/qrcode"


def test_generate_qrcode_png(admin_client):
    """生成的 base64 可解码为 PNG（魔数 \x89PNG），data_uri 前缀正确。"""
    client, token = admin_client
    resp = client.post(
        QR_URL,
        json={"text": "https://example.com", "size": 256, "level": "M"},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    assert data["mime_type"] == "image/png"
    assert data["text"] == "https://example.com"

    raw = base64.b64decode(data["base64"])
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"

    assert data["data_uri"] == f"data:image/png;base64,{data['base64']}"


def test_qrcode_png_decodes_with_exact_size_and_sharp_modules(admin_client):
    """PNG 可解码、尺寸等于请求值，且放大后仅黑白两色（最近邻插值生效）。"""
    client, token = admin_client
    resp = client.post(
        QR_URL,
        json={"text": "sharp-modules", "size": 256, "level": "H"},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    img = Image.open(io.BytesIO(base64.b64decode(resp.json()["result"]["base64"])))
    assert img.size == (256, 256)
    # 最近邻放大不会产生灰色过渡像素；若误用双三次插值会出现中间灰度
    colors = img.getcolors(maxcolors=2)
    assert colors is not None
    assert len(colors) == 2


def test_qrcode_level_h_and_size_bounds(admin_client):
    """level=H 与边界尺寸 64 可用。"""
    client, token = admin_client
    for level in ("L", "M", "Q", "H"):
        resp = client.post(
            QR_URL,
            json={"text": "hello", "level": level},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, (level, resp.text)

    small = client.post(
        QR_URL, json={"text": "hello", "size": 64}, headers=auth_header(token)
    )
    assert small.status_code == 200, small.text


def test_qrcode_invalid_level_400(admin_client):
    """无效 level 返回 400。"""
    client, token = admin_client
    resp = client.post(
        QR_URL,
        json={"text": "hello", "level": "X"},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "L/M/Q/H" in resp.json()["detail"]


def test_qrcode_empty_text_400(admin_client):
    """空 text 返回 400。"""
    client, token = admin_client
    resp = client.post(QR_URL, json={"text": ""}, headers=auth_header(token))
    assert resp.status_code == 400


def test_qrcode_invalid_size_400(admin_client):
    """超出 64~1024 的 size 返回 400。"""
    client, token = admin_client
    for size in (63, 1025):
        resp = client.post(
            QR_URL,
            json={"text": "hello", "size": size},
            headers=auth_header(token),
        )
        assert resp.status_code == 400, (size, resp.text)


def test_qrcode_oversized_content_400(admin_client):
    """超过二维码容量上限（version 40）的内容返回 400 而非 500。"""
    client, token = admin_client
    resp = client.post(
        QR_URL,
        json={"text": "A" * 3000, "size": 256, "level": "H"},
        headers=auth_header(token),
    )
    assert resp.status_code == 400, resp.text
    assert "内容过长" in resp.json()["detail"]

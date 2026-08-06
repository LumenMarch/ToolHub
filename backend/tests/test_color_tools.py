"""color_tools 端点测试：颜色转换已知向量、无效颜色 400、配色方案结构。"""

import re

from tests.conftest import auth_header

CONVERT_URL = "/api/v1/tools/color/convert"
PALETTE_URL = "/api/v1/tools/color/palette"

HEX_PATTERN = re.compile(r"^#[0-9A-F]{6}$")


def test_convert_known_color(admin_client):
    """#FF5733 的 rgb/hsl/cmyk/name/互补色等字段断言。"""
    client, token = admin_client
    resp = client.post(
        CONVERT_URL, json={"color": "#FF5733"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    assert data["hex"] == "#FF5733"
    assert data["name"] == "红色系"
    assert data["rgb"] == {"r": 255, "g": 87, "b": 51, "string": "rgb(255, 87, 51)"}
    assert data["hsl"] == {"h": 11, "s": 100, "l": 60, "string": "hsl(11, 100%, 60%)"}
    assert data["cmyk"]["c"] == 0
    assert data["cmyk"]["m"] == 66
    assert data["cmyk"]["y"] == 80
    assert data["cmyk"]["k"] == 0
    # 互补色 = hsl(191, 100%, 60%)
    assert data["complementary"] == "#33DAFF"
    # 结构字段存在
    assert data["hsv"]["v"] == 100
    assert data["lab"]["l"] >= 0
    # 亮橙色对黑底对比度更高，最佳文字颜色应为黑色
    assert data["contrast"]["black"] > data["contrast"]["white"]
    assert data["accessibility"]["best_text_color"] == "#000000"
    assert len(data["analogous"]) == 2
    assert len(data["triadic"]) == 2


def test_convert_normalizes_hex(admin_client):
    """小写与 3 位 HEX 输入被规范化。"""
    client, token = admin_client
    resp = client.post(
        CONVERT_URL, json={"color": "ff5733"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["result"]["hex"] == "#FF5733"

    short = client.post(CONVERT_URL, json={"color": "f53"}, headers=auth_header(token))
    assert short.status_code == 200, short.text
    assert short.json()["result"]["hex"] == "#FF5533"


def test_convert_invalid_hex_400(admin_client):
    """无效 HEX 返回 400 并对齐 60s 中文文案。"""
    client, token = admin_client
    for bad in ("xyz", "#12", "#GGHHII", "1234567"):
        resp = client.post(CONVERT_URL, json={"color": bad}, headers=auth_header(token))
        assert resp.status_code == 400, (bad, resp.text)
        assert "无效的颜色编码" in resp.json()["detail"]


def test_convert_random_color_without_input(admin_client):
    """未提供 color 时返回随机颜色（合法 HEX）。"""
    client, token = admin_client
    resp = client.post(CONVERT_URL, json={}, headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    assert HEX_PATTERN.match(resp.json()["result"]["hex"])


def test_palette_structure(admin_client):
    """配色方案响应结构断言：input/palettes/metadata。"""
    client, token = admin_client
    resp = client.post(
        PALETTE_URL, json={"color": "#FF5733"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    assert data["input"]["hex"] == "#FF5733"
    assert data["input"]["rgb"] == {"r": 255, "g": 87, "b": 51}
    assert data["input"]["hsl"] == {"h": 11, "s": 100, "l": 60}
    assert data["input"]["name"] == "红色系"

    assert data["metadata"]["color_theory"] == "基于色彩理论生成的专业配色方案"
    assert data["metadata"]["total_palettes"] == len(data["palettes"])
    assert "Web 设计" in data["metadata"]["applications"]

    names = [p["name"] for p in data["palettes"]]
    assert names[0] == "单色配色"
    assert "互补配色" in names
    assert "邻近配色" in names
    assert "三角配色" in names
    # 暖色系基础色 #FF5733（h=11）应包含暖色调配色
    assert "暖色调配色" in names
    assert "冷色调配色" not in names

    for palette in data["palettes"]:
        assert palette["name"] and palette["description"]
        assert palette["colors"]
        for color in palette["colors"]:
            assert HEX_PATTERN.match(color["hex"])
            assert color["name"] and color["role"] and color["theory"]


def test_palette_cool_color_has_cool_palette(admin_client):
    """冷色系基础色（#2196F3，h=207）应包含冷色调配色、不含暖色调。"""
    client, token = admin_client
    resp = client.post(
        PALETTE_URL, json={"color": "#2196F3"}, headers=auth_header(token)
    )
    assert resp.status_code == 200, resp.text
    names = [p["name"] for p in resp.json()["result"]["palettes"]]
    assert "冷色调配色" in names
    assert "暖色调配色" not in names


def test_palette_invalid_hex_400(admin_client):
    """palette 的无效颜色返回 400 并对齐 60s 中文文案。"""
    client, token = admin_client
    resp = client.post(
        PALETTE_URL, json={"color": "notacolor"}, headers=auth_header(token)
    )
    assert resp.status_code == 400
    assert "不是有效的 HEX 颜色编码" in resp.json()["detail"]


def test_palette_random_color_without_input(admin_client):
    """palette 未提供 color 时生成随机颜色并返回完整结构。"""
    client, token = admin_client
    resp = client.post(PALETTE_URL, json={}, headers=auth_header(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]
    assert HEX_PATTERN.match(data["input"]["hex"])
    assert data["metadata"]["total_palettes"] == len(data["palettes"])

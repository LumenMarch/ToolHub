"""health 端点测试：已知 BMI 向量、缺参/越界/非法 gender 400、响应结构。"""

import pytest

from tests.conftest import auth_header

CALCULATE_URL = "/api/v1/tools/health/calculate"

TOP_LEVEL_BLOCKS = [
    "basic_info",
    "bmi",
    "weight_assessment",
    "metabolism",
    "body_surface_area",
    "body_fat",
    "health_advice",
    "ideal_measurements",
    "disclaimer",
]


def test_calculate_known_bmi(admin_client):
    """170cm/65kg/male/30 → bmi.value ≈ 22.49，全部结构块齐全。"""
    client, token = admin_client
    resp = client.post(
        CALCULATE_URL,
        json={"height": 170, "weight": 65, "gender": "male", "age": 30},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]

    assert data["bmi"]["value"] == pytest.approx(22.49, abs=1e-6)
    assert data["bmi"]["category"] == "正常体重"
    assert data["bmi"]["evaluation"] == "体重正常，保持良好"

    for block in TOP_LEVEL_BLOCKS:
        assert block in data

    # 各块关键字段（对齐 60s 字段名）
    assert data["basic_info"]["height"] == "170cm"
    assert data["basic_info"]["weight"] == "65kg"
    assert data["basic_info"]["gender"] == "男性"
    assert data["basic_info"]["age"] == "30岁"
    assert data["weight_assessment"]["standard_weight"] == "65.0kg"
    assert data["weight_assessment"]["status"] == "体重正常"
    assert data["weight_assessment"]["adjustment"] == "保持当前体重"
    assert "卡路里/天" in data["metabolism"]["bmr"]
    assert data["metabolism"]["bmr_desc"] == "基础代谢率"
    assert data["body_surface_area"]["formula"] == "Du Bois 公式"
    assert data["body_fat"]["category"] in ("极低", "正常", "略高", "过高")
    assert data["health_advice"]["health_tips_desc"] == "健康提示"
    assert isinstance(data["health_advice"]["health_tips"], list)
    assert data["ideal_measurements"]["chest_desc"] == "胸围"
    assert "免责" in data["disclaimer"] or "专业医疗" in data["disclaimer"]


def test_calculate_female(admin_client):
    """女性分支：gender_desc 为 女性，三围 note 为女性标准。"""
    client, token = admin_client
    resp = client.post(
        CALCULATE_URL,
        json={"height": 160, "weight": 50, "gender": "female", "age": 25},
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["result"]
    assert data["basic_info"]["gender"] == "女性"
    assert data["ideal_measurements"]["note"] == "女性理想三围参考标准"


def test_missing_params_400(admin_client):
    """缺参返回 400，文案对齐 60s。"""
    client, token = admin_client
    resp = client.post(CALCULATE_URL, json={}, headers=auth_header(token))
    assert resp.status_code == 400, resp.text
    assert "不能为空" in resp.json()["detail"]

    partial = client.post(
        CALCULATE_URL,
        json={"height": 170},
        headers=auth_header(token),
    )
    assert partial.status_code == 400
    assert "不能为空" in partial.json()["detail"]


def test_out_of_range_400(admin_client):
    """越界参数返回 400（身高/体重/年龄）。"""
    client, token = admin_client
    base = {"height": 170, "weight": 65, "gender": "male", "age": 30}
    for bad in (
        {"height": 301},
        {"height": 49},
        {"weight": 5},
        {"weight": 500},
        {"age": 0},
        {"age": 200},
    ):
        payload = dict(base, **bad)
        resp = client.post(CALCULATE_URL, json=payload, headers=auth_header(token))
        assert resp.status_code == 400, (payload, resp.text)
        assert "参数超出合理范围" in resp.json()["detail"]


def test_invalid_gender_400(admin_client):
    """gender 非法返回 400，文案对齐 60s。"""
    client, token = admin_client
    resp = client.post(
        CALCULATE_URL,
        json={"height": 170, "weight": 65, "gender": "other", "age": 30},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert '参数 gender 必须是 "male" 或 "female"' in resp.json()["detail"]


def test_requires_auth(client):
    """未认证返回 401。"""
    resp = client.post(
        CALCULATE_URL,
        json={"height": 170, "weight": 65, "gender": "male", "age": 30},
    )
    assert resp.status_code == 401

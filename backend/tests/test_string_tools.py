"""string_tools 端点测试：hash / url / gzip / deflate / brotli 等 action 的往返与边界。"""

import gzip
import zlib

import brotli

from tests.conftest import auth_header

TOOLS_URL = "/api/v1/tools/string/process"


def _headers(token: str) -> dict[str, str]:
    return auth_header(token)


def test_hash_known_vectors(admin_client):
    """hash 各算法对已知向量输出正确摘要。"""
    client, token = admin_client
    cases = {
        "hash_md5": "900150983cd24fb0d6963f7d28e17f72",
        "hash_sha1": "a9993e364706816aba3e25717850c26c9cd0d89d",
        "hash_sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "hash_sha512": (
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a"
            "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
        ),
    }
    for action, expected in cases.items():
        resp = client.post(
            TOOLS_URL, json={"text": "abc", "action": action}, headers=_headers(token)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["result"] == expected


def test_url_encode_matches_encodeURIComponent(admin_client):
    """url_encode 对齐 JS encodeURIComponent：中文字符与特殊字符全部编码。"""
    client, token = admin_client
    resp = client.post(
        TOOLS_URL,
        json={"text": "你好 world?x=1", "action": "url_encode"},
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["result"] == "%E4%BD%A0%E5%A5%BD%20world%3Fx%3D1"

    decoded = client.post(
        TOOLS_URL,
        json={
            "text": "%E4%BD%A0%E5%A5%BD%20world%3Fx%3D1",
            "action": "url_decode",
        },
        headers=_headers(token),
    )
    assert decoded.status_code == 200, decoded.text
    assert decoded.json()["result"] == "你好 world?x=1"


def test_gzip_encode_decode_round_trip(admin_client):
    """gzip encode → decode 往返还原原文。"""
    client, token = admin_client
    text = "ToolHub gzip 往返测试 2026"
    encoded = client.post(
        TOOLS_URL, json={"text": text, "action": "gzip_encode"}, headers=_headers(token)
    )
    assert encoded.status_code == 200, encoded.text
    hex_text = encoded.json()["result"]
    assert len(hex_text) % 2 == 0

    decoded = client.post(
        TOOLS_URL,
        json={"text": hex_text, "action": "gzip_decode"},
        headers=_headers(token),
    )
    assert decoded.status_code == 200, decoded.text
    assert decoded.json()["result"] == text


def test_deflate_encode_decode_round_trip(admin_client):
    """deflate encode → decode 往返还原原文。"""
    client, token = admin_client
    text = "deflate round trip"
    encoded = client.post(
        TOOLS_URL,
        json={"text": text, "action": "deflate_encode"},
        headers=_headers(token),
    )
    assert encoded.status_code == 200, encoded.text

    decoded = client.post(
        TOOLS_URL,
        json={"text": encoded.json()["result"], "action": "deflate_decode"},
        headers=_headers(token),
    )
    assert decoded.status_code == 200, decoded.text
    assert decoded.json()["result"] == text


def test_brotli_encode_decode_round_trip(admin_client):
    """brotli encode → decode 往返还原原文。"""
    client, token = admin_client
    text = "brotli 压缩往返 🎉"
    encoded = client.post(
        TOOLS_URL,
        json={"text": text, "action": "brotli_encode"},
        headers=_headers(token),
    )
    assert encoded.status_code == 200, encoded.text

    decoded = client.post(
        TOOLS_URL,
        json={"text": encoded.json()["result"], "action": "brotli_decode"},
        headers=_headers(token),
    )
    assert decoded.status_code == 200, decoded.text
    assert decoded.json()["result"] == text


def test_decode_actions_reject_invalid_hex(admin_client):
    """非法的十六进制输入在 decode 类 action 下返回 400。"""
    client, token = admin_client
    for action in ("gzip_decode", "deflate_decode", "brotli_decode"):
        resp = client.post(
            TOOLS_URL,
            json={"text": "zz-not-hex", "action": action},
            headers=_headers(token),
        )
        assert resp.status_code == 400, (action, resp.text)


def test_decode_actions_reject_high_expansion(admin_client):
    """高膨胀压缩数据（解压炸弹）被 16MB 输出上限拦截，返回 400 而非撑爆内存。"""
    client, token = admin_client
    # 32MB 重复字节，远超 16MB 解压上限；压缩后 hex 远小于 1MB 输入上限
    big = b"a" * (32 * 1024 * 1024)
    cases = {
        "gzip_decode": gzip.compress(big).hex(),
        "deflate_decode": zlib.compress(big).hex(),
        "brotli_decode": brotli.compress(big).hex(),
    }
    for action, hex_text in cases.items():
        assert len(hex_text) < 1024 * 1024, action
        resp = client.post(
            TOOLS_URL,
            json={"text": hex_text, "action": action},
            headers=_headers(token),
        )
        assert resp.status_code == 400, (action, resp.text)
        assert resp.json()["detail"] == "解压结果超过大小限制", (action, resp.text)


def test_empty_text_400(admin_client):
    """空 text 返回 400。"""
    client, token = admin_client
    resp = client.post(
        TOOLS_URL, json={"text": "", "action": "hash_md5"}, headers=_headers(token)
    )
    assert resp.status_code == 400


def test_unknown_action_400(admin_client):
    """未知 action 返回 400。"""
    client, token = admin_client
    resp = client.post(
        TOOLS_URL, json={"text": "abc", "action": "nope"}, headers=_headers(token)
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Unknown action"


def test_requires_auth(client):
    """未认证请求返回 401。"""
    resp = client.post(TOOLS_URL, json={"text": "abc", "action": "hash_md5"})
    assert resp.status_code == 401

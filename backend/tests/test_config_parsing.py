"""配置解析测试：注册域名白名单的两种环境变量写法。

回归 PR #49 的 P1：pydantic-settings 对 list 类型 env 值默认先做 JSON 解码，
逗号分隔字符串不是合法 JSON 会抛 SettingsError；修复后用 NoDecode 让原始
字符串进入 before validator，两种写法都必须可解析。
"""

from app.core.config import Settings


def test_allowed_domains_comma_separated_env(monkeypatch):
    monkeypatch.setenv("REGISTRATION_ALLOWED_DOMAINS", "@example.com,@corp.com")
    s = Settings(_env_file=None)
    assert s.REGISTRATION_ALLOWED_DOMAINS == ["@example.com", "@corp.com"]


def test_allowed_domains_comma_separated_with_whitespace(monkeypatch):
    monkeypatch.setenv("REGISTRATION_ALLOWED_DOMAINS", "@a.com, @b.com ,")
    s = Settings(_env_file=None)
    assert s.REGISTRATION_ALLOWED_DOMAINS == ["@a.com", "@b.com"]


def test_allowed_domains_json_array_env(monkeypatch):
    monkeypatch.setenv("REGISTRATION_ALLOWED_DOMAINS", '["@example.com", "@corp.com"]')
    s = Settings(_env_file=None)
    assert s.REGISTRATION_ALLOWED_DOMAINS == ["@example.com", "@corp.com"]


def test_allowed_domains_unset_defaults_empty(monkeypatch):
    monkeypatch.delenv("REGISTRATION_ALLOWED_DOMAINS", raising=False)
    s = Settings(_env_file=None)
    assert s.REGISTRATION_ALLOWED_DOMAINS == []

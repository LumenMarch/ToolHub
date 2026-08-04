"""pytest 共享配置。

在导入任何 app 模块之前设置环境变量，把数据库与任务产物目录指向临时位置，
避免污染开发环境（backend/toolhub.db、/tmp/toolhub-task-artifacts）。
每个测试用例前重建全部表并重跑种子数据，保证用例间完全隔离。
"""

import os
import tempfile
from pathlib import Path

# 必须在导入 app 模块之前设置
_TEST_ROOT = tempfile.mkdtemp(prefix="toolhub-pytest-")
os.environ["TASK_ARTIFACT_ROOT"] = str(Path(_TEST_ROOT) / "artifacts")
os.environ["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{Path(_TEST_ROOT) / 'test.db'}"

# 环境变量设置必须先于 app 导入，此处有意将导入置于文件中部
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.rate_limit import reset_rate_limiters  # noqa: E402
from app.db.base_class import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import run_seed  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_state(monkeypatch):
    """每个测试前重置单例状态：settings 新字段、限流器、数据库表。"""
    monkeypatch.setattr(settings, "INITIAL_ADMIN_USERNAME", "")
    monkeypatch.setattr(settings, "INITIAL_ADMIN_PASSWORD", "")
    monkeypatch.setattr(settings, "REGISTRATION_ALLOWED_DOMAINS", [])
    monkeypatch.setattr(settings, "REGISTRATION_RATE_LIMIT_PER_IP", 10)
    monkeypatch.setattr(settings, "REGISTRATION_RATE_LIMIT_WINDOW", 3600)
    monkeypatch.setattr(settings, "REGISTRATION_PENDING_TTL_DAYS", 7)
    reset_rate_limiters()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    run_seed()
    yield


@pytest.fixture
def client():
    """默认未配置 INITIAL_ADMIN 的 TestClient（/healthz 应返回 503）。"""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_client():
    """配置 INITIAL_ADMIN 引导超管；返回 (client, 管理员 access_token)。"""
    settings.INITIAL_ADMIN_USERNAME = "root"
    settings.INITIAL_ADMIN_PASSWORD = "root-pass-123"
    with TestClient(app) as c:
        resp = c.post(
            "/api/v1/auth/token",
            data={"username": "root", "password": "root-pass-123"},
        )
        assert resp.status_code == 200, resp.text
        yield c, resp.json()["access_token"]


@pytest.fixture
def db():
    """直接访问测试库的 SQLAlchemy 会话（用于断言底层数据）。"""
    session = SessionLocal()
    yield session
    session.close()


def register(client, username: str, password: str = "pw-123456"):
    """注册辅助函数。"""
    return client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password},
    )


def login(client, username: str, password: str = "pw-123456"):
    """OAuth2 表单登录辅助函数。"""
    return client.post(
        "/api/v1/auth/token",
        data={"username": username, "password": password},
    )


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

"""每日一言服务。

优先使用内置的静态数据集；若内置数据加载失败，回退到远程 API；
远程仍不可用时返回硬编码兜底句，保证服务可用。
"""

import json
import logging
import random
import urllib.error
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

# 数据文件与本模块同目录。
_DATA_PATH = Path(__file__).parent / "hitokoto.json"
# 远程兜底接口。
_REMOTE_URL = "https://60s.viki.moe/v2/hitokoto?encoding=text"
# 最终硬编码兜底句。
_FALLBACK_HITOKOTO = "落霞与孤鹜齐飞，秋水共长天一色。"


def _load_local_data() -> list[str]:
    """启动时一次性加载内置一言数据，失败返回空列表。"""
    try:
        with _DATA_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list) and data:
            return [item for item in data if isinstance(item, str) and item.strip()]
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("加载内置 hitokoto 数据失败: %s", exc)
    return []


_HITOKOTO_POOL: list[str] = _load_local_data()


def _fetch_remote() -> str | None:
    """调用远程 60s API 获取一言，失败返回 None。"""
    try:
        with urllib.request.urlopen(_REMOTE_URL, timeout=2.0) as response:  # noqa: S310
            if response.status != 200:
                logger.warning("远程获取 hitokoto 状态码异常: %s", response.status)
                return None
            text = response.read().decode("utf-8").strip()
            return text or None
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        logger.warning("远程获取 hitokoto 失败: %s", exc)
        return None


def get_random_hitokoto() -> dict:
    """随机返回一条一言，附带来源标记。

    三级兜底：内置数据 → 远程 API → 硬编码句。
    """
    if _HITOKOTO_POOL:
        return {"hitokoto": random.choice(_HITOKOTO_POOL), "source": "local"}

    remote = _fetch_remote()
    if remote:
        return {"hitokoto": remote, "source": "remote"}

    return {"hitokoto": _FALLBACK_HITOKOTO, "source": "fallback"}

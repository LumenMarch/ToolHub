"""60s 每日新闻服务（半离线）。

优先从多个静态仓库镜像拉取每日 60s 新闻，成功后写入磁盘缓存（临时文件 + 原子
rename，避免并发读到半写文件）；网络全部不可用时回退到缓存目录中日期最近的其它
文件，保证离线可用。镜像回退顺序与日期链逻辑对齐 60s 源码
（vikiboss/60s 的 tryRepoUrl 与 #fetch）。
"""

import json
import logging
import os
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from lunar_python import Solar

logger = logging.getLogger(__name__)

# 默认缓存目录：tempfile.gettempdir()/toolhub-60s-cache
CACHE_DIRNAME = "toolhub-60s-cache"
# 单镜像请求超时（秒）
_REQUEST_TIMEOUT = 8
_WEEK_DAYS = ("日", "一", "二", "三", "四", "五", "六")
# 与 60s 源码 Common.chromeUA 一致，避免默认 UA 被部分 CDN 拒绝
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)

# 镜像回退顺序，与 60s 源码 tryRepoUrl 对齐（raw.githubusercontent → jsdelivr → 备用镜像）
_MIRROR_TEMPLATES = (
    "https://raw.githubusercontent.com/vikiboss/60s-static-host/main/static/60s/{date}.json",
    "https://cdn.jsdelivr.net/gh/vikiboss/60s-static-host@main/static/60s/{date}.json",
    "https://60s-static.viki.moe/60s/{date}.json",
    "https://60s-static-host.vercel.app/60s/{date}.json",
)

# 图片镜像回退顺序（jsdmirror 国内首选）
_IMAGE_MIRROR_TEMPLATES = (
    "https://cdn.jsdmirror.com/gh/vikiboss/60s-static-host@main/static/images/{date}.png",
    "https://cdn.jsdelivr.net/gh/vikiboss/60s-static-host@main/static/images/{date}.png",
    "https://60s-static.viki.moe/images/{date}.png",
    "https://raw.githubusercontent.com/vikiboss/60s-static-host/main/static/images/{date}.png",
)


def get_default_cache_dir() -> Path:
    """默认缓存目录（测试可通过 monkeypatch tempfile.gettempdir 覆盖）。"""
    return Path(tempfile.gettempdir()) / CACHE_DIRNAME


def _ensure_cache_dir(cache_dir: Path) -> None:
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("创建 60s 缓存目录失败: %s", exc)


# 启动时创建默认缓存目录。
_ensure_cache_dir(get_default_cache_dir())


def _normalize_news(item: object) -> dict:
    """把 news 条目规范化为 {title, link}（静态仓库里条目通常是纯字符串）。"""
    if isinstance(item, dict):
        return {"title": str(item.get("title", "")), "link": str(item.get("link", ""))}
    return {"title": str(item), "link": ""}


def _fetch_date(url: str) -> dict | None:
    """拉取单个镜像并校验，失败返回 None（不影响其它镜像）。"""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(request, timeout=_REQUEST_TIMEOUT) as response:  # noqa: S310
            if response.status != 200:
                logger.warning("60s 镜像 %s 状态码异常: %s", url, response.status)
                return None
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError) as exc:
        logger.warning("60s 镜像 %s 拉取失败: %s", url, exc)
        return None

    news = data.get("news")
    if not isinstance(news, list) or not news:
        logger.warning("60s 镜像 %s 返回的 news 为空或格式错误", url)
        return None
    return data


def _fetch_from_mirrors(date_str: str) -> dict | None:
    """按镜像顺序尝试拉取某日期数据，首个成功即返回。"""
    for template in _MIRROR_TEMPLATES:
        data = _fetch_date(template.format(date=date_str))
        if data is not None:
            return data
    return None


def _atomic_write(cache_dir: Path, date_str: str, data: dict) -> None:
    """临时文件 + 原子 rename 写缓存，避免并发读到半写文件。"""
    try:
        _ensure_cache_dir(cache_dir)
        fd, tmp_path = tempfile.mkstemp(
            dir=cache_dir, prefix=f".{date_str}.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp_path, cache_dir / f"{date_str}.json")
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    except OSError as exc:
        logger.warning("写入 60s 缓存 %s 失败: %s", date_str, exc)


def _load_cache(cache_dir: Path, date_str: str) -> dict | None:
    """读取某日期缓存，文件缺失/损坏/内容非法时返回 None。"""
    path = cache_dir / f"{date_str}.json"
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data.get("news"), list) and data["news"]:
            return data
    except (OSError, json.JSONDecodeError):
        return None
    return None


def _nearest_cached(cache_dir: Path, now: datetime) -> tuple[str, dict] | None:
    """网络全部失败时，取缓存目录中日期最近的其它日期文件。"""
    best: tuple[int, str, dict] | None = None
    for path in cache_dir.glob("*.json"):
        date_str = path.stem
        try:
            date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            continue
        data = _load_cache(cache_dir, date_str)
        if data is None:
            continue
        key = (abs((date - now.date()).days), date_str)
        if best is None or key < (best[0], best[1]):
            best = (key[0], date_str, data)
    return (best[1], best[2]) if best else None


def _day_of_week(date_str: str) -> str:
    date = datetime.strptime(date_str, "%Y-%m-%d")
    # _WEEK_DAYS 采用 JS getDay() 约定（索引 0=周日），isoweekday % 7 与之对齐
    return f"星期{_WEEK_DAYS[date.isoweekday() % 7]}"


def _build_result(data: dict, date_str: str, now: datetime) -> dict:
    """组装响应：原字段 + day_of_week / lunar_date / api_updated / api_updated_at。"""
    result = dict(data)
    result["date"] = date_str
    result["news"] = [_normalize_news(item) for item in result["news"]]
    result["day_of_week"] = _day_of_week(date_str)
    year, month, day = (int(part) for part in date_str.split("-"))
    result["lunar_date"] = (
        Solar.fromYmd(year, month, day).getLunar().toString().replace("农历", "")
    )
    result["api_updated"] = now.strftime("%Y-%m-%d %H:%M:%S")
    result["api_updated_at"] = int(now.timestamp() * 1000)
    return result


def _iter_dates(requested: str | None, now: datetime) -> list[str]:
    """日期链：[请求日期或今天, 昨天, 前天]（服务器本地日期）。"""
    base = datetime.strptime(requested, "%Y-%m-%d") if requested else now
    return [(base - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(3)]


def get_daily_news(
    date: str | None = None,
    force_update: bool = False,
    cache_dir: Path | None = None,
    now: datetime | None = None,
) -> dict | None:
    """获取 60s 每日新闻，网络与缓存全部不可用时返回 None（由端点转 502）。

    - 日期链：[请求日期或今天, 昨天, 前天]，逐个尝试
    - 每个日期：命中磁盘缓存（且非 force_update）直接返回；否则按镜像顺序拉取，
      成功即写缓存并返回
    - 网络全部失败：回退到缓存目录中日期最近的其它文件
    """
    now = now or datetime.now()
    cache_dir = cache_dir or get_default_cache_dir()

    for date_str in _iter_dates(date, now):
        if not force_update:
            cached = _load_cache(cache_dir, date_str)
            if cached is not None:
                return _build_result(cached, date_str, now)

        raw = _fetch_from_mirrors(date_str)
        if raw is not None:
            _atomic_write(cache_dir, date_str, raw)
            return _build_result(raw, date_str, now)

    fallback = _nearest_cached(cache_dir, now)
    if fallback is not None:
        date_str, data = fallback
        return _build_result(data, date_str, now)
    return None


def fetch_image(date_str: str) -> bytes | None:
    """按镜像顺序尝试拉取某日期图片，首个成功且校验通过即返回。"""
    for template in _IMAGE_MIRROR_TEMPLATES:
        url = template.format(date=date_str)
        try:
            request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(request, timeout=_REQUEST_TIMEOUT) as response:  # noqa: S310
                if response.status != 200:
                    logger.warning(
                        "60s 图片镜像 %s 状态码异常: %s", url, response.status
                    )
                    continue
                content_type = response.headers.get("Content-Type", "").lower()
                if content_type and not (
                    "image" in content_type or "octet-stream" in content_type
                ):
                    logger.warning(
                        "60s 图片镜像 %s Content-Type 异常: %s", url, content_type
                    )
                    continue
                data = response.read()
                if not data.startswith(b"\x89PNG"):
                    logger.warning("60s 图片镜像 %s 内容非 PNG (魔数不符)", url)
                    continue
                return data
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            logger.warning("60s 图片镜像 %s 拉取失败: %s", url, exc)
            continue
    return None


def _atomic_write_image(cache_dir: Path, date_str: str, data: bytes) -> None:
    """二进制原子写图片缓存（临时文件 + os.replace）。"""
    try:
        _ensure_cache_dir(cache_dir)
        fd, tmp_path = tempfile.mkstemp(
            dir=cache_dir, prefix=f".{date_str}.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(tmp_path, cache_dir / f"{date_str}.png")
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    except OSError as exc:
        logger.warning("写入 60s 图片缓存 %s 失败: %s", date_str, exc)


def _load_image_cache(cache_dir: Path, date_str: str) -> bytes | None:
    """读取某日期图片缓存，缺失/非法时返回 None。"""
    path = cache_dir / f"{date_str}.png"
    try:
        data = path.read_bytes()
        if data.startswith(b"\x89PNG"):
            return data
    except OSError:
        return None
    return None


def get_daily_image(
    date: str | None = None,
    force_update: bool = False,
    cache_dir: Path | None = None,
    now: datetime | None = None,
) -> tuple[str, bytes] | None:
    """获取 60s 每日新闻图片。

    - 命中磁盘缓存（且非 force_update）直接返回；
    - 否则按镜像顺序拉取，成功即写缓存并返回；
    - 全部失败且无缓存返回 None。
    """
    now = now or datetime.now()
    cache_dir = cache_dir or get_default_cache_dir()
    date_str = date or now.strftime("%Y-%m-%d")

    if not force_update:
        cached = _load_image_cache(cache_dir, date_str)
        if cached is not None:
            return date_str, cached

    raw = fetch_image(date_str)
    if raw is not None:
        _atomic_write_image(cache_dir, date_str, raw)
        return date_str, raw

    return None

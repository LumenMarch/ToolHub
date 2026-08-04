"""zip 压缩包安全解压（atlas-merge 上传处理）。

防护措施：
- zip-slip：拒绝 ``..`` 穿越与绝对路径 entry（含反斜杠变体与盘符路径）
- 总解压字节上限 1GB，超限拒绝并抛出异常（调用方负责清理临时目录）
- 所有 entry 共享同一顶层分量时剥离该顶层（只剥一层），防止用户误选上一级目录；
  单 unit 归档（如 unit-archive/U1/... 整体打包）与多 unit 归档都只剥掉最外层目录，
  保证 unit/run 识别正确（多 unit 场景行为不变）
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

# 解压后总字节上限：1GB。unit-archive 周批数据包实测约 58MB，
# 1GB 上限为正常业务量留出足够余量，同时挡住异常膨胀的压缩包。
MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024

# 盘符路径（Windows 绝对路径），如 "C:/..." 或 "C:\..."
_DRIVE_PATTERN = re.compile(r"^[A-Za-z]:")

_COPY_CHUNK = 1024 * 1024


class ArchiveExtractError(ValueError):
    """上传的 zip 压缩包无法安全解压。"""


def _validate_entry_name(name: str) -> str:
    """校验单个 entry 路径并归一化（反斜杠 → 正斜杠）；非法路径抛 ArchiveExtractError。"""
    if not name:
        raise ArchiveExtractError("压缩包包含空路径 entry")
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or _DRIVE_PATTERN.match(normalized):
        raise ArchiveExtractError(f"压缩包包含绝对路径 entry: {name!r}")
    parts = normalized.split("/")
    if any(part == ".." for part in parts):
        raise ArchiveExtractError(f"压缩包包含非法路径（拒绝 .. 穿越）: {name!r}")
    return normalized


def _strip_common_prefix(names: list[str]) -> list[str]:
    """若所有 entry 共享同一顶层分量则剥离该顶层；否则原样返回。

    取第一个 entry 的第一段作为候选顶层，仅当全部 entry 都以该顶层开头时剥离一层，
    不依赖 commonpath 计算公共前缀深度。多 unit 归档（unit-archive/U1、U2...）剥掉
    unit-archive；单 unit 归档（unit-archive/U1/... 深层前缀）同样只剥 unit-archive，
    避免解压根落到 unit-archive/U1 导致 unit/run 识别错位。
    """
    if not names:
        return names
    first = names[0]
    sep = first.find("/")
    top = first[:sep] if sep != -1 else first
    prefix = top + "/"
    if any(name != top and not name.startswith(prefix) for name in names):
        return names
    stripped: list[str] = []
    for name in names:
        if name == top:
            continue  # 顶层目录 entry 本身（如 "unit-archive/"）
        if name.startswith(prefix):
            stripped.append(name[len(prefix) :])
        else:
            stripped.append("")
    return stripped


def extract_archive_zip(content: bytes, dest_dir: Path) -> Path:
    """把 zip 字节流安全解压到 dest_dir，返回解压根目录（可能已剥离顶层前缀）。

    解压后总字节超 1GB 时抛 ArchiveExtractError，并保证已写出的内容可被调用方清理。
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ArchiveExtractError("上传文件不是有效的 zip 压缩包") from exc

    with archive:
        raw_names = archive.namelist()
        if not raw_names:
            raise ArchiveExtractError("压缩包为空（没有可解压的 entry）")
        safe_names = [_validate_entry_name(n) for n in raw_names]
        stripped_names = _strip_common_prefix(safe_names)

        dest_dir.mkdir(parents=True, exist_ok=True)
        total_bytes = 0
        for raw, dest_rel in zip(raw_names, stripped_names, strict=True):
            # 目录 entry（原始名以 / 结尾）或剥离前缀后落空的 entry 跳过
            if raw.endswith("/") or not dest_rel:
                continue
            target = dest_dir / dest_rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(raw, "r") as src, target.open("wb") as out:
                while chunk := src.read(_COPY_CHUNK):
                    total_bytes += len(chunk)
                    if total_bytes > MAX_UNCOMPRESSED_BYTES:
                        raise ArchiveExtractError(
                            "解压后总大小超过 1GB 上限，已拒绝处理"
                        )
                    out.write(chunk)
    return dest_dir


def extract_archive_zip_file(zip_path: Path, dest_dir: Path) -> Path:
    """从文件读取 zip 并解压（供测试与 CLI 使用）。"""
    return extract_archive_zip(zip_path.read_bytes(), dest_dir)

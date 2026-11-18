"""OPP（CPK charts）数据集解析。

前端原先在 Web Worker 里解析 CSV；现在统一走后端：tus 上传 → Polars 解析 →
按列持久化（Parquet）。保留原 ``lib/csv.ts`` 的格式语义：

- WiPAS 产线格式：header 行含 ``Serial Number|Product|Site``，其后可能有
  ``Upper/Lower Limit``、``Measurement Unit`` 等元数据行；
- 通用 CSV / Excel：首行即表头；
- 空串 / NA / N/A / None / Null 归一为缺失值；
- 至少有一个可解析数值的列才算测试项，其余进入 ``skipped_columns``。
"""

from __future__ import annotations

import csv
import json
import os
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import polars as pl

NA_TOKENS = ["", "na", "n/a", "none", "null"]
NA_TOKEN_SET = frozenset(NA_TOKENS)

# 单数据集记录数上限：按 20 列估算，5M 行约占 900MB 内存/临时文件。
MAX_RECORDS = 5_000_000
# 表头/元数据只可能出现在文件开头，扫描前 N 个物理行足够定位
HEAD_SCAN_ROWS = 500

_HEADER_SN = re.compile(r"Serial\s*Number", re.I)
_HEADER_PRODUCT = re.compile(r"\bProduct\b", re.I)
_HEADER_SITE = re.compile(r"\bSite\b", re.I)
_UNIT_ROW = re.compile(r"Measurement\s*Unit", re.I)
_LOWER_ROW = re.compile(r"Lower\s*Limit", re.I)
_UPPER_ROW = re.compile(r"Upper\s*Limit", re.I)
_META_FIRST = re.compile(
    r"Upper\s*Limit|Lower\s*Limit|Measurement\s*Unit|Display\s*Name|PDCA\s*Priority",
    re.I,
)
_START_TIME = re.compile(r"Start\s*Time", re.I)
_END_TIME = re.compile(r"End\s*Time", re.I)
_STATUS = re.compile(
    r"(?:Test\s*)?Pass\s*/\s*Fail\s*Status|Test\s*Status|^Status$", re.I
)

ExcelSuffix = {".xlsx", ".xls"}
CsvSuffix = {".csv", ".tsv", ".txt"}
# tus 上传 id 只由安全字符组成；拼路径前再校验一次，避免把请求参数直接当文件名
UPLOAD_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


def cache_path(directory: Path, upload_id: str, suffix: str) -> Path:
    """拼接解析缓存路径；非法上传 id 一律拒绝。"""
    if not UPLOAD_ID_RE.fullmatch(upload_id):
        raise OppParseError("非法上传标识")
    return directory / f"{upload_id}.{suffix}"


class OppParseError(ValueError):
    """文件无法按 OPP 数据集语义解析。"""


@dataclass
class OppColumn:
    name: str
    unit: str
    upper: str
    lower: str


@dataclass
class OppDataset:
    """解析结果：元数据 + 每个测试项的数值列（缺失为 NaN）与非空标记。"""

    title: str
    records: int
    columns: list[OppColumn]
    values: list[pl.Series]
    non_empty: list[pl.Series]
    all_columns: list[str]
    skipped_columns: list[str]
    status_pass: pl.Series | None
    has_fail_records: bool
    header_row_index: int
    data_start_row: int
    sn_column: int | None
    start_time_column: int | None
    end_time_column: int | None
    lower_limit_row: int | None
    upper_limit_row: int | None
    unit_row: int | None

    def meta(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "records": self.records,
            "columns": [
                {"name": c.name, "unit": c.unit, "upper": c.upper, "lower": c.lower}
                for c in self.columns
            ],
            "all_columns": self.all_columns,
            "skipped_columns": self.skipped_columns,
            "has_fail_records": self.has_fail_records,
            "header_row_index": self.header_row_index,
            "data_start_row": self.data_start_row,
            "sn_column": self.sn_column,
            "start_time_column": self.start_time_column,
            "end_time_column": self.end_time_column,
            "lower_limit_row": self.lower_limit_row,
            "upper_limit_row": self.upper_limit_row,
            "unit_row": self.unit_row,
        }

    def column_frame(self) -> pl.DataFrame:
        """持久化用的列矩阵：v{i} 为数值（NaN 缺失），f{i} 为非空标记。"""
        data: dict[str, pl.Series] = {}
        for index, (values, filled) in enumerate(
            zip(self.values, self.non_empty, strict=True)
        ):
            data[f"v{index}"] = values
            data[f"f{index}"] = filled
        return pl.DataFrame(data)


def _stringify(value: Any) -> str:
    return "" if value is None else str(value)


def _row_is_blank(row: list[str]) -> bool:
    return not any(cell.strip() for cell in row)


def _read_csv_head(path: Path, suffix: str) -> list[list[str]]:
    """按物理行读取文件头（CSV 用标准库解析，保留引号语义）。"""
    delimiter = "\t" if suffix == ".tsv" else ","
    rows: list[list[str]] = []
    with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
        reader = csv.reader(handle, delimiter=delimiter)
        for row in reader:
            rows.append([cell.strip() for cell in row])
            if len(rows) >= HEAD_SCAN_ROWS:
                break
    return rows


def _read_excel(path: Path) -> pl.DataFrame:
    try:
        return pl.read_excel(path, has_header=False, infer_schema_length=0)
    except Exception as exc:  # noqa: BLE001 - 三方解析异常统一转校验错误
        raise OppParseError(f"无法解析 Excel 文件: {exc}") from exc


def _read_csv_from(path: Path, suffix: str, skip_rows: int) -> pl.DataFrame:
    """从指定物理行开始读 CSV，全部按 Utf8 处理，短行补空、长行截断。"""
    separator = "\t" if suffix == ".tsv" else ","
    try:
        return pl.read_csv(
            path,
            has_header=False,
            infer_schema_length=0,
            separator=separator,
            skip_rows=skip_rows,
            encoding="utf8-lossy",
            truncate_ragged_lines=True,
        )
    except Exception as exc:  # noqa: BLE001
        raise OppParseError(f"无法解析 CSV 文件: {exc}") from exc


def _cell(row: list[str], index: int) -> str:
    return row[index].strip() if index < len(row) and row[index] is not None else ""


def _find_header_row(rows: list[list[str]]) -> int:
    for index, row in enumerate(rows[:20]):
        joined = "|".join(row)
        first = _cell(row, 0)
        if (
            _HEADER_SN.search(joined)
            or _HEADER_PRODUCT.search(joined)
            or _HEADER_SITE.search(joined)
            or first == "Site"
        ):
            return index
    return -1


def _find_unit_row(rows: list[list[str]], header_index: int) -> int:
    end = min(len(rows), header_index + 12)
    for index in range(header_index + 1, end):
        for cell in rows[index][:4]:
            if cell and _UNIT_ROW.search(cell):
                return index
        if any(cell and _UNIT_ROW.search(cell) for cell in rows[index]):
            return index
    return -1


def _find_limit_rows(rows: list[list[str]], header_index: int) -> tuple[int, int]:
    lower = -1
    upper = -1
    end = min(len(rows), header_index + 12)
    for index in range(header_index + 1, end):
        row = rows[index]
        first = _cell(row, 0)
        joined = " ".join(row)
        if _LOWER_ROW.search(first) or _LOWER_ROW.search(joined):
            lower = index
        if _UPPER_ROW.search(first) or _UPPER_ROW.search(joined):
            upper = index
    return lower, upper


def _find_column(header: list[str], pattern: re.Pattern[str]) -> int:
    for index, name in enumerate(header):
        if name and pattern.search(name.strip()):
            return index
    return -1


def _meta_cell(rows: list[list[str]], row_index: int, column_index: int) -> str:
    if row_index < 0:
        return "NA"
    value = _cell(rows[row_index], column_index)
    return value or "NA"


def _locate_layout(rows: list[list[str]]) -> tuple[int, int, int, int, int]:
    """返回 (header, unit, lower, upper, dataStart) 的物理行号。"""
    header_index = _find_header_row(rows)
    if header_index < 0:
        return -1, -1, -1, -1, 1

    unit_row_index = _find_unit_row(rows, header_index)
    lower_row_index, upper_row_index = _find_limit_rows(rows, header_index)
    data_start = header_index + 1
    last_meta = max(unit_row_index, lower_row_index, upper_row_index)
    if last_meta >= header_index:
        for index in range(last_meta + 1, min(len(rows), last_meta + 12)):
            # 首列常常是空的（SN 在第 2 列），不能据此判定为元数据行；
            # 只跳过空行与已知元数据标签行。
            if _row_is_blank(rows[index]) or _META_FIRST.search(_cell(rows[index], 0)):
                continue
            data_start = index
            break
    return header_index, unit_row_index, lower_row_index, upper_row_index, data_start


def parse_file(path: Path, filename: str = "") -> OppDataset:
    """解析上传的 CSV / Excel，返回可直接持久化的数据集。"""
    suffix = Path(filename or path.name).suffix.lower()
    if suffix in ExcelSuffix:
        frame_all = _read_excel(path)
        head = [
            [_stringify(value) for value in row]
            for row in frame_all.slice(0, HEAD_SCAN_ROWS).rows()
        ]
    elif suffix in CsvSuffix:
        head = _read_csv_head(path, suffix)
        frame_all = None
    else:
        raise OppParseError(f"不支持的文件格式: {suffix or '(无扩展名)'}")

    if not head or all(_row_is_blank(row) for row in head):
        raise OppParseError("文件内容为空")

    header_index, unit_row_index, lower_row_index, upper_row_index, data_start = (
        _locate_layout(head)
    )
    header_physical = max(header_index, 0)
    header = head[header_physical] if head else []

    title = ""
    if header_index > 0:
        parts = [cell.strip() for cell in head[header_index - 1] if cell.strip()]
        if parts:
            title = " / ".join(parts[:3])
    if not title:
        title = filename or "未命名数据集"

    if frame_all is None:
        frame = _read_csv_from(path, suffix, skip_rows=header_physical)
        # 第 0 行是我们刚读过的表头，数据从 data_start 相对位置开始
        offset = max(0, data_start - header_physical)
        data = frame.slice(offset)
    else:
        data = frame_all.slice(data_start)

    data = data.filter(
        pl.any_horizontal(
            [
                pl.col(name).cast(pl.Utf8).str.strip_chars() != ""
                for name in data.columns
            ]
        )
    )
    records = data.height
    if records > MAX_RECORDS:
        raise OppParseError(f"数据行数超过上限（{MAX_RECORDS} 行），请拆分后再上传")

    data_columns = list(data.columns)
    all_columns: list[str] = []
    candidates: list[tuple[int, str]] = []
    for index, name in enumerate(header):
        trimmed = (name or "").strip()
        if not trimmed:
            continue
        all_columns.append(trimmed)
        candidates.append((index, trimmed))

    sn_column = _find_column(header, _HEADER_SN)
    start_time_column = _find_column(header, _START_TIME)
    end_time_column = _find_column(header, _END_TIME)
    status_column = _find_column(header, _STATUS)

    def series_at(position: int) -> pl.Series | None:
        if position < 0 or position >= len(data_columns):
            return None
        return data[data_columns[position]].cast(pl.Utf8)

    kept: list[tuple[int, str, pl.Series, pl.Series]] = []
    skipped: list[str] = []
    for position, name in candidates:
        source = series_at(position)
        if source is None:
            skipped.append(name)
            continue
        stripped = source.str.strip_chars()
        lowered = stripped.str.to_lowercase()
        non_empty = (~lowered.is_in(NA_TOKENS)).fill_null(False)
        values = stripped.cast(pl.Float64, strict=False)
        if not bool(values.is_not_null().any()):
            skipped.append(name)
            continue
        kept.append((position, name, values.fill_null(float("nan")), non_empty))

    if not kept:
        raise OppParseError("文件中没有可解析的数值测试项")

    status_row = series_at(status_column)
    status_pass: pl.Series | None = None
    has_fail = False
    if status_row is not None:
        normalized = status_row.str.strip_chars().str.to_uppercase().fill_null("PASS")
        status_pass = ((normalized == "PASS") | (normalized == "")).cast(pl.UInt8)
        has_fail = bool((status_pass == 0).any())

    columns = [
        OppColumn(
            name=name,
            unit=_meta_cell(head, unit_row_index, position),
            upper=_meta_cell(head, upper_row_index, position),
            lower=_meta_cell(head, lower_row_index, position),
        )
        for position, name, _values, _non_empty in kept
    ]

    return OppDataset(
        title=title,
        records=records,
        columns=columns,
        values=[values for _position, _name, values, _non_empty in kept],
        non_empty=[
            non_empty.cast(pl.UInt8) for _position, _name, _values, non_empty in kept
        ],
        all_columns=all_columns,
        skipped_columns=skipped,
        status_pass=status_pass,
        has_fail_records=has_fail,
        header_row_index=header_index,
        data_start_row=data_start,
        sn_column=sn_column if sn_column >= 0 else None,
        start_time_column=start_time_column if start_time_column >= 0 else None,
        end_time_column=end_time_column if end_time_column >= 0 else None,
        lower_limit_row=lower_row_index if lower_row_index >= 0 else None,
        upper_limit_row=upper_row_index if upper_row_index >= 0 else None,
        unit_row=unit_row_index if unit_row_index >= 0 else None,
    )


def write_cache(directory: Path, upload_id: str, dataset: OppDataset) -> None:
    """把列矩阵写为 Parquet、元数据写为 JSON（原子替换，避免读到半个文件）。"""
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    parquet_path = cache_path(directory, upload_id, "parquet")
    meta_path = cache_path(directory, upload_id, "json")
    status_path = cache_path(directory, upload_id, "status")
    tmp_suffix = uuid.uuid4().hex
    tmp_parquet = directory / f".{parquet_path.name}.{tmp_suffix}.tmp"
    tmp_meta = directory / f".{meta_path.name}.{tmp_suffix}.tmp"
    dataset.column_frame().write_parquet(tmp_parquet)
    tmp_meta.write_text(
        json.dumps(dataset.meta(), ensure_ascii=False), encoding="utf-8"
    )
    os.replace(tmp_parquet, parquet_path)
    os.replace(tmp_meta, meta_path)
    if dataset.status_pass is None:
        status_path.unlink(missing_ok=True)
    else:
        tmp_status = directory / f".{status_path.name}.{uuid.uuid4().hex}.tmp"
        tmp_status.write_bytes(dataset.status_pass.to_numpy().astype("u1").tobytes())
        os.replace(tmp_status, status_path)


def read_status(directory: Path, upload_id: str) -> bytes | None:
    """读取状态掩码（1 = 计入 excludeFail 过滤后的样本）。"""
    path = cache_path(directory, upload_id, "status")
    return path.read_bytes() if path.exists() else None


def read_meta(directory: Path, upload_id: str) -> dict[str, Any] | None:
    path = cache_path(directory, upload_id, "json")
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def read_column(
    directory: Path, upload_id: str, index: int
) -> tuple[bytes, bytes] | None:
    """读取一列的 (Float64 小端字节, 非空标记字节)；缺失返回 None。"""
    path = cache_path(directory, upload_id, "parquet")
    if not path.exists():
        return None
    try:
        frame = pl.read_parquet(path, columns=[f"v{index}", f"f{index}"])
    except (OSError, pl.exceptions.PolarsError):
        return None
    values = frame[f"v{index}"].to_numpy().astype("<f8", copy=False)
    flags = frame[f"f{index}"].to_numpy().astype("u1", copy=False)
    return values.tobytes(), flags.tobytes()


def cleanup(directory: Path, max_age_hours: int = 24 * 3) -> int:
    """清掉过期解析缓存（上传本体由 UploadStore 按 TTL 清理）。"""
    if not directory.exists():
        return 0

    cutoff = time.time() - max_age_hours * 3600
    removed = 0
    for path in list(directory.glob("*")):
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            continue
    return removed

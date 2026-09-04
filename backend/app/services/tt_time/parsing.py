"""TT-time dataframe loading."""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

import polars as pl

from app.services.tt_time.models import TtTimeValidationError

_TIME_RE = re.compile(
    r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$"
)


def format_station_number(station_id: str) -> str:
    """将机台名称提取为纯数字格式。"""
    trimmed = str(station_id).strip()
    if not trimmed:
        return ""

    if trimmed.isdigit():
        return str(int(trimmed))

    # 1. 优先按分隔符切分，寻找完全由纯数字组成的独立段
    segments = re.split(r"[_/\\|:,\s]+", trimmed)
    pure_nums = [s for s in segments if s.isdigit()]

    if len(pure_nums) == 1:
        return str(int(pure_nums[0]))

    if len(pure_nums) > 1:
        non_year = [
            s
            for s in pure_nums
            if not (len(s) == 4 and (s.startswith("20") or s.startswith("19")))
        ]
        if non_year:
            return str(int(non_year[-1]))
        return str(int(pure_nums[0]))

    # 2. 匹配 ST/Station 等前缀后紧随的数字
    prefix_m = re.search(
        r"(?:ST|Station|Unit|Pos|Slot|#|No|机台)[-_ ]*(\d+)", trimmed, re.I
    )
    if prefix_m:
        return str(int(prefix_m.group(1)))

    # 3. 独立单词数字
    word_m = re.search(r"\b(\d+)\b", trimmed)
    if word_m:
        return str(int(word_m.group(1)))

    # 4. 兜底匹配数字
    all_nums = re.findall(r"\d+", trimmed)
    if all_nums:
        return str(int(all_nums[-1]))

    return trimmed


def _parse_timestamp_fast(val: Any) -> float | None:
    """快速将单元格值解析为 Unix 时间戳（秒）。"""
    if val is None:
        return None
    if isinstance(val, (datetime, pl.Datetime)):
        return val.timestamp()
    if isinstance(val, (int, float)):
        if 25569 < val < 100000:
            # Excel 序列号
            return (val - 25569) * 86400
        if val > 1_000_000_000_000:
            return val / 1000.0
        if val > 1_000_000_000:
            return float(val)
        return None

    s = str(val).strip()
    if not s:
        return None
    m = _TIME_RE.match(s)
    if m:
        y, mo, d, h, mi = (
            int(m.group(1)),
            int(m.group(2)),
            int(m.group(3)),
            int(m.group(4)),
            int(m.group(5)),
        )
        sec = int(m.group(6)) if m.group(6) else 0
        ms_str = m.group(7) or ""
        ms = int(ms_str.ljust(3, "0")) if ms_str else 0
        try:
            dt = datetime(y, mo, d, h, mi, sec, ms * 1000)
            return dt.timestamp()
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(s)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def load_tt_dataframe(path: Path, original_filename: str = "") -> pl.DataFrame:
    """加载测试日志文件并提取 Station ID、StartTime、EndTime、status 与测试耗时 tt。"""
    suffix = Path(original_filename or path.name).suffix.lower()

    if suffix in {".xlsx", ".xls"}:
        try:
            raw_df = pl.read_excel(path)
        except Exception as exc:
            raise TtTimeValidationError(
                "无法解析 Excel 文件，请确认文件格式完整"
            ) from exc
    elif suffix in {".csv", ".tsv", ".txt"}:
        try:
            # 探测表头所在行
            with path.open("r", encoding="utf-8", errors="replace") as f:
                lines = [f.readline() for _ in range(30)]
            header_idx = -1
            for idx, line in enumerate(lines):
                if "Station ID" in line:
                    header_idx = idx
                    break
            skip_rows = max(0, header_idx) if header_idx >= 0 else 0
            raw_df = pl.read_csv(
                path,
                skip_rows=skip_rows,
                has_header=True,
                infer_schema_length=1000,
                truncate_ragged_lines=True,
                ignore_errors=True,
            )
        except Exception as exc:
            raise TtTimeValidationError(f"无法解析 CSV 文件: {exc}") from exc
    else:
        raise TtTimeValidationError(f"不支持的文件格式: {suffix or '(无扩展名)'}")

    # 规范化列名
    col_map = {col.strip(): col for col in raw_df.columns}
    station_col = col_map.get("Station ID")
    start_col = col_map.get("StartTime")
    end_col = col_map.get("EndTime")
    status_col = col_map.get("Test Pass/Fail Status")

    if not station_col or not start_col or not end_col:
        raise TtTimeValidationError(
            "数据缺少必要列：需包含 Station ID、StartTime 和 EndTime"
        )

    # 提取有效数据行
    selected_cols = [station_col, start_col, end_col]
    if status_col:
        selected_cols.append(status_col)

    df = raw_df.select(selected_cols).drop_nulls(
        subset=[station_col, start_col, end_col]
    )

    # 向量化计算 StartTime 与 EndTime
    start_series = df[start_col]
    end_series = df[end_col]

    start_ts = [_parse_timestamp_fast(v) for v in start_series]
    end_ts = [_parse_timestamp_fast(v) for v in end_series]

    # 计算 tt (单位：秒)
    tts = [
        (e - s) if (s is not None and e is not None) else None
        for s, e in zip(start_ts, end_ts, strict=False)
    ]

    clean_df = pl.DataFrame(
        {
            "stationId": df[station_col].cast(pl.Utf8).str.strip_chars(),
            "tt": pl.Series(tts, dtype=pl.Float64),
            "status": (
                df[status_col].cast(pl.Utf8).str.strip_chars()
                if status_col
                else pl.lit(None, dtype=pl.Utf8)
            ),
        }
    ).filter(pl.col("tt").is_not_null() & (pl.col("tt") > 0))

    if len(clean_df) == 0:
        raise TtTimeValidationError("未解析到有效的测试耗时数据 (tt > 0)")

    return clean_df

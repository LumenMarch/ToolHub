"""解析单个 unit 的 pivot.csv（主数据），忠实复刻 pivot_to_wide.py 的字段提取规则（移植自 Swift PivotParser.swift）。

pivot.csv 列顺序：
0 slot, 1 testname, 2 subtestname, 3 subsubtestname, 4 unit,
5 lower, 6 higher, 7 timestamp, 8 duration, 9 result, 10 value, 11 failMsg

测量列命名：``<testname>::<subtestname>::<subsubtestname>``（:: 分隔，避免下划线碰撞）；
同名列重复出现时覆盖（取最后一次的 value/limit），列顺序按首次出现。
测量值原样保留，不做转换。
"""

from __future__ import annotations

from pathlib import Path

from app.services.atlas_merge.csv import parse as parse_csv
from app.services.atlas_merge.models import MeasurementItem, PivotData

# 列索引常量，便于阅读与维护
_COL_TESTNAME = 1
_COL_SUBTESTNAME = 2
_COL_SUBSUBTESTNAME = 3
_COL_UNIT = 4
_COL_LOWER = 5
_COL_HIGHER = 6
_COL_TIMESTAMP = 7
_COL_RESULT = 9
_COL_VALUE = 10

# 结果列最少需要的列数（索引 9 可用 → 至少 10 列）。
# 注意：Swift 原版 guard 是 row.count >= 9，对恰好 9 列的行访问 row[9] 会越界崩溃；
# Python 侧用更安全的 len >= 10，对合法输入行为完全一致。
_MIN_COLUMNS = _COL_RESULT + 1


def parse_text(text: str) -> PivotData:
    """解析 pivot.csv 文本。与 parse_url 共享同一套字段提取规则，仅 I/O 入口不同。"""
    rows = parse_csv(text)
    data_rows = rows[1:]  # 跳过表头

    col_order: list[str] = []
    col_data: dict[str, tuple[str, str, str, str]] = {}
    timestamps: list[str] = []
    failing: list[str] = []
    all_pass = True

    for row in data_rows:
        if len(row) < _MIN_COLUMNS:
            continue
        testname = row[_COL_TESTNAME]
        subtestname = row[_COL_SUBTESTNAME]
        subsub = row[_COL_SUBSUBTESTNAME]
        unit = row[_COL_UNIT] if len(row) > _COL_UNIT else ""
        lower = row[_COL_LOWER] if len(row) > _COL_LOWER else ""
        higher = row[_COL_HIGHER] if len(row) > _COL_HIGHER else ""
        timestamp = row[_COL_TIMESTAMP]
        result = row[_COL_RESULT]
        value = row[_COL_VALUE] if len(row) > _COL_VALUE else ""

        # 测量列：同名覆盖取最后，位置保持首次出现
        col_name = f"{testname}::{subtestname}::{subsub}"
        if col_name not in col_data:
            col_order.append(col_name)
        col_data[col_name] = (value, lower, higher, unit)

        if timestamp:
            timestamps.append(timestamp)
        if result and result.upper() != "PASS":
            all_pass = False
            if subsub:
                failing.append(subsub)

    measurements: list[MeasurementItem] = []
    for name in col_order:
        value, lower, higher, unit = col_data[name]
        measurements.append(
            MeasurementItem(
                key=name, value=value, lower=lower, higher=higher, unit=unit
            )
        )

    return PivotData(
        measurements=measurements,
        overallStatus="PASS" if all_pass else "FAIL",
        startTime=min(timestamps) if timestamps else "",
        endTime=max(timestamps) if timestamps else "",
        failingTests=failing,
    )


def parse_url(url: Path) -> PivotData:
    """解析 pivot.csv 文件。无法读取（缺失/解码失败）时返回空 PivotData（状态 ERROR）。"""
    try:
        text = url.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return PivotData(
            measurements=[],
            overallStatus="ERROR",
            startTime="",
            endTime="",
            failingTests=[],
        )
    return parse_text(text)

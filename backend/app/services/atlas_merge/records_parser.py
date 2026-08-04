"""解析单个 unit 的 system/records.csv（替代数据源），输出与 PivotParser 相同的 PivotData（移植自 Swift RecordsParser.swift）。

records.csv 列顺序（17 列）：
0 attributeName, 1 attributeValue, 2 testName, 3 subTestName, 4 subSubTestName,
5 relaxedUpperLimit, 6 upperLimit, 7 measurementValue, 8 lowerLimit,
9 relaxedLowerLimit, 10 measurementUnits, 11 priority, 12 status,
13 failureMessage, 14 startTime, 15 stopTime, 16 timeInterval

与 _pivot.csv 的差异：
- 元数据行（SwName, SwVersion 等）testName 列为空，需过滤
- 数据行无时间戳，需从 time.csv 传入 run 级别起止时间
- 列索引映射不同（见下方列常量）
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from app.services.atlas_merge.csv import parse as parse_csv
from app.services.atlas_merge.models import MeasurementItem, PivotData

# 时间戳格式化固定使用 Asia/Shanghai（FCT 产线所在时区）。
# 原 Swift 实现使用 TimeZone.current（运行机器时区），移植时按业务约定固定时区，
# 保证同一份数据在任何机器上产出完全一致的时间字符串。
_TIMESTAMP_FORMAT = "%Y/%m/%d %H:%M:%S.%f"
_SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")

# records.csv 列索引
_COL_TEST_NAME = 2
_COL_SUB_TEST_NAME = 3
_COL_SUB_SUB_TEST_NAME = 4
_COL_UPPER_LIMIT = 6
_COL_MEASUREMENT_VALUE = 7
_COL_LOWER_LIMIT = 8
_COL_MEASUREMENT_UNITS = 10
_COL_STATUS = 12
_COL_FAILURE_MESSAGE = 13


def _format_timestamp(unix_seconds: str) -> str:
    """Unix 秒时间戳格式化为 pivot.csv 兼容格式（YYYY/MM/DD HH:MM:SS.ffffff）。

    非数值输入原样返回（与 Swift 的 Double() 解析失败回退一致）。
    """
    try:
        secs = float(unix_seconds)
    except ValueError:
        return unix_seconds
    return datetime.fromtimestamp(secs, tz=_SHANGHAI_TZ).strftime(_TIMESTAMP_FORMAT)


def parse_text(text: str, start_time: str, stop_time: str) -> PivotData:
    """解析 records.csv 文本，时间戳由外部传入（从 time.csv 获取）。"""
    rows = parse_csv(text)
    data_rows = rows[1:]  # 跳过表头

    col_order: list[str] = []
    col_data: dict[str, tuple[str, str, str, str]] = {}
    failing: list[str] = []
    all_pass = True

    for row in data_rows:
        # 过滤元数据行：testName 列为空的行（SwName, SwVersion, FixtureID 等）
        if len(row) <= _COL_TEST_NAME or not row[_COL_TEST_NAME]:
            continue
        # 至少需要 status 列（索引 12 可用 → 至少 13 列）
        if len(row) <= _COL_STATUS:
            continue

        testname = row[_COL_TEST_NAME]
        subtestname = row[_COL_SUB_TEST_NAME] if len(row) > _COL_SUB_TEST_NAME else ""
        subsub = (
            row[_COL_SUB_SUB_TEST_NAME] if len(row) > _COL_SUB_SUB_TEST_NAME else ""
        )
        unit = row[_COL_MEASUREMENT_UNITS] if len(row) > _COL_MEASUREMENT_UNITS else ""
        lower = row[_COL_LOWER_LIMIT] if len(row) > _COL_LOWER_LIMIT else ""
        higher = row[_COL_UPPER_LIMIT] if len(row) > _COL_UPPER_LIMIT else ""
        value = row[_COL_MEASUREMENT_VALUE] if len(row) > _COL_MEASUREMENT_VALUE else ""
        result = row[_COL_STATUS]
        fail_msg = row[_COL_FAILURE_MESSAGE] if len(row) > _COL_FAILURE_MESSAGE else ""

        # 测量列：同名覆盖取最后，位置保持首次出现
        col_name = f"{testname}::{subtestname}::{subsub}"
        if col_name not in col_data:
            col_order.append(col_name)
        col_data[col_name] = (value, lower, higher, unit)

        if result and result.upper() != "PASS":
            all_pass = False
            # 优先用 failureMessage，为空时用 subsubtestname
            fail_desc = fail_msg if fail_msg else subsub
            if fail_desc:
                failing.append(fail_desc)

    measurements: list[MeasurementItem] = []
    for name in col_order:
        value, lower, higher, unit = col_data[name]
        measurements.append(
            MeasurementItem(
                key=name, value=value, lower=lower, higher=higher, unit=unit
            )
        )

    # 将 Unix 时间戳转换为 pivot.csv 兼容格式
    formatted_start = _format_timestamp(start_time)
    formatted_stop = _format_timestamp(stop_time)

    return PivotData(
        measurements=measurements,
        overallStatus="PASS" if all_pass else "FAIL",
        startTime=formatted_start,
        endTime=formatted_stop,
        failingTests=failing,
    )


def parse_url(url: Path, start_time: str, stop_time: str) -> PivotData:
    """解析 records.csv 文件。无法读取（缺失/解码失败）时返回空 PivotData（状态 ERROR）。"""
    try:
        text = url.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return PivotData(
            measurements=[],
            overallStatus="ERROR",
            startTime=start_time,
            endTime=stop_time,
            failingTests=[],
        )
    return parse_text(text, start_time, stop_time)

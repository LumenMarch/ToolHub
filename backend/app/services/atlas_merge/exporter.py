"""把 MergedReport 序列化为输出 CSV。

- ``csv_text``：pivot_to_wide.py 兼容的四行范式 CSV（默认格式，移植自
  Swift ReportExporter.swift，结构必须保持字节级稳定）。
  行1 列名 / 行2 Upper Limit / 行3 Lower Limit / 行4 Measurement Unit / 行5+ 数据行。
- ``insight_csv_text``：insight/Export-ID（HILO 标准导出）格式，供
  retest-rate / tt-time 等下游工具直接消费（issue #75）。
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.services.atlas_merge.csv import write as write_csv
from app.services.atlas_merge.models import MergedReport, MetaColumn
from app.services.atlas_merge.records_parser import shanghai_tz

# insight 布局的元数据表头（与 HILO Export-ID 导出逐列对齐，测量列从 12 起）
_INSIGHT_META_HEADERS = [
    "Site",
    "Product",
    "SerialNumber",
    "Special Build Name",
    "Special Build Description",
    "Unit Number",
    "Station ID",
    "Test Pass/Fail Status",
    "StartTime",
    "EndTime",
    "Version",
    "List of Failing Tests",
]
# 元数据列数（= 第一个测量列的索引，站名行的 Parametric 标记落在此列）
_INSIGHT_META_WIDTH = len(_INSIGHT_META_HEADERS)

# 站名行的占位站名：unit-archive 数据不含站点信息，用固定值标识来源
_INSIGHT_STATION = "UNIT_ARCHIVE"
# Station ID 列占位：数据中无机台信息，占位保证 tt-time 按列解析不丢行
_INSIGHT_STATION_ID = "N/A"

# 规格行空值占位（与 HILO 导出一致）
_INSIGHT_NA = "NA"

# 规格行与元数据行的首格标签（insight 格式）
_TAG_DISPLAY_NAME = "Display Name ----->"
_TAG_PDCA = "PDCA Priority ----->"
_TAG_UPPER = "Upper Limit ----->"
_TAG_LOWER = "Lower Limit ----->"
_TAG_UNIT = "Measurement Unit ----->"

# MergedReport.rows 元数据列序（MetaColumn 枚举序）
_ROW_PRODUCT = 0
_ROW_SERIAL = 1
_ROW_RUN_TIME = 3
_ROW_STATUS = 4
_ROW_START = 5
_ROW_END = 6
_ROW_FAILING = 7


def csv_text(report: MergedReport) -> str:
    """生成完整的 CSV 文本（含表头四行与所有数据行）。"""
    rows: list[list[str]] = []

    # 行 1：列名
    rows.append([c.name for c in report.columns])

    # 行 2~4：Limit/Unit。第一列填范式标签，其余列取各自的 higher/lower/unit
    # （元数据列的 higher/lower/unit 本就为空，自然留空，与模版一致）
    upper = [c.higher for c in report.columns]
    if upper:
        upper[0] = "Upper Limited ---->"
    rows.append(upper)

    lower = [c.lower for c in report.columns]
    if lower:
        lower[0] = "Lower Limited ---->"
    rows.append(lower)

    unit = [c.unit for c in report.columns]
    if unit:
        unit[0] = "Measurement Units ---->"
    rows.append(unit)

    # 行 5+：每个 unit 一次 run 一行数据
    rows.extend(report.rows)

    return write_csv(rows)


def insight_csv_text(report: MergedReport) -> str:
    """生成 insight/Export-ID（HILO 标准导出）格式的 CSV 文本。

    布局对齐真实 HILO 导出：行 0 站名行（首个测量列位置标 Parametric）、
    行 1 表头、行 2-3 Display Name/PDCA、行 4-6 Upper/Lower/Unit、行 7+ 数据。
    下游 retest-rate / tt-time 按列名消费，时长（EndTime − StartTime）与
    原始数据保持一致（见 ``_insight_time_pair``）。
    """
    # pivot_to_wide 输出的元数据固定为 MetaColumn 8 列，其后全是测量列
    measurement_columns = report.columns[len(MetaColumn) :]
    headers = list(_INSIGHT_META_HEADERS) + [c.name for c in measurement_columns]

    width = len(headers)

    def blank_row(tag: str) -> list[str]:
        row = [""] * width
        row[0] = tag
        return row

    rows: list[list[str]] = []

    # 行 0：站名行（版本未知留空，首个测量列位置标 Parametric）
    station_row = blank_row(_INSIGHT_STATION)
    if width > _INSIGHT_META_WIDTH:
        station_row[_INSIGHT_META_WIDTH] = "Parametric"
    rows.append(station_row)

    # 行 1：表头
    rows.append(headers)

    # 行 2-3：Display Name / PDCA（源数据无对应信息，仅保留标签行）
    rows.append(blank_row(_TAG_DISPLAY_NAME))
    rows.append(blank_row(_TAG_PDCA))

    # 行 4-6：Upper/Lower/Unit（测量列取各自 limit/unit，空值填 NA）
    upper = blank_row(_TAG_UPPER)
    lower = blank_row(_TAG_LOWER)
    unit = blank_row(_TAG_UNIT)
    for offset, col in enumerate(measurement_columns):
        idx = _INSIGHT_META_WIDTH + offset
        upper[idx] = col.higher.strip() or _INSIGHT_NA
        lower[idx] = col.lower.strip() or _INSIGHT_NA
        unit[idx] = col.unit.strip() or _INSIGHT_NA
    rows.append(upper)
    rows.append(lower)
    rows.append(unit)

    # 行 7+：数据行（元数据 8 列 → insight 12 列映射 + 测量值原样）
    for report_row in report.rows:
        start_out, end_out = _insight_time_pair(
            report_row[_ROW_START], report_row[_ROW_END], report_row[_ROW_RUN_TIME]
        )
        row = [""] * width
        row[2] = report_row[_ROW_SERIAL]
        row[6] = _INSIGHT_STATION_ID
        row[7] = report_row[_ROW_STATUS]
        row[8] = start_out
        row[9] = end_out
        # HILO 原生导出用分号分隔失败项（retest-rate 取分号前首项归因）
        row[11] = report_row[_ROW_FAILING].replace(",", ";")
        for offset, value in enumerate(report_row[8:]):
            row[_INSIGHT_META_WIDTH + offset] = value
        rows.append(row)

    return write_csv(rows)


# ---- 时间转换 ----
#
# 两种数据源的 StartTime/EndTime 形态不同：
# - System 源（records.csv + time.csv）：已经是绝对时间
#   "YYYY/MM/DD HH:MM:SS.ffffff"（Asia/Shanghai），直接格式化为 HILO 的
#   分钟精度；
# - User 源（_pivot.csv）：相对时长 "M:SS.f"。RunTime 列是 time.csv
#   DeviceStartStop 行的 StartTime（Unix 秒，整次测试的起始时刻，权威值），
#   据此构造 Start = RunTime、End = RunTime + (End − Start)。
#   End 为近似值（前提是时长偏移自同一测试起点），但时长本身精确保持。
# 无法解析时原样保留（不丢信息，下游自行容错）。


def _insight_time_pair(
    start_raw: str, end_raw: str, run_time_raw: str
) -> tuple[str, str]:
    """把一对原始时间转换为 insight 格式（分钟精度绝对时间）。"""
    start_abs = _parse_absolute(start_raw)
    end_abs = _parse_absolute(end_raw)
    if start_abs is not None:
        end_text = end_abs.strftime(_INSIGHT_TIME_FORMAT) if end_abs else ""
        return start_abs.strftime(_INSIGHT_TIME_FORMAT), end_text

    epoch = _parse_epoch(run_time_raw)
    if epoch is None:
        return start_raw, end_raw

    duration = _duration_seconds(start_raw, end_raw)
    start_dt = datetime.fromtimestamp(epoch, tz=shanghai_tz())
    end_dt = start_dt + timedelta(seconds=duration)
    return (
        start_dt.strftime(_INSIGHT_TIME_FORMAT),
        end_dt.strftime(_INSIGHT_TIME_FORMAT),
    )


_INSIGHT_TIME_FORMAT = "%Y/%m/%d %H:%M"

_DURATION_FORMATS = ("%M:%S.%f", "%H:%M:%S.%f")
_ABSOLUTE_FORMATS = ("%Y/%m/%d %H:%M:%S.%f", "%Y/%m/%d %H:%M:%S")


def _parse_absolute(raw: str) -> datetime | None:
    for fmt in _ABSOLUTE_FORMATS:
        try:
            return datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue
    return None


def _parse_epoch(raw: str) -> float | None:
    try:
        return float(raw.strip())
    except ValueError:
        return None


def _duration_seconds(start_raw: str, end_raw: str) -> float:
    """两次相对时长之差（秒）；无法解析或为负（回绕）时按 0 处理。"""
    start = _parse_duration(start_raw)
    end = _parse_duration(end_raw)
    if start is None or end is None:
        return 0.0
    return max(end - start, 0.0)


def _parse_duration(raw: str) -> float | None:
    for fmt in _DURATION_FORMATS:
        try:
            parsed = datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue
        return (
            parsed.hour * 3600
            + parsed.minute * 60
            + parsed.second
            + parsed.microsecond / 1_000_000
        )
    return None

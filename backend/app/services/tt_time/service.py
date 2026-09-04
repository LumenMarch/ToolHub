"""TT 时间分析计算服务 — 基于 Polars 高性能多线程数据处理引擎。"""
from __future__ import annotations

from app.services.tt_time.models import (
    CdfPoint,
    HistogramBin,
    OverallStats,
    StationBoxGroup,
    StationComparisonRow,
    StationComparisonTable,
    TailStats,
    TtSummaryResult,
    TtTimeValidationError,
)
from app.services.tt_time.parsing import (
    format_station_number,
    load_tt_dataframe,
)
from app.services.tt_time.summary import calculate_tt_summary

__all__ = [
    "CdfPoint",
    "HistogramBin",
    "OverallStats",
    "StationBoxGroup",
    "StationComparisonRow",
    "StationComparisonTable",
    "TailStats",
    "TtSummaryResult",
    "TtTimeValidationError",
    "calculate_tt_summary",
    "format_station_number",
    "load_tt_dataframe",
]

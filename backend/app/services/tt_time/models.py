"""TT-time dataclasses."""

from __future__ import annotations

from dataclasses import dataclass


class TtTimeValidationError(ValueError):
    """TT 时间分析数据校验错误。"""


@dataclass(frozen=True)
class OverallStats:
    count: int
    min: float
    max: float
    q1: float
    q2: float  # 中位数
    q3: float
    mean: float = 0.0


@dataclass(frozen=True)
class TailStats:
    iqr_threshold: float
    outlier_count: int
    outlier_percent: float


@dataclass(frozen=True)
class HistogramBin:
    label: str
    lo: float
    hi: float
    count: int
    percent: float


@dataclass(frozen=True)
class CdfPoint:
    x: float
    y: float


@dataclass(frozen=True)
class StationBoxGroup:
    station_id: str
    station_numeric: str
    count: int
    min: float
    q1: float
    median: float
    q3: float
    max: float
    iqr: float
    whisker_low: float
    whisker_high: float
    outliers: list[float]


@dataclass(frozen=True)
class StationComparisonRow:
    label: str
    values: dict[str, float]


@dataclass(frozen=True)
class StationComparisonTable:
    stations: list[str]  # 原始 stationId 列表 (已按数字升序排好)
    station_numerics: list[str]  # 纯数字格式列表
    rows: list[StationComparisonRow]


@dataclass(frozen=True)
class TtSummaryResult:
    total_rows: int
    filtered_rows: int
    stations: list[str]
    stats: OverallStats
    bins: list[HistogramBin]
    cdf: list[CdfPoint]
    station_box_groups: list[StationBoxGroup]
    comparison_table: StationComparisonTable
    percentiles: dict[str, float]
    tail: TailStats

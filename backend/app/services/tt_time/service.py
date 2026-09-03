"""TT 时间分析计算服务 — 基于 Polars 高性能多线程数据处理引擎。"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import polars as pl

# 时间正则匹配：YYYY/M/D 或 YYYY-MM-DD，时间部分 H:mm[:ss[.fff]]
_TIME_RE = re.compile(
    r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$"
)


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


def _percentile(sorted_vals: list[float], p: float) -> float:
    """线性插值分位数 (PERCENTILE.INC)。"""
    n = len(sorted_vals)
    if n == 0:
        return 0.0
    if n == 1:
        return sorted_vals[0]
    idx = p * (n - 1)
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return sorted_vals[lo]
    frac = idx - lo
    return sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac


def calculate_tt_summary(
    df: pl.DataFrame,
    bin_width: float = 10.0,
    station_filter: str = "all",
    exclude_fail: bool = True,
) -> TtSummaryResult:
    """根据过滤条件高速计算总体统计、直方图、CDF、各机台五数总结与对比表格。"""
    total_rows = len(df)
    current_df = df

    # 1. 过滤不良品
    if exclude_fail:
        current_df = current_df.filter(
            pl.col("status").is_null()
            | (pl.col("status").str.to_uppercase() == "PASS")
            | (pl.col("status") == "")
        )

    # 2. 机台列表 (按纯数字升序排序)
    unique_stations = current_df["stationId"].unique().to_list()

    def _station_sort_key(s: str) -> tuple[int, int | str]:
        num_str = format_station_number(s)
        if num_str.isdigit():
            return (0, int(num_str))
        return (1, s)

    unique_stations.sort(key=_station_sort_key)

    # 3. 按机台筛选
    if station_filter != "all":
        current_df = current_df.filter(pl.col("stationId") == station_filter)

    filtered_rows = len(current_df)
    if filtered_rows == 0:
        # 空数据兜底
        return TtSummaryResult(
            total_rows=total_rows,
            filtered_rows=0,
            stations=unique_stations,
            stats=OverallStats(0, 0, 0, 0, 0, 0),
            bins=[],
            cdf=[],
            station_box_groups=[],
            comparison_table=StationComparisonTable([], [], []),
        )

    # 4. 总体统计
    all_tts = current_df["tt"].to_list()
    all_tts.sort()

    min_v = round(all_tts[0], 1)
    max_v = round(all_tts[-1], 1)
    q1_v = round(_percentile(all_tts, 0.25), 1)
    q2_v = round(_percentile(all_tts, 0.5), 1)
    q3_v = round(_percentile(all_tts, 0.75), 1)

    overall_stats = OverallStats(
        count=filtered_rows,
        min=min_v,
        max=max_v,
        q1=q1_v,
        q2=q2_v,
        q3=q3_v,
    )

    # 5. 分箱统计
    bw = max(1.0, bin_width)
    lo0 = math.floor(min_v / bw) * bw
    hiN = math.ceil(max_v / bw) * bw
    bin_count = max(1, math.ceil((hiN - lo0) / bw))

    histogram_bins: list[HistogramBin] = []
    for i in range(bin_count):
        b_lo = lo0 + i * bw
        b_hi = b_lo + bw
        if i == bin_count - 1:
            cnt = sum(1 for t in all_tts if b_lo <= t <= b_hi)
        else:
            cnt = sum(1 for t in all_tts if b_lo <= t < b_hi)
        pct = (cnt / filtered_rows) * 100.0 if filtered_rows > 0 else 0.0
        label = f"{int(b_lo)}S" if bw == 1 else f"{int(b_lo)}–{int(b_hi)} S"
        histogram_bins.append(
            HistogramBin(
                label=label,
                lo=b_lo,
                hi=b_hi,
                count=cnt,
                percent=round(pct, 1),
            )
        )

    cdf_points: list[CdfPoint] = []
    cdf_points.append(CdfPoint(x=min_v, y=0.0))

    # 均匀采样 200 个百分位点 (从 0.5% 到 99.5%)
    num_samples = min(200, max(20, filtered_rows))
    for i in range(1, num_samples):
        p = i / num_samples
        t_at_p = round(_percentile(all_tts, p), 2)
        pct_val = round(p * 100.0, 1)
        if cdf_points and cdf_points[-1].x == t_at_p:
            cdf_points[-1] = CdfPoint(x=t_at_p, y=pct_val)
        else:
            cdf_points.append(CdfPoint(x=t_at_p, y=pct_val))

    # 终止点：100%
    if cdf_points and cdf_points[-1].x == max_v:
        cdf_points[-1] = CdfPoint(x=max_v, y=100.0)
    else:
        cdf_points.append(CdfPoint(x=max_v, y=100.0))

    # 7. 各机台箱线图指标与五数表格
    station_groups_map: dict[str, list[float]] = {}
    for row in df.iter_rows(named=True):
        if exclude_fail and row["status"]:
            s_up = str(row["status"]).upper()
            if s_up != "PASS":
                continue
        st_id = row["stationId"]
        station_groups_map.setdefault(st_id, []).append(row["tt"])

    station_box_groups: list[StationBoxGroup] = []
    max_row_vals: dict[str, float] = {}
    q3_row_vals: dict[str, float] = {}
    med_row_vals: dict[str, float] = {}
    q1_row_vals: dict[str, float] = {}
    min_row_vals: dict[str, float] = {}
    station_numerics: list[str] = []

    for st in unique_stations:
        st_tts = station_groups_map.get(st, [])
        if not st_tts:
            continue
        st_tts.sort()
        n_st = len(st_tts)
        st_min = round(st_tts[0], 1)
        st_max = round(st_tts[-1], 1)
        st_q1 = round(_percentile(st_tts, 0.25), 1)
        st_med = round(_percentile(st_tts, 0.5), 1)
        st_q3 = round(_percentile(st_tts, 0.75), 1)
        st_iqr = round(st_q3 - st_q1, 1)

        f_low = st_q1 - 1.5 * st_iqr
        f_high = st_q3 + 1.5 * st_iqr
        inliers = [v for v in st_tts if f_low <= v <= f_high]
        w_low = inliers[0] if inliers else st_min
        w_high = inliers[-1] if inliers else st_max
        outliers = [round(v, 1) for v in st_tts if v < f_low or v > f_high]

        st_num = format_station_number(st)
        station_numerics.append(st_num)

        station_box_groups.append(
            StationBoxGroup(
                station_id=st,
                station_numeric=st_num,
                count=n_st,
                min=st_min,
                q1=st_q1,
                median=st_med,
                q3=st_q3,
                max=st_max,
                iqr=st_iqr,
                whisker_low=round(w_low, 1),
                whisker_high=round(w_high, 1),
                outliers=outliers[:100],  # 限制离群点数，避免前端渲染过载
            )
        )

        max_row_vals[st] = st_max
        q3_row_vals[st] = st_q3
        med_row_vals[st] = st_med
        q1_row_vals[st] = st_q1
        min_row_vals[st] = st_min

    comparison_table = StationComparisonTable(
        stations=unique_stations,
        station_numerics=station_numerics,
        rows=[
            StationComparisonRow(label="最大值", values=max_row_vals),
            StationComparisonRow(label="Q3", values=q3_row_vals),
            StationComparisonRow(label="Med", values=med_row_vals),
            StationComparisonRow(label="Q1", values=q1_row_vals),
            StationComparisonRow(label="最小值", values=min_row_vals),
        ],
    )

    return TtSummaryResult(
        total_rows=total_rows,
        filtered_rows=filtered_rows,
        stations=unique_stations,
        stats=overall_stats,
        bins=histogram_bins,
        cdf=cdf_points,
        station_box_groups=station_box_groups,
        comparison_table=comparison_table,
    )

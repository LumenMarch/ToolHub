"""TT-time summary statistics (mean / percentiles / Tukey tail)."""

from __future__ import annotations

import math

import polars as pl

from app.services.tt_time.models import (
    CdfPoint,
    HistogramBin,
    OverallStats,
    StationBoxGroup,
    StationComparisonRow,
    StationComparisonTable,
    TailStats,
    TtSummaryResult,
)
from app.services.tt_time.parsing import format_station_number


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
            stats=OverallStats(0, 0, 0, 0, 0, 0, 0),
            bins=[],
            cdf=[],
            station_box_groups=[],
            comparison_table=StationComparisonTable([], [], []),
            percentiles={"p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0},
            tail=TailStats(iqr_threshold=0.0, outlier_count=0, outlier_percent=0.0),
        )

    # 4. 总体统计
    all_tts = current_df["tt"].to_list()
    all_tts.sort()

    min_v = round(all_tts[0], 1)
    max_v = round(all_tts[-1], 1)
    q1_v = round(_percentile(all_tts, 0.25), 1)
    q2_v = round(_percentile(all_tts, 0.5), 1)
    q3_v = round(_percentile(all_tts, 0.75), 1)
    mean_v = round(sum(all_tts) / filtered_rows, 3)

    percentiles = {
        "p50": round(_percentile(all_tts, 0.5), 1),
        "p90": round(_percentile(all_tts, 0.9), 1),
        "p95": round(_percentile(all_tts, 0.95), 1),
        "p99": round(_percentile(all_tts, 0.99), 1),
    }

    # Tukey 上尾：Q3 + 1.5×IQR
    iqr_v = q3_v - q1_v
    iqr_threshold = round(q3_v + 1.5 * iqr_v, 1)
    outlier_count = sum(1 for t in all_tts if t > iqr_threshold)
    outlier_percent = (
        round((outlier_count / filtered_rows) * 100.0, 1) if filtered_rows else 0.0
    )
    tail = TailStats(
        iqr_threshold=iqr_threshold,
        outlier_count=outlier_count,
        outlier_percent=outlier_percent,
    )

    overall_stats = OverallStats(
        count=filtered_rows,
        min=min_v,
        max=max_v,
        q1=q1_v,
        q2=q2_v,
        q3=q3_v,
        mean=mean_v,
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
        percentiles=percentiles,
        tail=tail,
    )

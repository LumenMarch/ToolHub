from __future__ import annotations

from pathlib import Path

from app.services.tt_time.service import (
    calculate_tt_summary,
    format_station_number,
    load_tt_dataframe,
)


def test_format_station_number():
    assert format_station_number("FLDG_FQ3-4FT-01B_15_HILO1") == "15"
    assert format_station_number("FLDG_FQ3-4FT-01B_02_HILO1") == "2"
    assert format_station_number("ST01") == "1"
    assert format_station_number("Station-48") == "48"
    assert format_station_number("15") == "15"


def test_load_and_calculate_csv(tmp_path: Path):
    csv_content = """Title,Product,Site
Station ID,StartTime,EndTime,Test Pass/Fail Status
FLDG_FQ3-4FT-01B_15_HILO1,2024-05-01 10:00:00,2024-05-01 10:00:20,PASS
FLDG_FQ3-4FT-01B_15_HILO1,2024-05-01 10:00:00,2024-05-01 10:00:30,PASS
FLDG_FQ3-4FT-01B_2_HILO1,2024-05-01 10:00:00,2024-05-01 10:00:10,PASS
FLDG_FQ3-4FT-01B_2_HILO1,2024-05-01 10:00:00,2024-05-01 10:00:50,FAIL
"""
    file_path = tmp_path / "test.csv"
    file_path.write_text(csv_content, encoding="utf-8")

    df = load_tt_dataframe(file_path, "test.csv")
    assert len(df) == 4
    assert "tt" in df.columns
    assert "stationId" in df.columns

    # 1. 过滤不良品 (exclude_fail=True)
    summary = calculate_tt_summary(
        df,
        bin_width=10.0,
        station_filter="all",
        exclude_fail=True,
    )

    assert summary.filtered_rows == 3
    assert len(summary.station_box_groups) == 2
    # 机台顺序必须是 2 在前，15 在后 (数值升序)
    assert summary.station_box_groups[0].station_numeric == "2"
    assert summary.station_box_groups[1].station_numeric == "15"

    # 验证机台 15 的耗时: [20, 30] -> median=25, q1=22.5, q3=27.5
    st15 = summary.station_box_groups[1]
    assert st15.min == 20.0
    assert st15.max == 30.0

    # 真实 all_tts=[10,20,30]：mean / percentiles / Tukey 上尾
    assert summary.stats.mean == 20.0
    assert summary.percentiles["p50"] == 20.0
    assert summary.percentiles["p90"] == 28.0
    assert summary.percentiles["p95"] == 29.0
    assert summary.percentiles["p99"] == 29.8
    # Q1=15, Q3=25, IQR=10 → threshold=40；无样本超过阈值
    assert summary.tail.iqr_threshold == 40.0
    assert summary.tail.outlier_count == 0
    assert summary.tail.outlier_percent == 0.0

    # 2. 不过滤不良品 (exclude_fail=False)
    summary_all = calculate_tt_summary(
        df,
        bin_width=10.0,
        station_filter="all",
        exclude_fail=False,
    )
    assert summary_all.filtered_rows == 4

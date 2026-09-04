"""atlas-merge insight/Export-ID 导出器测试（issue #75）。

覆盖：
- insight 布局（站名行 / 表头 / Display/PDCA / Upper/Lower/Unit / 数据行）；
- 时间转换：System 源绝对时间格式化为分钟精度；User 源 M:SS.f 时长用
  RunTime（time.csv DeviceStartStop StartTime，测试起始 Unix 秒）构造，
  时长精确保持；
- 失败项分隔符逗号 → 分号（对齐 HILO 原生导出与 retest-rate 归因口径）；
- 默认 pivot_to_wide 输出（csv_text）结构回归；
- 端到端：insight 输出被 retest-rate 直接分析、时间串满足 tt-time 解析格式。
"""

from __future__ import annotations

import csv
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.atlas_merge.exporter import csv_text, insight_csv_text
from app.services.atlas_merge.merge_engine import meta_columns
from app.services.atlas_merge.models import ColumnDef, MergedReport
from app.services.retest_rate.service import analyze_files

# 与 frontend tt-time lib.ts TIME_RE 等价的校验（YYYY/M/D H:MM[:SS]）
_TT_TIME_RE = re.compile(
    r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(:\d{2}(\.\d{1,3})?)?$"
)

_EPOCH = "1780100265.924378"


def _report(rows: list[list[str]]) -> MergedReport:
    columns = meta_columns() + [
        ColumnDef(name="Voltage", lower="0.5", higher="10", unit="V"),
        ColumnDef(name="Current", lower="1", higher="20", unit="A"),
    ]
    return MergedReport(
        columns=columns,
        rows=rows,
        parseErrors=[],
        dataSource="user",
        availableDataSources={"user"},
    )


def _sample_rows() -> list[list[str]]:
    return [
        # System 源：绝对时间（records_parser 产出格式，带微秒）
        [
            "",
            "SN001",
            "1",
            _EPOCH,
            "PASS",
            "2026/05/30 17:45:54.924378",
            "2026/05/30 17:52:18.324378",
            "",
            "5.0",
            "2.0",
        ],
        # User 源：M:SS.f 相对时长 + RunTime（起始 Unix 秒）
        ["", "SN002", "1", _EPOCH, "PASS", "17:45.9", "24:49.3", "", "4.9", "2.1"],
        # FAIL 行：失败项逗号连接（pivot_to_wide 元数据口径），首项为测量列名
        [
            "",
            "SN003",
            "1",
            _EPOCH,
            "FAIL",
            "5:00.0",
            "9:30.0",
            "Current,OverVoltage",
            "N/A",
            "0.8",
        ],
    ]


def _grid(text: str) -> list[list[str]]:
    return list(csv.reader(text.splitlines()))


def test_insight_layout_rows():
    grid = _grid(insight_csv_text(_report(_sample_rows())))

    assert grid[0][0] == "UNIT_ARCHIVE"
    assert grid[0][12] == "Parametric"

    assert grid[1][:12] == [
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
    assert grid[1][12:] == ["Voltage", "Current"]

    assert grid[2][0] == "Display Name ----->"
    assert grid[3][0] == "PDCA Priority ----->"
    assert grid[4][0] == "Upper Limit ----->"
    assert grid[4][12:] == ["10", "20"]
    assert grid[5][0] == "Lower Limit ----->"
    assert grid[5][12:] == ["0.5", "1"]
    assert grid[6][0] == "Measurement Unit ----->"
    assert grid[6][12:] == ["V", "A"]

    assert len(grid) == 10  # 7 行头 + 3 数据行


def test_insight_system_source_time_formatted_to_minutes():
    grid = _grid(insight_csv_text(_report(_sample_rows())))
    row = grid[7]
    assert row[2] == "SN001"
    assert row[6] == "N/A"
    assert row[7] == "PASS"
    assert row[8] == "2026/05/30 17:45"
    assert row[9] == "2026/05/30 17:52"


def test_insight_user_source_duration_preserved():
    grid = _grid(insight_csv_text(_report(_sample_rows())))
    row = grid[8]
    start_dt = datetime.fromtimestamp(float(_EPOCH), tz=ZoneInfo("Asia/Shanghai"))
    assert row[8] == start_dt.strftime("%Y/%m/%d %H:%M")

    # End = Start + (24:49.3 − 17:45.9) = Start + 423.4s：构造精确保持时长，
    # 字符串为分钟精度（与 HILO 原生导出一致，截断到分钟）
    end_dt = start_dt + timedelta(seconds=423.4)
    assert row[9] == end_dt.strftime("%Y/%m/%d %H:%M")


def test_insight_failing_tests_use_semicolon():
    grid = _grid(insight_csv_text(_report(_sample_rows())))
    assert grid[9][11] == "Current;OverVoltage"


def test_default_csv_text_layout_unchanged():
    """默认 pivot_to_wide 导出必须保持既有四行范式结构。"""
    text = csv_text(_report(_sample_rows()))
    grid = _grid(text)
    assert grid[0][:8] == [
        "Product",
        "SerialNumber",
        "RunIndex",
        "RunTime",
        "Test Pass/Fail Status",
        "StartTime",
        "EndTime",
        "List of Failing Tests",
    ]
    assert grid[0][8:] == ["Voltage", "Current"]
    assert grid[1][0] == "Upper Limited ---->"
    assert grid[1][8:] == ["10", "20"]
    assert grid[2][0] == "Lower Limited ---->"
    assert grid[3][0] == "Measurement Units ---->"
    assert grid[4][1] == "SN001"
    assert grid[4][5] == "2026/05/30 17:45:54.924378"  # 原始值不转换
    assert len(grid) == 7


def test_retest_rate_consumes_insight_output(tmp_path):
    """端到端：insight 导出无需适配即可被 retest-rate 分析。"""
    path = tmp_path / "insight_export.csv"
    path.write_text(insight_csv_text(_report(_sample_rows())), encoding="utf-8")

    result = analyze_files([path])

    assert result["csv_format"] == "insight"
    assert result["station_info"] == "UNIT_ARCHIVE"
    overview = {row["key"]: row for row in result["overview"]}
    assert overview["ov_input_count"]["value"] == 3
    assert overview["ov_pass_sn"]["value"] == 2
    assert overview["ov_total_fail"]["value"] == 1
    assert overview["ov_retest_rate"]["value"] == 0

    # 时长：分钟精度格式下 17:45→17:52 = 420s（System 行）、User 行同理；
    # FAIL 行不计入
    times = {row["key"]: row for row in result["time_stats"]}
    assert times["tt_total"]["seconds"] == pytest.approx(840.0)
    assert times["tt_min"]["seconds"] == pytest.approx(420.0)
    assert times["tt_max"]["seconds"] == pytest.approx(420.0)

    # 失败归因：retest-rate 取分号前首项；规格按表头动态对齐
    # （List of Failing Tests 之后才是测试项）
    defects = {item["name"]: item for item in result["defect_details"]}
    assert defects["Current"]["spec"] == "1.0-20.0 A"
    assert defects["Current"]["rows"][0]["sn"] == "SN003"
    assert defects["Current"]["rows"][0]["first_fail_value"] == "0.8"


def test_insight_times_match_tt_time_parser():
    """所有输出时间串必须满足 tt-time 前端的 TIME_RE 解析格式。"""
    grid = _grid(insight_csv_text(_report(_sample_rows())))
    for row in grid[7:]:
        for cell in (row[8], row[9]):
            assert _TT_TIME_RE.match(cell), cell

"""重测率统计服务的统计口径与移植保真度测试。

覆盖：
- 四种格式（insight / dcr / atlas / summary）识别与规格解析；
- 重测 / 纯不良集合运算、重测次数分档、P80 时间统计、Station|Slot 归属；
- 明细第二次 FAIL 取第二次 FAIL 记录（修正自原工具误取第二条记录）；
- 元数据行过滤、Summary 列名别名、缺列报错、多文件跨文件汇总、GB18030 回退。
"""

from __future__ import annotations

import csv
import io

import pytest

from app.services.retest_rate.service import (
    RetestRateValidationError,
    analyze_files,
    detect_format,
    parse_spec_limits,
)

# insight 布局：0-10 列为元数据列（List of Failing Tests 在列 10），11+ 为测试项
_INSIGHT_HEADER = (
    "Station,Num,Station ID,Slot ID,SerialNumber,Test Pass/Fail Status,"
    "StartTime,EndTime,Version,Extra,List of Failing Tests,Voltage,Current"
)

_TIME_A = "2026/06/01 10:00:00"


def _insight_csv(station: str, data_rows: list[str]) -> str:
    """构造 insight/Hilo 布局 CSV：站名、表头、规格行、数据行。"""

    def cells(prefix: str, voltage: str = "", current: str = "") -> str:
        row = [""] * 13
        row[0] = prefix
        row[11] = voltage
        row[12] = current
        return ",".join(row)

    lines = [
        f"{station},",
        _INSIGHT_HEADER,
        cells("Display Name"),
        cells("PDCA Priority"),
        cells("Upper Limit", "5.5", "10.0"),
        cells("Lower Limit", "4.5", "1.0"),
        cells("Measurement Unit", "V", "A"),
        *data_rows,
    ]
    return "\n".join(lines) + "\n"


def _row(
    sn: str,
    status: str,
    failing: str = "",
    start: str = _TIME_A,
    end: str = _TIME_A,
    voltage: str = "",
    current: str = "",
    station: str = "S1",
    slot: str = "1",
    version: str = "v1",
) -> str:
    fields = ["x"] * 13
    fields[0] = station
    fields[2] = station
    fields[3] = slot
    fields[4] = sn
    fields[5] = status
    fields[6] = start
    fields[7] = end
    fields[8] = version
    fields[10] = failing
    fields[11] = voltage
    fields[12] = current
    return ",".join(fields)


def _write(tmp_path, name: str, text: str, encoding: str = "utf-8"):
    path = tmp_path / name
    path.write_text(text, encoding=encoding)
    return path


def _overview_map(result: dict) -> dict:
    return {row["key"]: row for row in result["overview"]}


def test_detect_format_all_layouts():
    insight = list(csv.reader(io.StringIO(_insight_csv("FCT", []))))
    assert detect_format(insight) == "insight"

    summary = list(
        csv.reader(
            io.StringIO("Overlay Result,\nSerial Number,Test Pass/Fail Status\n")
        )
    )
    assert detect_format(summary) == "summary"

    atlas = list(csv.reader(io.StringIO("Station_Type,FCT\na,b\n")))
    assert detect_format(atlas) == "atlas"

    dcr = list(csv.reader(io.StringIO("DCR,\nheader,\nx,\nUpper Limit,\n")))
    assert detect_format(dcr) == "dcr"

    assert detect_format(list(csv.reader(io.StringIO("a,b\n1,2\n")))) is None
    assert detect_format([]) is None


def test_parse_spec_limits_insight(tmp_path):
    grid = list(csv.reader(io.StringIO(_insight_csv("FCT", []))))
    spec, columns, fmt = parse_spec_limits(grid, "a.csv")
    assert fmt == "insight"
    assert columns == ["Voltage", "Current"]
    assert spec["Voltage"] == {"lower": 4.5, "upper": 5.5, "unit": "V"}
    assert spec["Current"] == {"lower": 1.0, "upper": 10.0, "unit": "A"}


def test_parse_spec_limits_unrecognized_format():
    grid = list(csv.reader(io.StringIO("a,b\n1,2\n")))
    with pytest.raises(RetestRateValidationError, match="无法识别的文件格式"):
        parse_spec_limits(grid, "a.csv")


def test_analyze_overview_bins_and_time_stats(tmp_path):
    """核心统计口径：投入数、重测率、不良率、分档、PASS-only 时间与 P80。"""
    path = _write(
        tmp_path,
        "a.csv",
        _insight_csv(
            "FCT",
            [
                _row(
                    "SN2",
                    "PASS",
                    start="10:00:00",
                    end="10:01:00",
                    station="S1",
                    slot="2",
                ),
                _row(
                    "SN1",
                    "FAIL",
                    "Voltage",
                    start="10:00:00",
                    end="10:00:50",
                    voltage="4.0",
                ),
                _row("SN1", "PASS", voltage="5.0", start="10:01:00", end="10:01:50"),
                _row("SN3", "FAIL", "Voltage", station="S2", voltage="3.9"),
                _row("SN3", "FAIL", "Voltage", station="S2", voltage="4.1"),
                _row(
                    "SN3",
                    "PASS",
                    station="S2",
                    voltage="5.2",
                    start="10:00:00",
                    end="10:01:10",
                ),
                _row("SN4", "FAIL", "Current", station="S2", current="0.5"),
                _row("SN4", "FAIL", "Current", station="S2", current="0.6"),
                _row("SN4", "FAIL", "Current", station="S2", current="0.7"),
            ],
        ),
    )
    result = analyze_files([path])

    assert result["csv_format"] == "insight"
    assert result["station_info"] == "FCT"
    assert result["total_rows"] == 9

    overview = _overview_map(result)
    assert overview["ov_input_count"]["value"] == 4
    assert overview["ov_pass_sn"]["value"] == 3
    assert overview["ov_pass_sn"]["rate"] == pytest.approx(0.75)
    assert overview["ov_total_fail"]["value"] == 3
    assert overview["ov_retest_rate"]["value"] == 2
    assert overview["ov_retest_rate"]["rate"] == pytest.approx(0.5)
    assert overview["ov_defect_rate"]["value"] == 1
    assert overview["ov_defect_rate"]["rate"] == pytest.approx(0.25)

    # 分档：SN2 首次即 PASS；SN1 重测 1 次；SN3 重测 2 次；无 ≥3 次
    bins = {row["key"]: row for row in result["retest_stats"]}
    assert bins["rs_first_pass"]["count"] == 1
    assert bins["rs_first_pass"]["sn_list"] == []
    assert bins["rs_once"]["count"] == 1
    assert bins["rs_once"]["sn_list"] == ["SN1"]
    assert bins["rs_twice"]["count"] == 1
    assert bins["rs_twice"]["sn_list"] == ["SN3"]
    assert bins["rs_three_plus"]["count"] == 0

    # 时间仅统计 PASS 记录：[50, 60, 70]
    times = {row["key"]: row for row in result["time_stats"]}
    assert times["tt_total"]["seconds"] == pytest.approx(180.0)
    assert times["tt_avg"]["seconds"] == pytest.approx(60.0)
    assert times["tt_median"]["seconds"] == pytest.approx(60.0)
    assert times["tt_p80"]["seconds"] == pytest.approx(70.0)
    assert times["tt_max"]["seconds"] == pytest.approx(70.0)
    assert times["tt_max"]["sn"] == "SN3"
    assert times["tt_min"]["seconds"] == pytest.approx(50.0)
    assert times["tt_min"]["sn"] == "SN1"

    # Station|Slot 按 SN 首条记录归属，按纯不良率降序
    slots = result["station_slot"]
    assert [(s["station_id"], s["slot_id"]) for s in slots] == [
        ("S2", "1"),
        ("S1", "2"),
        ("S1", "1"),
    ]
    assert slots[0]["total_sn"] == 2
    assert slots[0]["retest_rate"] == pytest.approx(0.5)
    assert slots[0]["pure_fail_rate"] == pytest.approx(0.5)


def test_analyze_details_and_second_fail_semantics(tmp_path):
    """明细逐 SN 行；第二次 FAIL 必须取第二次 FAIL 记录（而非第二条记录）。"""
    path_a = _write(
        tmp_path,
        "a.csv",
        _insight_csv(
            "FCT",
            [
                _row(
                    "SN2",
                    "PASS",
                    start="10:00:00",
                    end="10:01:00",
                    station="S1",
                    slot="2",
                ),
                _row("SN1", "FAIL", "Voltage", voltage="4.0"),
                _row("SN1", "PASS", voltage="5.0", start="10:01:00", end="10:01:50"),
                _row("SN3", "FAIL", "Voltage", station="S2", voltage="3.9"),
                _row("SN3", "FAIL", "Voltage", station="S2", voltage="4.1"),
                _row(
                    "SN3",
                    "PASS",
                    station="S2",
                    voltage="5.2",
                    start="10:00:00",
                    end="10:01:10",
                ),
                _row("SN4", "FAIL", "Current", station="S2", current="0.5"),
                _row("SN4", "FAIL", "Current", station="S2", current="0.6"),
                _row("SN4", "FAIL", "Current", station="S2", current="0.7"),
            ],
        ),
    )
    # SN5：FAIL → PASS → FAIL → PASS（重测 3 次）。
    # 第二次 FAIL 值应为 8.0（第二次 FAIL 记录）；原工具会误取第二条记录（PASS 的 5.0）。
    path_b = _write(
        tmp_path,
        "b.csv",
        _insight_csv(
            "FCT2",
            [
                _row(
                    "SN5", "FAIL", "Voltage", station="S1", version="v2", voltage="9.0"
                ),
                _row(
                    "SN5",
                    "PASS",
                    station="S1",
                    version="v2",
                    voltage="5.0",
                    start="10:01:00",
                    end="10:01:30",
                ),
                _row(
                    "SN5", "FAIL", "Voltage", station="S1", version="v2", voltage="8.0"
                ),
                _row(
                    "SN5",
                    "PASS",
                    station="S1",
                    version="v2",
                    voltage="5.1",
                    start="10:02:00",
                    end="10:02:40",
                ),
                _row("SN1", "PASS", station="S1", version="v2", voltage="5.3"),
            ],
        ),
    )
    result = analyze_files([path_a, path_b])

    assert result["file_count"] == 2
    assert result["total_rows"] == 14
    assert result["station_info"] == "FCT\nFCT2"
    assert result["version_info"] == "v1\nv2"
    overview = _overview_map(result)
    assert overview["ov_input_count"]["value"] == 5
    assert overview["ov_retest_rate"]["value"] == 3
    assert overview["ov_defect_rate"]["value"] == 1
    bins = {row["key"]: row for row in result["retest_stats"]}
    assert bins["rs_three_plus"]["sn_list"] == ["SN5"]

    # 重测项目明细
    retests = {item["name"]: item for item in result["retest_details"]}
    voltage = retests["Voltage"]
    assert voltage["count"] == 3
    assert voltage["rate"] == pytest.approx(1.0)
    assert voltage["spec"] == "4.5-5.5 V"
    rows = {row["sn"]: row for row in voltage["rows"]}
    assert rows["SN1"]["first_fail_value"] == "4.0"
    assert rows["SN1"]["second_fail_value"] == "N/A"
    # SN1 在文件 B 中再次 PASS，最终 PASS 值取跨文件合并后的最后一次
    assert rows["SN1"]["pass_value"] == "5.3"
    assert rows["SN3"]["second_fail_value"] == "4.1"
    assert rows["SN3"]["second_fail_station"] == "S2"
    assert rows["SN5"]["first_fail_value"] == "9.0"
    assert rows["SN5"]["second_fail_value"] == "8.0"
    assert rows["SN5"]["pass_value"] == "5.1"

    # 不良项目明细：第一次 FAIL 后按时间取前三次测试值
    defects = {item["name"]: item for item in result["defect_details"]}
    current = defects["Current"]
    assert current["count"] == 1
    assert current["spec"] == "1.0-10.0 A"
    row = current["rows"][0]
    assert row["sn"] == "SN4"
    assert row["first_fail_value"] == "0.5"
    assert row["second_test_value"] == "0.6"
    assert row["third_test_value"] == "0.7"


def test_summary_format_alias_and_station_from_data(tmp_path):
    """Summary 格式：列名别名映射；站名从数据列回退（无首行站名）。"""
    text = (
        "Overlay Result,\n"
        "Serial Number,Test Pass/Fail Status,STATION_ID,"
        "List of Failing Tests,Voltage,Test Start Time,Test Stop Time,Version\n"
        "Upper Limit,,,,5.5,,,\n"
        "Lower Limit,,,,4.5,,,\n"
        "Measurement Unit,,,,V,,,\n"
        "SN001,PASS,S9,,5.0,2026/06/01 10:00:00,2026/06/01 10:01:00,v2\n"
        "SN002,FAIL,S9,,4.0,2026/06/01 10:02:00,2026/06/01 10:03:00,v2\n"
        "SN002,PASS,S9,,5.1,2026/06/01 10:04:00,2026/06/01 10:05:00,v2\n"
    )
    path = _write(tmp_path, "s.csv", text)
    result = analyze_files([path])

    assert result["csv_format"] == "summary"
    assert result["station_info"] == "S9"
    overview = _overview_map(result)
    assert overview["ov_input_count"]["value"] == 2
    assert overview["ov_retest_rate"]["value"] == 1
    assert overview["ov_defect_rate"]["value"] == 0


def test_missing_required_columns_raises(tmp_path):
    text = (
        "FCT,\n"
        "Station,Num,SerialNumber,Test Pass/Fail Status,List of Failing Tests,Version\n"
        "Upper Limit,,,,,\n"
        "Lower Limit,,,,,\n"
        "Measurement Unit,,,,,\n"
        "FCT,1,SN1,PASS,,v1\n"
    )
    path = _write(tmp_path, "bad.csv", text)
    with pytest.raises(RetestRateValidationError, match="缺少必需列"):
        analyze_files([path])


def test_gb18030_encoding_fallback(tmp_path):
    """UTF-8 解码失败时回退 GB18030，中文站名不丢。"""
    path = _write(
        tmp_path,
        "gb.csv",
        _insight_csv("FCT工站", [_row("SN1", "PASS", voltage="5.0")]),
        encoding="gb18030",
    )
    result = analyze_files([path])
    assert result["station_info"] == "FCT工站"
    assert _overview_map(result)["ov_input_count"]["value"] == 1


# ---- unit_archive（atlas-merge 合并导出）格式 ----

_UNIT_ARCHIVE_HEADER = (
    "Product,SerialNumber,RunIndex,RunTime,Test Pass/Fail Status,StartTime,"
    "EndTime,List of Failing Tests,Fixture::Info::Get-Station_Name,"
    "Fixture::Info::Get-Slot_ID,Voltage,Current"
)


def _unit_archive_row(
    sn: str,
    status: str,
    failing: str = "",
    start: str = "1:00.0",
    end: str = "2:00.0",
    station: str = "S1",
    slot: str = "1",
    voltage: str = "",
    current: str = "",
) -> str:
    fields = [""] * 12
    fields[1] = sn
    fields[4] = status
    fields[5] = start
    fields[6] = end
    fields[7] = failing
    fields[8] = station
    fields[9] = slot
    fields[10] = voltage
    fields[11] = current
    return ",".join(fields)


def _unit_archive_csv(data_rows: list[str]) -> str:
    """构造 unit_archive 布局 CSV：行 0 即表头，行 1-3 规格行（带 ----> 后缀）。"""

    def cells(prefix: str, voltage: str = "", current: str = "") -> str:
        row = [""] * 12
        row[0] = prefix
        row[10] = voltage
        row[11] = current
        return ",".join(row)

    lines = [
        _UNIT_ARCHIVE_HEADER,
        cells("Upper Limited ---->", "10", "20"),
        cells("Lower Limited ---->", "0.5", "1"),
        cells("Measurement Units ---->", "V", "A"),
        *data_rows,
    ]
    return "\n".join(lines) + "\n"


def test_detect_format_unit_archive():
    grid = list(csv.reader(io.StringIO(_unit_archive_csv([]))))
    assert detect_format(grid) == "unit_archive"


def test_parse_spec_limits_unit_archive_skips_fixture_columns(tmp_path):
    grid = list(csv.reader(io.StringIO(_unit_archive_csv([]))))
    spec, columns, fmt = parse_spec_limits(grid, "u.csv")
    assert fmt == "unit_archive"
    # Fixture::Info::Get-Station_Name / Get-Slot_ID 不计入测试项
    assert columns == ["Voltage", "Current"]
    assert spec["Voltage"] == {"lower": 0.5, "upper": 10.0, "unit": "V"}
    assert spec["Current"] == {"lower": 1.0, "upper": 20.0, "unit": "A"}


def test_analyze_unit_archive_station_slot_and_duration_time(tmp_path):
    """行 0 表头直接解析；机台/穴位取 Fixture::Info 列；时间串为 M:SS.f 时长。"""
    path = _write(
        tmp_path,
        "u.csv",
        _unit_archive_csv(
            [
                # M:SS.f 时长：1:00.0 → 2:00.0 = 60s；2:30.0 → 4:30.0 = 120s
                _unit_archive_row("SN2", "PASS", start="2:30.0", end="4:30.0"),
                _unit_archive_row("SN1", "FAIL", "Voltage", voltage="4.0"),
                _unit_archive_row("SN1", "PASS", voltage="5.0"),
                _unit_archive_row("SN3", "FAIL", "Current", slot="2", current="0.5"),
                _unit_archive_row("SN3", "FAIL", "Current", slot="2", current="0.6"),
                _unit_archive_row("SN3", "FAIL", "Current", slot="2", current="0.7"),
            ],
        ),
    )
    result = analyze_files([path])

    assert result["csv_format"] == "unit_archive"
    # 站名从数据列回退（Fixture::Info::Get-Station_Name），不能是表头首格 "Product"
    assert result["station_info"] == "S1"
    assert result["version_info"] == "N/A"
    assert result["total_rows"] == 6

    overview = _overview_map(result)
    assert overview["ov_input_count"]["value"] == 3
    assert overview["ov_pass_sn"]["value"] == 2
    assert overview["ov_retest_rate"]["value"] == 1
    assert overview["ov_retest_rate"]["rate"] == pytest.approx(1 / 3)
    assert overview["ov_defect_rate"]["value"] == 1

    # 时间仅统计 PASS（60s、120s）；负时长（回绕）不计入
    times = {row["key"]: row for row in result["time_stats"]}
    assert times["tt_total"]["seconds"] == pytest.approx(180.0)
    assert times["tt_min"]["seconds"] == pytest.approx(60.0)
    assert times["tt_p80"]["seconds"] == pytest.approx(120.0)

    slots = result["station_slot"]
    assert [(s["station_id"], s["slot_id"]) for s in slots] == [
        ("S1", "2"),
        ("S1", "1"),
    ]
    assert slots[1]["total_sn"] == 2

    retests = {item["name"]: item for item in result["retest_details"]}
    assert retests["Voltage"]["spec"] == "0.5-10.0 V"
    assert retests["Voltage"]["rows"][0]["sn"] == "SN1"
    assert retests["Voltage"]["rows"][0]["first_fail_value"] == "4.0"
    defects = {item["name"]: item for item in result["defect_details"]}
    assert defects["Current"]["spec"] == "1.0-20.0 A"
    assert defects["Current"]["rows"][0]["sn"] == "SN3"


def test_unit_archive_negative_duration_excluded(tmp_path):
    """M:SS.f 跨小时回绕产生负时长：不计入时间统计，不影响重测判定。"""
    path = _write(
        tmp_path,
        "u.csv",
        _unit_archive_csv(
            [
                _unit_archive_row("SN1", "PASS", start="58:00.0", end="2:00.0"),
            ],
        ),
    )
    result = analyze_files([path])
    times = {row["key"]: row for row in result["time_stats"]}
    assert times["tt_total"]["seconds"] == 0.0
    assert _overview_map(result)["ov_input_count"]["value"] == 1

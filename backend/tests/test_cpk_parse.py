"""OPP（CPK charts）解析语义回归测试。

覆盖 WiPAS 产线格式（标题行 + 表头 + 单位/上下限 + 数据）、通用 CSV 首行表头、
缺失值归一与“无数值列”判定；这些行为原先由前端 lib/csv.ts 承担。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.cpk_charts.parser import OppParseError, parse_file

WIPAS_CSV = """Line A Report
Product,Serial Number,Voltage,Current,Station ID,Test Pass/Fail Status
Measurement Unit,,V,A,,
Lower Limit,,-1,-0.5,,
Upper Limit,,1,0.5,,
,SN0001,0.10,0.20,10,PASS
,SN0002,0.20,0.30,11,PASS
,SN0003,NA,0.40,12,FAIL
"""

GENERIC_CSV = """Voltage,Current
0.1,0.2
0.2,0.3
0.3,NA
"""


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_wipas_layout(tmp_path: Path) -> None:
    dataset = parse_file(_write(tmp_path, "wipas.csv", WIPAS_CSV), "wipas.csv")

    assert dataset.title == "Line A Report"
    assert dataset.header_row_index == 1
    assert dataset.unit_row == 2
    assert dataset.lower_limit_row == 3
    assert dataset.upper_limit_row == 4
    assert dataset.data_start_row == 5
    assert dataset.records == 3

    # 文本列（Product / Serial Number / Station ID / 状态）不进入测试项
    # 与原前端语义一致：只要该列出现可解析数值就算测试项（Station ID 也是数字列）
    assert [c.name for c in dataset.columns] == ["Voltage", "Current", "Station ID"]
    assert dataset.skipped_columns == [
        "Product",
        "Serial Number",
        "Test Pass/Fail Status",
    ]
    assert dataset.columns[0].unit == "V"
    assert dataset.columns[0].lower == "-1"
    assert dataset.columns[0].upper == "1"

    voltage = dataset.values[0].to_list()
    assert voltage[0] == pytest.approx(0.1)
    assert voltage[1] == pytest.approx(0.2)
    # NA 单元格既没有数值，也按“空”计（与前端 isEmptyValue 一致）
    assert voltage[2] != voltage[2]
    assert dataset.non_empty[0].to_list() == [1, 1, 0]

    assert dataset.status_pass is not None
    assert dataset.status_pass.to_list() == [1, 1, 0]
    assert dataset.has_fail_records is True
    assert dataset.sn_column == 1
    assert dataset.start_time_column is None


def test_generic_csv_first_row_header(tmp_path: Path) -> None:
    dataset = parse_file(_write(tmp_path, "generic.csv", GENERIC_CSV), "generic.csv")

    assert dataset.title == "generic.csv"
    assert dataset.header_row_index == -1
    assert dataset.data_start_row == 1
    assert dataset.records == 3
    assert [c.name for c in dataset.columns] == ["Voltage", "Current"]
    assert dataset.columns[0].upper == "NA"
    # 没有状态列时不做过滤，也不生成掩码
    assert dataset.status_pass is None
    assert dataset.has_fail_records is False
    assert dataset.values[1].to_list()[2] != dataset.values[1].to_list()[2]


def test_rejects_file_without_numeric_columns(tmp_path: Path) -> None:
    text = "Name,Status\nA,PASS\nB,PASS\n"
    with pytest.raises(OppParseError):
        parse_file(_write(tmp_path, "text.csv", text), "text.csv")


def test_parses_xlsx_with_same_layout(tmp_path: Path) -> None:
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    rows = [
        ["Line A Report"],
        ["Product", "Serial Number", "Voltage", "Current", "Test Pass/Fail Status"],
        ["Measurement Unit", "", "V", "A", ""],
        ["Lower Limit", "", "-1", "-0.5", ""],
        ["Upper Limit", "", "1", "0.5", ""],
        ["", "SN0001", 0.1, 0.2, "PASS"],
        ["", "SN0002", 0.2, 0.3, "FAIL"],
    ]
    for row in rows:
        sheet.append(row)
    path = tmp_path / "wipas.xlsx"
    workbook.save(path)

    dataset = parse_file(path, "wipas.xlsx")

    assert dataset.records == 2
    assert [c.name for c in dataset.columns] == ["Voltage", "Current"]
    assert dataset.columns[0].unit == "V"
    assert dataset.status_pass is not None
    assert dataset.status_pass.to_list() == [1, 0]

"""出勤整理装载器的列宽契约回归测试。

保留按 14/20 列读取的布局契约，确保伪造 ``<dimension ref>`` 宽度不会
改变每行数据的列数。行数、工作表数与解压体积不再单独设限，统一由
上传入口的 1 GiB 文件大小上限控制。
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import Any

import pytest
from openpyxl import Workbook

from app.services.attendance import AttendanceService, AttendanceValidationError
from app.services.attendance import service as attendance_service

SHEET_PATH = "xl/worksheets/sheet1.xml"
_DIMENSION = re.compile(r'<dimension ref="[^"]*"\s*/>')

# 第 2 行表头，B..K 共十列；A 列留空（原表为标题列）。
ATTENDANCE_HEADERS = [
    "",
    "编号",
    "姓名",
    "部門代碼",
    "部門名稱",
    "设备分组",
    "设备名称",
    "名单类型",
    "体温",
    "抓拍时间",
    "记录时间",
]


def _attendance_xlsx(rows: int = 3) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "1"
    worksheet.append(["通行記錄"])
    worksheet.append(ATTENDANCE_HEADERS)
    for index in range(rows):
        worksheet.append(
            [
                "",
                "E001",
                "张三",
                "D1",
                "部门",
                "group",
                "门禁1進",
                "",
                "",
                "2026-01-05 08:00:00",
                f"2026-01-05 08:{index % 60:02d}:00",
            ]
        )
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _shift_xlsx() -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = attendance_service.SHIFT_SHEET_NAME
    worksheet.append(["班別明細"])
    header: list[Any] = [""] * attendance_service.SHIFT_COLUMNS
    header[1] = "工號"
    header[13] = "班別"
    header[18] = "中餐（午休）時間"
    header[19] = "晚餐時間"
    worksheet.append(header)
    data: list[Any] = [""] * attendance_service.SHIFT_COLUMNS
    data[1] = "E001"
    data[13] = "常白班"
    data[18] = "12:00-13:00"
    data[19] = "17:30-18:00"
    worksheet.append(data)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _rebuild(content: bytes, replacements: dict[str, bytes]) -> bytes:
    """保留原有 entry，只替换指定条目。"""
    output = io.BytesIO()
    source = zipfile.ZipFile(io.BytesIO(content))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            target.writestr(name, replacements.get(name, source.read(name)))
    return output.getvalue()


def _patch_sheet(content: bytes, mutate) -> bytes:
    """改写第一张工作表的 XML；mutate 必须真实生效，否则夹具本身会失效。"""
    xml = zipfile.ZipFile(io.BytesIO(content)).read(SHEET_PATH).decode()
    patched = mutate(xml)
    assert patched != xml, "夹具未改动工作表 XML"
    return _rebuild(content, {SHEET_PATH: patched.encode()})


def _set_dimension(ref: str):
    def mutate(xml: str) -> str:
        patched, count = _DIMENSION.subn(f'<dimension ref="{ref}"/>', xml)
        assert count == 1
        return patched

    return mutate


def test_normal_workbook_parses():
    _, records = AttendanceService()._load_xlsx_attendance(_attendance_xlsx(rows=3))

    assert len(records) == 3
    assert {len(record.original_data) for record in records} == {
        attendance_service.ATTENDANCE_COLUMNS
    }


def test_retained_row_width_ignores_declared_dimension():
    """伪造 16384 列宽时，保留的行仍受 14 列契约约束。"""
    inflated = _patch_sheet(_attendance_xlsx(rows=3), _set_dimension("A1:XFD5"))

    _, records = AttendanceService()._load_xlsx_attendance(inflated)

    assert len(records) == 3
    assert {len(record.original_data) for record in records} == {14}


def test_corrupt_workbook_is_reported_as_validation_error():
    with pytest.raises(AttendanceValidationError, match="无法读取"):
        AttendanceService()._load_xlsx_attendance(b"not-a-zip-at-all")


def test_shift_loader_bounds_declared_columns():
    """班别装载器同样按 20 列读取，不按声明宽度物化。"""

    def inflate(xml: str) -> str:
        patched, count = _DIMENSION.subn('<dimension ref="A1:XFD3"/>', xml)
        assert count == 1
        return patched

    shift = _patch_sheet(_shift_xlsx(), inflate)

    shifts = AttendanceService()._load_shifts(shift)

    assert shifts["E001"].shift == "常白班"
    assert shifts["E001"].dinner_end == "18:00"

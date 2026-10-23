"""出勤整理装载器的资源边界回归测试。

覆盖三条"几 KB 输入放大成 GB 级内存或小时级 CPU"的路径：
- 解压膨胀（压缩比上千倍）
- 伪造 ``<dimension ref>`` 列宽（每行按声明宽度物化）
- 伪造行号（openpyxl 按缺失行号逐行补齐）

同时锁定正常文件必须继续可用，以及上限以明确错误暴露而不是静默截断。
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


def test_declared_max_row_is_rejected():
    """伪造末行号必须在打开工作簿后被明确拒绝，而不是展开成同量级循环。"""
    forged = _patch_sheet(
        _attendance_xlsx(rows=3),
        _set_dimension("A1:K999999999999"),
    )

    with pytest.raises(AttendanceValidationError, match="超过上限"):
        AttendanceService()._load_xlsx_attendance(forged)


def test_missing_dimension_cannot_stall_iteration():
    """缺少 <dimension> 时 openpyxl 的 max_row 为 None，必须由 max_row 兜底。"""

    def drop_dimension(xml: str) -> str:
        patched, count = _DIMENSION.subn("", xml)
        assert count == 1
        return patched.replace(
            "</sheetData>",
            '<row r="999999999999"><c r="A999999999999"/></row></sheetData>',
        )

    forged = _patch_sheet(_attendance_xlsx(rows=3), drop_dimension)

    _, records = AttendanceService()._load_xlsx_attendance(forged)

    assert len(records) == 3


def test_uncompressed_budget_rejects_compression_bomb(monkeypatch):
    """声明解压总量超限时，在解析任何行之前就拒绝。"""
    monkeypatch.setattr(
        attendance_service, "MAX_WORKBOOK_UNCOMPRESSED_BYTES", 1024 * 1024
    )
    bulky_sheet = (
        b'<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'
        + b"A" * (2 * 1024 * 1024)
        + b"</t></is></c></row></sheetData></worksheet>"
    )
    bomb = _rebuild(_attendance_xlsx(rows=3), {SHEET_PATH: bulky_sheet})

    with pytest.raises(AttendanceValidationError, match="解压后超过"):
        AttendanceService()._load_xlsx_attendance(bomb)


def test_corrupt_workbook_is_reported_as_validation_error():
    with pytest.raises(AttendanceValidationError, match="无法读取"):
        AttendanceService()._load_xlsx_attendance(b"not-a-zip-at-all")


def test_sheet_count_is_bounded(monkeypatch):
    monkeypatch.setattr(attendance_service, "MAX_WORKBOOK_SHEETS", 1)
    workbook = Workbook()
    workbook.active.title = "1"
    workbook.create_sheet("2")
    buffer = io.BytesIO()
    workbook.save(buffer)

    with pytest.raises(AttendanceValidationError, match="个工作表"):
        AttendanceService()._load_xlsx_attendance(buffer.getvalue())


def test_row_limit_rejects_oversized_sheet(monkeypatch):
    monkeypatch.setattr(attendance_service, "MAX_ATTENDANCE_ROWS", 2)

    with pytest.raises(AttendanceValidationError, match="超过上限"):
        AttendanceService()._load_xlsx_attendance(_attendance_xlsx(rows=5))


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


class _FakeSheet:
    def __init__(self, name: str, rows: list[list[Any]]):
        self.name = name
        self._rows = rows
        self.nrows = len(rows)
        self.ncols = max(len(row) for row in rows)

    def row_values(self, rowx: int, start_colx: int = 0, end_colx=None):
        return self._rows[rowx][start_colx:end_colx]


class _FakeWorkbook:
    def __init__(self, sheets: list[_FakeSheet]):
        self._sheets = sheets
        self.datemode = 0
        self.released = False

    def sheet_names(self) -> list[str]:
        return [sheet.name for sheet in self._sheets]

    def sheets(self) -> list[_FakeSheet]:
        return self._sheets

    def release_resources(self) -> None:
        self.released = True


def _xls_rows(count: int) -> list[list[Any]]:
    rows: list[list[Any]] = [["通行記錄"], ATTENDANCE_HEADERS]
    for index in range(count):
        rows.append(
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
    return rows


def test_xls_record_limit_is_enforced(monkeypatch):
    """xls 单文件行数受 BIFF8 限制，但多工作表叠加仍需记录数上限。"""
    monkeypatch.setattr(attendance_service, "MAX_ATTENDANCE_ROWS", 2)
    workbook = _FakeWorkbook([_FakeSheet("PE", _xls_rows(3))])
    monkeypatch.setattr(
        attendance_service.xlrd,
        "open_workbook",
        lambda **kwargs: workbook,
    )

    with pytest.raises(AttendanceValidationError, match="超过上限"):
        AttendanceService()._load_xls_attendance(b"fake")

    assert workbook.released is True


def test_xls_sheet_count_is_bounded(monkeypatch):
    monkeypatch.setattr(attendance_service, "MAX_WORKBOOK_SHEETS", 1)
    workbook = _FakeWorkbook(
        [_FakeSheet("PE", _xls_rows(1)), _FakeSheet("TE", _xls_rows(1))]
    )
    monkeypatch.setattr(
        attendance_service.xlrd,
        "open_workbook",
        lambda **kwargs: workbook,
    )

    with pytest.raises(AttendanceValidationError, match="个工作表"):
        AttendanceService()._load_xls_attendance(b"fake")

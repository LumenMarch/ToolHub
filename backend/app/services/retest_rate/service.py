"""重测率统计服务 — 纯逻辑、不依赖 Web 框架。

移植自 insight 数据重测率统计工具 v1.6（PyQt5 桌面版 CSVProcessor）。
输入为测试工站导出的多份 CSV（自动识别 insight/Hilo、DCR/Moose、Atlas、
Summary、unit_archive 五种格式），以序列号（SN）为单位跨文件汇总：

- 重测 SN = 曾 PASS 且曾 FAIL 的 SN；纯不良 SN = 从未 PASS 的 SN；
- 重测率 = |重测 SN| / 投入数；不良率 = |纯不良 SN| / 投入数；
- 测试时间仅统计 PASS 记录（EndTime − StartTime，秒）；
- Station|Slot 归属按每个 SN 的第一条记录判定；
- FAIL 归因只取 "List of Failing Tests" 分号分隔的第一项。

与原实现的有意差异：

1. 明细"第二次 FAIL 值"取第二次 FAIL 记录（原实现误取按时间排序的第二条
   记录，可能已是 PASS）；
2. 明细按逐 SN 行返回，不再合并为多行字符串；
3. 读取编码 UTF-8 失败时回退 GB18030（原实现仅 UTF-8）；
4. 规格缺失一侧显示 "N/A"（原实现会显示 "None"）；
5. 新增 unit_archive（atlas-merge 合并导出）格式：行 0 即表头，机台/穴位
   取自 Fixture::Info::Get-* 列，时间串为 M:SS.f 相对时长（追加对应解析
   格式），Station ID 空值时按候选列顺序回退（原实现仅 Atlas 回退）；
6. 负测试时间（时长回绕等脏数据）不计入时间统计（原实现照算负值）。

数据布局说明：首行为站名（DCR/Insight）、Station_Type/Overlay 标记行
（Atlas/Summary）或直接是表头（unit_archive），其后可能跟若干规格/元数据
行，均为非标准表格布局。本模块保留格式识别与统计口径，实际数据读取由
``polars_parser`` 按列投影完成。
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from statistics import median

# 格式检测需要预览的行数（Summary 的 Measurement Unit 行最远在第 7 行）
PREVIEW_ROWS = 8

# 数据区之前的元数据行前缀（行首匹配即整行剔除）
_META_PREFIXES = (
    "Display Name",
    "PDCA Priority",
    "Upper Limit",
    "Lower Limit",
    "Measurement Unit",
    "Apple Pass",
)

# Summary 格式列名 → 标准列名
_COLUMN_ALIASES = {
    "Serial Number": "SerialNumber",
    "Test Start Time": "StartTime",
    "Test Stop Time": "EndTime",
    "STATION_ID": "Station ID",
}

REQUIRED_COLUMNS = (
    "Test Pass/Fail Status",
    "SerialNumber",
    "List of Failing Tests",
    "StartTime",
    "EndTime",
)

# 时间字符串解析格式：前 8 种照抄原实现 parse_time（绝对日期/时间），
# 后 2 种为 unit_archive（atlas-merge 合并导出）的相对时长 M:SS.f / H:MM:SS.f
_TIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%Y/%m/%d %H:%M",
    "%Y-%m-%d %H:%M",
    "%H:%M:%S",
    "%H:%M",
    "%I:%M:%S %p",
    "%M:%S.%f",
    "%H:%M:%S.%f",
)

# 机台/穴位列候选（按优先级）：Station ID 为空时依次回退
_STATION_KEYS = (
    "Station ID",
    "Fixture Info Get-Station_Name",
    "Fixture::Info::Get-Station_Name",
)
_SLOT_KEYS = (
    "Slot ID",
    "Fixture Info Get-Slot_ID",
    "Fixture::Info::Get-Slot_ID",
)


class RetestRateValidationError(ValueError):
    """输入数据无法完成重测率统计时抛出的校验错误。"""


def _read_text(path: Path) -> str:
    """读取文件文本：UTF-8 失败回退 GB18030。"""
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("gb18030")


def _cell0(row: list[str], default: str = "") -> str:
    """取行首单元格（空行返回 default，避免下标越界）。"""
    return row[0].strip() if row else default


def detect_format(grid: list[list[str]]) -> str | None:
    """按前 PREVIEW_ROWS 行判定格式：insight / dcr / atlas / summary / unit_archive。"""
    if not grid:
        return None
    first = _cell0(grid[0])
    if first.startswith("Overlay"):
        return "summary"
    if first == "Station_Type":
        return "atlas"
    # unit_archive（atlas-merge 合并导出）：行 0 直接是数据表头
    if all(
        any(col.strip() == required for col in grid[0])
        for required in (
            "SerialNumber",
            "Test Pass/Fail Status",
            "List of Failing Tests",
        )
    ):
        return "unit_archive"
    if any("Upper" in _cell0(grid[i]) for i in range(4, min(6, len(grid)))):
        return "insight"
    if any("Upper" in _cell0(grid[i]) for i in range(2, min(4, len(grid)))):
        return "dcr"
    return None


def _safe_float(value: str) -> float | None:
    """规格行单元格转 float，空值/占位符/非法值返回 None。"""
    text = str(value).strip().upper()
    if text in ("", "NA", "N/A", "NA/N", "N", "NULL"):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _format_spec(spec: dict) -> str:
    """规格展示串："下限-上限 单位"，缺失一侧为 N/A。"""
    lower = spec.get("lower")
    upper = spec.get("upper")
    unit = spec.get("unit", "")
    lower_text = "N/A" if lower is None else str(lower)
    upper_text = "N/A" if upper is None else str(upper)
    return f"{lower_text}-{upper_text} {unit}".rstrip()


def _parse_time(time_str: str) -> datetime | None:
    """解析时间字符串，逐一尝试已知格式，失败返回 None。"""
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(time_str.strip(), fmt)
        except ValueError:
            continue
    return None


def analyze_files(
    file_paths: list[Path],
    log_callback: Callable[[str], None] | None = None,
) -> dict:
    """分析多份测试 CSV，返回重测率统计结果（结构与 schema 对应）。

    解析实现见 ``polars_parser``：按列投影读取，避免把 170+ 列整体
    物化成 Python 字典。
    """
    from app.services.retest_rate.polars_parser import analyze_files as _impl

    return _impl(file_paths, log_callback)


def _time_stats(time_list: list[float]) -> dict:
    """测试时间统计：总和/平均/最大/最小/中位数/80 分位（秒）。

    P80 取排序后下标 int(n * 0.80)，与原实现一致。
    """
    if not time_list:
        return {
            "p80": 0.0,
            "max": 0.0,
            "min": 0.0,
            "avg": 0.0,
            "median": 0.0,
            "total": 0.0,
        }
    ordered = sorted(time_list)
    length = len(ordered)
    return {
        "p80": ordered[int(length * 0.80)],
        "max": ordered[-1],
        "min": ordered[0],
        "avg": sum(ordered) / length,
        "median": median(ordered),
        "total": sum(ordered),
    }


def parse_spec_limits(
    grid: list[list[str]], filename: str
) -> tuple[dict[str, dict], list[str], str]:
    """解析测试项规格（仅对第一个文件调用）。

    返回 (spec_limits, test_columns, csv_format)。spec_limits 形如
    {测试项: {'lower': float|None, 'upper': float|None, 'unit': str}}。
    """
    fmt = detect_format(grid)
    if fmt is None:
        raise RetestRateValidationError(f"{filename}: 无法识别的文件格式")

    def need(idx: int) -> list[str]:
        if len(grid) <= idx or not grid[idx]:
            raise RetestRateValidationError(f"{filename}: 数据行数不足，无法解析规格行")
        return grid[idx]

    def failing_tests_col(headers: list[str], default: int) -> int:
        for i, col in enumerate(headers):
            if "List of Failing Tests" in col:
                return i + 1
        return default

    if fmt == "summary":
        headers = need(1)
        upper_row = need(2)
        lower_row = need(3)
        unit_row = next(
            (
                grid[i]
                for i in range(4, min(8, len(grid)))
                if grid[i] and "Measurement Unit" in grid[i][0]
            ),
            [""] * len(headers),
        )
        start_col = failing_tests_col(headers, default=14)
    elif fmt == "atlas":
        headers = need(1)
        upper_row = need(4)
        lower_row = need(5)
        unit_row = need(6)
        start_col = failing_tests_col(headers, default=12)
    elif fmt == "dcr":
        headers = need(1)
        upper_row = need(2)
        lower_row = need(3)
        unit_row = need(4)
        start_col = failing_tests_col(headers, default=14)
    elif fmt == "unit_archive":
        # 行 0 表头，行 1-3 为 Upper/Lower Limited ----> 与 Measurement Units ---->
        # 规格行；缺失时按空规格处理（规格仅影响明细展示）。
        headers = need(0)
        blank = [""] * len(headers)
        upper_row = grid[1] if len(grid) > 1 else blank
        lower_row = grid[2] if len(grid) > 2 else blank
        unit_row = grid[3] if len(grid) > 3 else blank
        start_col = failing_tests_col(headers, default=8)
    else:  # insight
        headers = need(1)
        upper_row = need(4)
        lower_row = need(5)
        unit_row = need(6)
        # 桌面版原生布局测试项固定从列 11 起；HILO Export-ID 导出的
        # List of Failing Tests 在列 11、测试项从 12 起，按表头动态定位
        start_col = failing_tests_col(headers, default=11)

    entries: list[tuple[str, int]] = []
    for col_idx in range(start_col, len(headers)):
        col = headers[col_idx].strip()
        if not col or col.startswith(("Unnamed", "No Name")):
            continue
        # unit_archive 的 Fixture::Info:: 等非测试项列不参与规格与明细
        if fmt == "unit_archive" and col.startswith("Fixture::"):
            continue
        entries.append((col, col_idx))

    spec_limits: dict[str, dict] = {}
    for col, col_idx in entries:
        spec_limits[col] = {
            "lower": _safe_float(lower_row[col_idx])
            if len(lower_row) > col_idx
            else None,
            "upper": _safe_float(upper_row[col_idx])
            if len(upper_row) > col_idx
            else None,
            "unit": unit_row[col_idx].strip() if len(unit_row) > col_idx else "",
        }
    columns = [col for col, _ in entries]
    return spec_limits, columns, fmt

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
行，均为非标准表格布局，因此使用标准库 csv 而非 polars 解析。
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
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
    """分析多份测试 CSV，返回重测率统计结果（结构与 schema 对应）。"""
    log = log_callback or (lambda _msg: None)

    all_records: list[dict] = []
    sn_records: dict[str, list[dict]] = defaultdict(list)
    pass_sn: set[str] = set()
    fail_sn: set[str] = set()
    # SN → 其第一次 FAIL 时 List of Failing Tests 的第一项
    sn_test_mapping: dict[str, str] = {}
    test_times: list[float] = []
    station_names: set[str] = set()
    versions: set[str] = set()

    spec_limits: dict[str, dict] = {}
    csv_format = "insight"
    total_rows = 0
    total_files = len(file_paths)

    for file_idx, path in enumerate(file_paths):
        log(f"开始分析 {path.name}")
        try:
            text = _read_text(path)
        except (OSError, UnicodeDecodeError) as exc:
            raise RetestRateValidationError(
                f"{path.name}: 文件读取失败（{exc}）"
            ) from exc

        # 仅按第一个文件解析测试项规格
        if file_idx == 0:
            grid = list(csv.reader(io.StringIO(text)))
            spec_limits, _, csv_format = parse_spec_limits(grid, path.name)

        lines = text.splitlines(keepends=True)
        is_atlas_format = bool(lines) and lines[0].strip().startswith("Station_Type,")
        # unit_archive 行 0 是表头而非站名（每文件独立判断，兼容混合格式输入）
        first_fields = next(csv.reader([lines[0]]), []) if lines else []
        is_header_first_row = "SerialNumber" in (c.strip() for c in first_fields)

        # 剔除数据区之前的元数据行（保留首行站名）
        filtered = [lines[0]] if lines else []
        for line in lines[1:]:
            first_field = line.split(",")[0].strip() if line.strip() else ""
            if not any(first_field.startswith(prefix) for prefix in _META_PREFIXES):
                filtered.append(line)
        lines = filtered

        # 站名：DCR/Insight 从首行提取，Atlas/Summary/unit_archive 从数据列回退
        if (
            lines
            and lines[0].strip()
            and not is_atlas_format
            and not is_header_first_row
            and csv_format != "summary"
        ):
            station_names.add(lines[0].split(",")[0].strip())

        # Summary 格式列名标准化（字符串级替换，与原实现一致）
        if len(lines) > 1:
            fields = lines[1].strip().split(",")
            for i, field in enumerate(fields):
                stripped = field.strip()
                if stripped in _COLUMN_ALIASES:
                    fields[i] = _COLUMN_ALIASES[stripped]
            lines[1] = ",".join(fields) + "\n"

        # unit_archive 行 0 即表头；其他格式行 0 为站名行，跳过
        reader = csv.DictReader(lines if is_header_first_row else lines[1:])
        fieldnames = reader.fieldnames or []
        missing = [col for col in REQUIRED_COLUMNS if col not in fieldnames]
        if missing:
            raise RetestRateValidationError(
                f"{path.name}: 缺少必需列：{', '.join(missing)}"
            )

        slot_col = next((col for col in _SLOT_KEYS if col in fieldnames), None)
        if slot_col is None:
            log(f"{path.name}: 未找到 Slot ID 列，穴位统一记为 1")

        file_rows = 0
        for row in reader:
            file_rows += 1
            total_rows += 1

            sn = (row.get("SerialNumber") or "").strip()
            status = (row.get("Test Pass/Fail Status") or "").strip().upper()
            failing_tests = row.get("List of Failing Tests") or ""
            start_time_str = (row.get("StartTime") or "").strip()
            end_time_str = (row.get("EndTime") or "").strip()

            # 机台/穴位：按候选列顺序取第一个非空值（空值依次回退）
            station_id = next(
                (
                    (row.get(key) or "").strip()
                    for key in _STATION_KEYS
                    if key in row and (row.get(key) or "").strip()
                ),
                "",
            )
            slot_id = next(
                (
                    (row.get(key) or "").strip()
                    for key in _SLOT_KEYS
                    if key in row and (row.get(key) or "").strip()
                ),
                "",
            )
            if not station_id:
                station_id = "N/A"
            if not slot_id:
                slot_id = "1"

            # 测试时间：仅统计 PASS 记录；负值（M:SS.f 时长跨小时回绕等）
            # 视为无效不计入
            start_time = _parse_time(start_time_str)
            end_time = _parse_time(end_time_str)
            test_time = None
            if start_time and end_time and status == "PASS":
                seconds = (end_time - start_time).total_seconds()
                if seconds >= 0:
                    test_time = seconds
                    test_times.append(test_time)

            if "Version" in row and row["Version"]:
                versions.add(row["Version"].strip())

            record = {
                "sn": sn,
                "status": status,
                "failing_tests": failing_tests,
                "start_time": start_time_str,
                "test_time": test_time,
                "station_id": station_id,
                "slot_id": slot_id,
                "row_data": row,
            }
            all_records.append(record)
            sn_records[sn].append(record)

            if status == "PASS":
                pass_sn.add(sn)
            elif status == "FAIL":
                fail_sn.add(sn)
                if failing_tests:
                    # 只取分号分隔的第一项
                    test = failing_tests.split(";")[0].strip()
                    if test:
                        sn_test_mapping.setdefault(sn, test)

        log(f"{path.name}: 共 {file_rows} 行")

    log("开始汇总统计")

    # ---- 测试时间统计（仅 PASS 记录）----
    overall_time_stats = _time_stats(test_times)
    max_record, min_record = None, None
    for record in all_records:
        tt = record["test_time"]
        if tt is None:
            continue
        if max_record is None or tt > max_record["test_time"]:
            max_record = record
        if min_record is None or tt < min_record["test_time"]:
            min_record = record

    time_stats = [
        {
            "key": "tt_total",
            "seconds": overall_time_stats["total"],
            "sn": None,
            "status": None,
        },
        {
            "key": "tt_avg",
            "seconds": overall_time_stats["avg"],
            "sn": None,
            "status": None,
        },
        {
            "key": "tt_max",
            "seconds": overall_time_stats["max"],
            "sn": max_record["sn"] if max_record else "N/A",
            "status": max_record["status"] if max_record else "N/A",
        },
        {
            "key": "tt_min",
            "seconds": overall_time_stats["min"],
            "sn": min_record["sn"] if min_record else "N/A",
            "status": min_record["status"] if min_record else "N/A",
        },
        {
            "key": "tt_median",
            "seconds": overall_time_stats["median"],
            "sn": None,
            "status": None,
        },
        {
            "key": "tt_p80",
            "seconds": overall_time_stats["p80"],
            "sn": None,
            "status": None,
        },
    ]

    # ---- 重测次数分档 ----
    retest_stats = {
        "first_pass": set(),
        "retest_once": set(),
        "retest_twice": set(),
        "retest_three_or_more": set(),
    }
    for sn, records in sn_records.items():
        if not records or not any(r["status"] == "PASS" for r in records):
            continue
        if records[0]["status"] == "PASS":
            retest_stats["first_pass"].add(sn)
        else:
            # 重测次数 = 最后一次 PASS 记录的下标（0 基）
            retest_count = max(
                i for i, r in enumerate(records) if r["status"] == "PASS"
            )
            if retest_count == 1:
                retest_stats["retest_once"].add(sn)
            elif retest_count == 2:
                retest_stats["retest_twice"].add(sn)
            elif retest_count >= 3:
                retest_stats["retest_three_or_more"].add(sn)

    # ---- 测试项归类：有 SN 最终 PASS → 重测项目，否则不良项目 ----
    retest_tests: dict[str, set[str]] = defaultdict(set)
    pure_fail_tests: dict[str, set[str]] = defaultdict(set)
    for sn, test in sn_test_mapping.items():
        if sn in pass_sn:
            retest_tests[test].add(sn)
        else:
            pure_fail_tests[test].add(sn)

    # ---- 总体统计 ----
    total_unique_sn = len(pass_sn | fail_sn)
    retest_sn = pass_sn & fail_sn
    pure_fail_sn = fail_sn - pass_sn

    def rate(numerator: int, denominator: int) -> float:
        return numerator / denominator if denominator > 0 else 0.0

    overview = [
        {"key": "ov_file_count", "value": total_files, "rate": None},
        {"key": "ov_total_rows", "value": total_rows, "rate": None},
        {"key": "ov_input_count", "value": total_unique_sn, "rate": None},
        {
            "key": "ov_pass_sn",
            "value": len(pass_sn),
            "rate": rate(len(pass_sn), total_unique_sn),
        },
        {
            "key": "ov_first_pass_rate",
            "value": len(retest_stats["first_pass"]),
            "rate": rate(len(retest_stats["first_pass"]), total_unique_sn),
        },
        {
            "key": "ov_second_pass_rate",
            "value": len(retest_stats["retest_once"]),
            "rate": rate(len(retest_stats["retest_once"]), total_unique_sn),
        },
        {
            "key": "ov_third_pass_rate",
            "value": len(retest_stats["retest_twice"]),
            "rate": rate(len(retest_stats["retest_twice"]), total_unique_sn),
        },
        {
            "key": "ov_three_plus_rate",
            "value": len(retest_stats["retest_three_or_more"]),
            "rate": rate(len(retest_stats["retest_three_or_more"]), total_unique_sn),
        },
        {
            "key": "ov_total_fail",
            "value": len(fail_sn),
            "rate": rate(len(fail_sn), total_unique_sn),
        },
        {
            "key": "ov_retest_rate",
            "value": len(retest_sn),
            "rate": rate(len(retest_sn), total_unique_sn),
        },
        {
            "key": "ov_defect_rate",
            "value": len(pure_fail_sn),
            "rate": rate(len(pure_fail_sn), total_unique_sn),
        },
    ]

    retest_stat_rows = [
        {
            "key": "rs_first_pass",
            "count": len(retest_stats["first_pass"]),
            "rate": rate(len(retest_stats["first_pass"]), total_unique_sn),
            "sn_list": [],
        },
        {
            "key": "rs_once",
            "count": len(retest_stats["retest_once"]),
            "rate": rate(len(retest_stats["retest_once"]), total_unique_sn),
            "sn_list": sorted(retest_stats["retest_once"]),
        },
        {
            "key": "rs_twice",
            "count": len(retest_stats["retest_twice"]),
            "rate": rate(len(retest_stats["retest_twice"]), total_unique_sn),
            "sn_list": sorted(retest_stats["retest_twice"]),
        },
        {
            "key": "rs_three_plus",
            "count": len(retest_stats["retest_three_or_more"]),
            "rate": rate(len(retest_stats["retest_three_or_more"]), total_unique_sn),
            "sn_list": sorted(retest_stats["retest_three_or_more"]),
        },
    ]

    # ---- Station|Slot 分析（按 SN 首条记录归属，按不良率降序）----
    distribution: dict[str, dict] = defaultdict(
        lambda: {"total_sn": set(), "retest_sn": set(), "pure_fail_sn": set()}
    )
    for sn, records in sn_records.items():
        if not records:
            continue
        station_slot = f"{records[0]['station_id']}|{records[0]['slot_id']}"
        dist = distribution[station_slot]
        dist["total_sn"].add(sn)
        if sn in retest_sn:
            dist["retest_sn"].add(sn)
        elif sn in pure_fail_sn:
            dist["pure_fail_sn"].add(sn)

    station_slot_rows = []
    for station_slot, dist in distribution.items():
        station_id, slot_id = station_slot.split("|", 1)
        total_sn_count = len(dist["total_sn"])
        if total_sn_count == 0:
            continue
        station_slot_rows.append(
            {
                "station_id": station_id,
                "slot_id": slot_id,
                "total_sn": total_sn_count,
                "retest_sn": len(dist["retest_sn"]),
                "retest_rate": rate(len(dist["retest_sn"]), total_sn_count),
                "pure_fail_sn": len(dist["pure_fail_sn"]),
                "pure_fail_rate": rate(len(dist["pure_fail_sn"]), total_sn_count),
            }
        )
    station_slot_rows.sort(key=lambda item: item["pure_fail_rate"], reverse=True)

    # ---- Atlas/Summary 格式站名回退：从数据记录提取 ----
    if not station_names:
        for record in all_records:
            station_id = record.get("station_id", "")
            if station_id and station_id != "N/A":
                station_names.add(station_id)

    station_info = "\n".join(sorted(station_names)) if station_names else "N/A"
    version_info = "\n".join(sorted(versions)) if versions else "N/A"

    # ---- 重测项目明细（逐 SN 行）----
    retest_details = []
    total_retest_count = sum(len(sns) for sns in retest_tests.values())
    for test, sns in sorted(
        retest_tests.items(), key=lambda item: len(item[1]), reverse=True
    ):
        rows = []
        for sn in sorted(sns):
            records = sorted(sn_records[sn], key=lambda r: r["start_time"])
            fail_records = [
                r
                for r in records
                if r["status"] == "FAIL" and test in r.get("failing_tests", "")
            ]
            pass_records = [r for r in records if r["status"] == "PASS"]
            if not (fail_records and pass_records):
                continue
            first_fail = fail_records[0]
            # 第二次 FAIL：取第二次 FAIL 记录（修正原实现取 records[1] 的问题）
            second_fail = fail_records[1] if len(fail_records) > 1 else None
            last_pass = pass_records[-1]
            rows.append(
                {
                    "sn": sn,
                    "first_fail_value": str(first_fail["row_data"].get(test, "N/A")),
                    "first_fail_station": first_fail["station_id"],
                    "first_fail_slot": first_fail["slot_id"],
                    "second_fail_value": _row_value(second_fail, test),
                    "second_fail_station": _record_or_na(second_fail, "station_id"),
                    "second_fail_slot": _record_or_na(second_fail, "slot_id"),
                    "pass_value": str(last_pass["row_data"].get(test, "N/A")),
                    "pass_station": last_pass["station_id"],
                    "pass_slot": last_pass["slot_id"],
                }
            )
        retest_details.append(
            {
                "name": test,
                "count": len(sns),
                "rate": rate(len(sns), total_retest_count),
                "spec": _format_spec(spec_limits.get(test, {})),
                "rows": rows,
            }
        )

    # ---- 不良项目明细（第一次 FAIL 后的前三次测试值）----
    defect_details = []
    total_defect_count = sum(len(sns) for sns in pure_fail_tests.values())
    for test, sns in sorted(
        pure_fail_tests.items(), key=lambda item: len(item[1]), reverse=True
    ):
        rows = []
        for sn in sorted(sns):
            records = sorted(sn_records[sn], key=lambda r: r["start_time"])
            fail_records = [
                r
                for r in records
                if r["status"] == "FAIL" and test in r.get("failing_tests", "")
            ]
            if not fail_records:
                continue
            first_fail = fail_records[0]
            first_index = records.index(first_fail)
            # 后续测试按时间顺序取（不论 PASS/FAIL，与原实现一致）
            second_test = (
                records[first_index + 1] if first_index + 1 < len(records) else None
            )
            third_test = (
                records[first_index + 2] if first_index + 2 < len(records) else None
            )
            rows.append(
                {
                    "sn": sn,
                    "first_fail_value": str(first_fail["row_data"].get(test, "N/A")),
                    "first_fail_station": first_fail["station_id"],
                    "first_fail_slot": first_fail["slot_id"],
                    "second_test_value": _row_value(second_test, test),
                    "second_test_station": _record_or_na(second_test, "station_id"),
                    "second_test_slot": _record_or_na(second_test, "slot_id"),
                    "third_test_value": _row_value(third_test, test),
                    "third_test_station": _record_or_na(third_test, "station_id"),
                    "third_test_slot": _record_or_na(third_test, "slot_id"),
                }
            )
        defect_details.append(
            {
                "name": test,
                "count": len(sns),
                "rate": rate(len(sns), total_defect_count),
                "spec": _format_spec(spec_limits.get(test, {})),
                "rows": rows,
            }
        )

    log("分析完成")

    return {
        "csv_format": csv_format,
        "station_info": station_info,
        "version_info": version_info,
        "total_rows": total_rows,
        "file_count": total_files,
        "overview": overview,
        "time_stats": time_stats,
        "retest_stats": retest_stat_rows,
        "station_slot": station_slot_rows,
        "retest_details": retest_details,
        "defect_details": defect_details,
    }


def _row_value(record: dict | None, test: str) -> str:
    """取记录中测试项的原始值，无记录返回 N/A。"""
    if record is None:
        return "N/A"
    return str(record["row_data"].get(test, "N/A"))


def _record_or_na(record: dict | None, field: str) -> str:
    if record is None:
        return "N/A"
    return record[field]


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
        start_col = 11

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

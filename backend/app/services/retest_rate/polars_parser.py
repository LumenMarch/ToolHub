"""重测率统计的 Polars 解析实现。

公开入口仍是 ``app.services.retest_rate.service.analyze_files``。本模块只负责
把非标准 CSV 布局读成投影后的 DataFrame，再复用原统计口径：

- 第一遍只读必需列、机台/穴位/版本列，建立 SN 记录与失败项映射；
- 第二遍只读失败项对应的测量列，把每个 SN 的明细值挂回记录。

这样避免把 170+ 列 × 数十万行整体物化成 Python 字典，内存从 GB 级降到
几百 MB；时间字段仍由 ``_parse_time`` 解释，保持原有格式兼容性。
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import polars as pl

from app.services.retest_rate.service import (
    _COLUMN_ALIASES,
    _META_PREFIXES,
    _SLOT_KEYS,
    _STATION_KEYS,
    REQUIRED_COLUMNS,
    RetestRateValidationError,
    _format_spec,
    _parse_time,
    _read_text,
    _time_stats,
    detect_format,
    parse_spec_limits,
)

_PREFIX_BYTES = 2 * 1024 * 1024
_PREFIX_ROWS = 32


@dataclass(frozen=True)
class _Layout:
    fmt: str
    header_index: int
    header_fields: list[str]
    data_start: int
    station_name: str | None


def _read_prefix_text(path: Path) -> str:
    """读取文件前缀并解码；UTF-8 失败回退 GB18030。"""
    with path.open("rb") as stream:
        raw = stream.read(_PREFIX_BYTES)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gb18030")
    text = text.lstrip("\ufeff")
    if len(raw) == _PREFIX_BYTES and not text.endswith(("\n", "\r")):
        # 前缀在行中间截断时丢掉最后一行，避免把半个单元格当成表头
        text = text.rsplit("\n", 1)[0]
    return text


def _prefix_grid(path: Path) -> list[list[str]]:
    text = _read_prefix_text(path)
    reader = csv.reader(io.StringIO(text))
    grid: list[list[str]] = []
    for _ in range(_PREFIX_ROWS):
        try:
            grid.append(next(reader))
        except StopIteration:
            break
    return grid


def _normalized_row(row: list[str]) -> list[str]:
    return [_COLUMN_ALIASES.get(cell.strip(), cell.strip()) for cell in row]


def _find_header(grid: list[list[str]], filename: str) -> tuple[int, list[str]]:
    """定位包含全部必需列的表头行；找不到时给出缺列信息。"""
    best_fields: list[str] = []
    best_missing = len(REQUIRED_COLUMNS)
    for index, row in enumerate(grid):
        fields = _normalized_row(row)
        missing = [name for name in REQUIRED_COLUMNS if name not in fields]
        if len(missing) < best_missing:
            best_missing = len(missing)
            best_fields = fields
        if not missing:
            return index, fields
    missing = [name for name in REQUIRED_COLUMNS if name not in best_fields]
    if not best_fields:
        raise RetestRateValidationError(f"{filename}: 无法识别的文件格式")
    raise RetestRateValidationError(f"{filename}: 缺少必需列：{', '.join(missing)}")


def _is_meta_row(row: list[str]) -> bool:
    first = row[0].strip() if row else ""
    return any(first.startswith(prefix) for prefix in _META_PREFIXES)


def _data_start(grid: list[list[str]], header_index: int) -> int:
    """跳过表头后的规格/元数据行，返回第一条数据行的逻辑下标。"""
    index = header_index + 1
    while index < len(grid):
        row = grid[index]
        if not any(cell.strip() for cell in row):
            index += 1
            continue
        if _is_meta_row(row):
            index += 1
            continue
        break
    return index


def _build_layout(path: Path, grid: list[list[str]]) -> _Layout:
    fmt = detect_format(grid)
    if fmt is None:
        raise RetestRateValidationError(f"{path.name}: 无法识别的文件格式")
    header_index, header_fields = _find_header(grid, path.name)
    station_name = None
    if fmt in {"insight", "dcr"} and grid and grid[0]:
        station_name = grid[0][0].strip().strip('"') or None
    return _Layout(
        fmt=fmt,
        header_index=header_index,
        header_fields=header_fields,
        data_start=_data_start(grid, header_index),
        station_name=station_name,
    )


def _select_columns(
    header_fields: list[str], names: list[str]
) -> tuple[list[int], list[str]]:
    indices: list[int] = []
    selected: list[str] = []
    seen: set[str] = set()
    for name in names:
        if name in seen or name not in header_fields:
            continue
        seen.add(name)
        indices.append(header_fields.index(name))
        selected.append(name)
    # Polars 按源文件列顺序返回投影结果，而不是按 columns 传入顺序；
    # 名称必须与升序后的下标一一对应，否则列会整体错位。
    pairs = sorted(zip(indices, selected, strict=True), key=lambda pair: pair[0])
    return [index for index, _ in pairs], [name for _, name in pairs]


def _read_frame(
    path: Path,
    layout: _Layout,
    names: list[str],
) -> pl.DataFrame | None:
    """按列投影读取数据区；GB18030 或 Polars 路径失败时回退到文本读取。"""
    indices, selected = _select_columns(layout.header_fields, names)
    if not indices:
        return None
    read_kwargs = {
        "has_header": False,
        "skip_rows": layout.data_start,
        "columns": indices,
        "new_columns": selected,
        "infer_schema": False,
        "empty_string_is_null": False,
        "truncate_ragged_lines": True,
        "ignore_errors": True,
    }
    try:
        return pl.read_csv(path, **read_kwargs)
    except Exception:
        try:
            text = _read_text(path)
            return pl.read_csv(io.StringIO(text), **read_kwargs)
        except Exception as exc:
            raise RetestRateValidationError(
                f"{path.name}: 无法解析 CSV 文件（{exc}）"
            ) from exc


def _text(row: dict[str, Any], key: str) -> str:
    value = row.get(key)
    return "" if value is None else str(value)


def _stripped(row: dict[str, Any], key: str) -> str:
    return _text(row, key).strip()


def _iter_data_rows(
    frame: pl.DataFrame, header_fields: list[str]
) -> Iterator[dict[str, Any]]:
    """迭代数据行，跳过可能残留在数据区的规格/元数据行。"""
    first_column = header_fields[0] if header_fields else None
    for row in frame.iter_rows(named=True):
        if first_column is not None:
            first = row.get(first_column)
            if first is not None and any(
                str(first).strip().startswith(prefix) for prefix in _META_PREFIXES
            ):
                continue
        yield row


def _record_value(record: dict | None) -> str:
    """取记录中该 SN 失败项的测量值，无记录/未读到列时返回 N/A。"""
    if record is None:
        return "N/A"
    value = record.get("test_value")
    return "N/A" if value is None else str(value)


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
    batches: list[tuple[Path, _Layout, list[dict]]] = []

    base_names = [
        "SerialNumber",
        "Test Pass/Fail Status",
        "StartTime",
        "EndTime",
        "List of Failing Tests",
        "Station ID",
        "Version",
        *_STATION_KEYS[1:],
        *_SLOT_KEYS,
    ]

    # ---- 第一遍：必需列 + 机台/穴位/版本，建立 SN 记录 ----
    for file_idx, path in enumerate(file_paths):
        log(f"开始分析 {path.name}")
        try:
            grid = _prefix_grid(path)
        except (OSError, UnicodeDecodeError) as exc:
            raise RetestRateValidationError(
                f"{path.name}: 文件读取失败（{exc}）"
            ) from exc

        layout = _build_layout(path, grid)
        if file_idx == 0:
            spec_limits, _, csv_format = parse_spec_limits(grid, path.name)
        if layout.station_name:
            station_names.add(layout.station_name)

        frame = _read_frame(path, layout, base_names)
        if frame is None:
            raise RetestRateValidationError(f"{path.name}: 数据区为空")

        file_records: list[dict] = []
        for row in _iter_data_rows(frame, layout.header_fields):
            total_rows += 1
            sn = _stripped(row, "SerialNumber")
            status = _stripped(row, "Test Pass/Fail Status").upper()
            failing_tests = _text(row, "List of Failing Tests")
            start_time_str = _stripped(row, "StartTime")
            end_time_str = _stripped(row, "EndTime")

            station_id = next(
                (_stripped(row, key) for key in _STATION_KEYS if _stripped(row, key)),
                "",
            )
            slot_id = next(
                (_stripped(row, key) for key in _SLOT_KEYS if _stripped(row, key)),
                "",
            )
            if not station_id:
                station_id = "N/A"
            if not slot_id:
                slot_id = "1"

            start_time = _parse_time(start_time_str)
            end_time = _parse_time(end_time_str)
            test_time = None
            if start_time and end_time and status == "PASS":
                seconds = (end_time - start_time).total_seconds()
                if seconds >= 0:
                    test_time = seconds
                    test_times.append(test_time)

            version = _stripped(row, "Version")
            if version:
                versions.add(version)

            record = {
                "sn": sn,
                "status": status,
                "failing_tests": failing_tests,
                "start_time": start_time_str,
                "test_time": test_time,
                "station_id": station_id,
                "slot_id": slot_id,
                "test_value": None,
            }
            file_records.append(record)
            all_records.append(record)
            sn_records[sn].append(record)

            if status == "PASS":
                pass_sn.add(sn)
            elif status == "FAIL":
                fail_sn.add(sn)
                if failing_tests:
                    test = failing_tests.split(";")[0].strip()
                    if test:
                        sn_test_mapping.setdefault(sn, test)

        batches.append((path, layout, file_records))
        log(f"{path.name}: 共 {len(file_records)} 行")

    # ---- 第二遍：只读失败项对应的测量列，挂回明细值 ----
    needed_tests = {test for test in sn_test_mapping.values() if test}
    if needed_tests:
        for path, layout, file_records in batches:
            test_names = [test for test in needed_tests if test in layout.header_fields]
            if not test_names:
                continue
            frame = _read_frame(path, layout, ["SerialNumber", *test_names])
            if frame is None:
                continue
            for record, row in zip(
                file_records,
                _iter_data_rows(frame, layout.header_fields),
                strict=False,
            ):
                test = sn_test_mapping.get(record["sn"])
                if not test:
                    continue
                value = row.get(test)
                record["test_value"] = "" if value is None else str(value)

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
                    "first_fail_value": _record_value(first_fail),
                    "first_fail_station": first_fail["station_id"],
                    "first_fail_slot": first_fail["slot_id"],
                    "second_fail_value": _record_value(second_fail),
                    "second_fail_station": (
                        second_fail["station_id"] if second_fail else "N/A"
                    ),
                    "second_fail_slot": (
                        second_fail["slot_id"] if second_fail else "N/A"
                    ),
                    "pass_value": _record_value(last_pass),
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
                    "first_fail_value": _record_value(first_fail),
                    "first_fail_station": first_fail["station_id"],
                    "first_fail_slot": first_fail["slot_id"],
                    "second_test_value": _record_value(second_test),
                    "second_test_station": (
                        second_test["station_id"] if second_test else "N/A"
                    ),
                    "second_test_slot": (
                        second_test["slot_id"] if second_test else "N/A"
                    ),
                    "third_test_value": _record_value(third_test),
                    "third_test_station": (
                        third_test["station_id"] if third_test else "N/A"
                    ),
                    "third_test_slot": (third_test["slot_id"] if third_test else "N/A"),
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

"""合并主逻辑（移植自 Swift MergeEngine.swift）。

枚举 unit-archive 下所有 unit，解析每个 unit 的所有 run，
把长表 pivot 转成宽表（每 run 一行，每测量项一列）。
多 run 保留：同一 unit 的多次测试全部展开，RunIndex 标识第几次（1-based，按 RunTime 升序）。
字段提取规则忠实复刻 pivot_to_wide.py。
纯逻辑、不依赖框架，可在后台线程/任务中调用。
"""

from __future__ import annotations

from collections.abc import Callable
from functools import cmp_to_key
from pathlib import Path

from app.services.atlas_merge import pivot_parser, records_parser, time_csv
from app.services.atlas_merge.models import (
    ColumnDef,
    DataSourceType,
    MergedReport,
    MetaColumn,
    PivotData,
    UnitRecord,
)

# 数据文件读取失败的错误消息模板（与 Swift 完全一致）
_ERROR_MESSAGE = "{unit} [run {run_index}]: 数据文件读取失败"


def merge(
    unit_archive: Path,
    preferred_source: str | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> MergedReport:
    """合并指定 unit-archive 目录下的所有 unit。

    - ``unit_archive``: unit-archive 根目录
    - ``preferred_source``: 首选数据来源，None 表示自动选择（优先 System）
    - ``progress``: 进度回调 (已完成数, 总数)
    """
    # 1. 枚举 unit 目录（排除 group 开头）并按目录名稳定排序
    try:
        entries = list(unit_archive.iterdir())
    except OSError:
        return empty_report()
    unit_dirs = sorted(
        (e for e in entries if e.is_dir() and not e.name.startswith("group")),
        key=lambda e: e.name,
    )

    # 2. 检测可用数据来源
    available_sources = detect_available_sources(unit_dirs)

    # 3. 确定实际使用的数据来源
    if preferred_source is not None and preferred_source in available_sources:
        actual_source = preferred_source
    elif DataSourceType.SYSTEM.value in available_sources:
        actual_source = DataSourceType.SYSTEM.value
    elif DataSourceType.USER.value in available_sources:
        actual_source = DataSourceType.USER.value
    else:
        actual_source = DataSourceType.SYSTEM.value  # 默认值，虽然不会有数据

    # 4. 逐个 unit 解析（一个 unit 可能有多个 run，全部保留）
    records: list[UnitRecord] = []
    parse_errors: list[str] = []
    for idx, unit_dir in enumerate(unit_dirs):
        unit_records = parse_unit(unit_dir, actual_source)
        for rec in unit_records:
            if rec.metadata[MetaColumn.RESULT.value] == "ERROR":
                parse_errors.append(
                    _ERROR_MESSAGE.format(unit=rec.unitDirName, run_index=rec.runIndex)
                )
        records.extend(unit_records)
        if progress is not None:
            progress(idx + 1, len(unit_dirs))

    # 5. 汇总测量列：按跨 unit 首次出现顺序排列（对齐 pivot 行序），记录首次 limit
    ordered_keys: list[str] = []
    seen: set[str] = set()
    key_limits: dict[str, tuple[str, str, str]] = {}
    for rec in records:
        for m in rec.measurements:
            if m.key not in seen:
                seen.add(m.key)
                ordered_keys.append(m.key)
                key_limits[m.key] = (m.lower, m.higher, m.unit)

    # 6. 组装列定义（元数据列 + 测量列）
    columns: list[ColumnDef] = meta_columns()
    for key in ordered_keys:
        lower, higher, unit = key_limits[key]
        columns.append(ColumnDef(name=key, lower=lower, higher=higher, unit=unit))

    # 7. 组装数据行
    meta_names = [mc.value for mc in MetaColumn]
    rows: list[list[str]] = []
    for rec in records:
        value_by_key = {m.key: m.value for m in rec.measurements}
        row = [rec.metadata.get(name, "") for name in meta_names]
        row.extend(value_by_key.get(key, "") for key in ordered_keys)
        rows.append(row)

    return MergedReport(
        columns=columns,
        rows=rows,
        parseErrors=parse_errors,
        dataSource=actual_source,
        availableDataSources=available_sources,
    )


def empty_report() -> MergedReport:
    """空报表：只有元数据列定义，无数据行。"""
    return MergedReport(
        columns=meta_columns(),
        rows=[],
        parseErrors=[],
        dataSource=DataSourceType.SYSTEM.value,
        availableDataSources=set(),
    )


def detect_available_sources(unit_dirs: list[Path]) -> set[str]:
    """检测 unit-archive 中有哪些可用的数据来源。"""
    sources: set[str] = set()
    for unit_dir in unit_dirs:
        try:
            subs = sorted(e for e in unit_dir.iterdir() if e.is_dir())
        except OSError:
            continue
        unit_name = unit_dir.name
        for sub in subs:
            # 检查 records.csv
            if (sub / "system" / "records.csv").is_file():
                sources.add(DataSourceType.SYSTEM.value)
            # 检查 _pivot.csv
            if (sub / "user" / f"{unit_name}_pivot.csv").is_file():
                sources.add(DataSourceType.USER.value)
            # 找到两种来源就提前退出
            if len(sources) == 2:
                return sources
    return sources


def parse_unit(unit_dir: Path, preferred_source: str) -> list[UnitRecord]:
    """解析单个 unit 的所有 run：枚举 run 子目录，按 RunTime（time.csv）升序，
    runIndex 从 1 递增。每个 run 产生一个 UnitRecord。无 run 目录时返回空数组。
    """
    try:
        subs = [e for e in unit_dir.iterdir() if e.is_dir()]
    except OSError:
        return []

    # 排序依据：优先用 time.csv 的 DeviceStartStop StartTime（权威）；
    # 读不到时回退到目录名字典序（目录名含时间戳，大多数情况与时间序一致）。
    def _compare_runs(a: Path, b: Path) -> int:
        ta = time_csv.start_time(a)
        tb = time_csv.start_time(b)
        if ta and tb:
            return (ta > tb) - (ta < tb)
        return (a.name > b.name) - (a.name < b.name)

    sorted_runs = sorted(subs, key=cmp_to_key(_compare_runs))
    if not sorted_runs:
        return []

    unit_name = unit_dir.name
    result: list[UnitRecord] = []
    for idx, run_dir in enumerate(sorted_runs):
        if preferred_source == DataSourceType.SYSTEM.value:
            records_url = run_dir / "system" / "records.csv"
            start = time_csv.start_time(run_dir)
            stop = time_csv.stop_time(run_dir)
            pivot = records_parser.parse_url(records_url, start, stop)
        else:  # DataSourceType.USER
            pivot_url = run_dir / "user" / f"{unit_name}_pivot.csv"
            pivot = pivot_parser.parse_url(pivot_url)
        run_time = time_csv.start_time(run_dir)
        metadata = build_metadata(
            pivot=pivot,
            unit_dir_name=unit_name,
            run_index=idx + 1,
            run_time=run_time,
        )
        result.append(
            UnitRecord(
                unitDirName=unit_name,
                runIndex=idx + 1,
                runTime=run_time,
                metadata=metadata,
                measurements=pivot.measurements,
            )
        )
    return result


def build_metadata(
    pivot: PivotData,
    unit_dir_name: str,
    run_index: int,
    run_time: str,
) -> dict[str, str]:
    """按 pivot_to_wide.py 规则组装元数据列（Product 留空，时间用原始 min/max，失败项逗号连接）。"""
    return {
        MetaColumn.PRODUCT.value: "",
        MetaColumn.SERIAL_NUMBER.value: unit_dir_name,
        MetaColumn.RUN_INDEX.value: str(run_index),
        MetaColumn.RUN_TIME.value: run_time,
        MetaColumn.RESULT.value: pivot.overallStatus,
        MetaColumn.START_TIME.value: pivot.startTime,
        MetaColumn.END_TIME.value: pivot.endTime,
        MetaColumn.FAILING_TESTS.value: ",".join(pivot.failingTests),
    }


def meta_columns() -> list[ColumnDef]:
    """元数据列的空 limit 定义。"""
    return [ColumnDef(name=mc.value, lower="", higher="", unit="") for mc in MetaColumn]

"""数据合并过程中的核心数据模型（移植自 AtlasLog MergeModels.swift）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class DataSourceType(StrEnum):
    """数据来源类型。"""

    SYSTEM = "System"  # system/records.csv
    USER = "User"  # user/<unitName>_pivot.csv


class MetaColumn(StrEnum):
    """输出表中固定的元数据列，枚举顺序即导出顺序（对齐 pivot_to_wide.py）。"""

    PRODUCT = "Product"
    SERIAL_NUMBER = "SerialNumber"
    RUN_INDEX = "RunIndex"  # 第几次测试（1-based，按 RunTime 升序）
    RUN_TIME = (
        "RunTime"  # 本次测试起始时间（time.csv 的 DeviceStartStop StartTime，Unix 秒）
    )
    RESULT = "Test Pass/Fail Status"
    START_TIME = "StartTime"
    END_TIME = "EndTime"
    FAILING_TESTS = "List of Failing Tests"


@dataclass(frozen=True)
class MeasurementItem:
    """单次测量项，key 形如 "Measure-Voltage_PP_VBUS_USBC#1"，作为输出列的唯一标识。"""

    key: str
    value: str
    lower: str
    higher: str
    unit: str


@dataclass(frozen=True)
class PivotData:
    """pivot/records 解析的中间结果。"""

    measurements: list[MeasurementItem]
    # 整体结果：全部 PASS 为 PASS，否则 FAIL；解析失败时为 ERROR
    overallStatus: str
    # 最早时间戳（原始字符串）
    startTime: str
    # 最晚时间戳（原始字符串）
    endTime: str
    # 所有非 PASS 行的 subsubtestname（原始，用于 List of Failing Tests）
    failingTests: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ColumnDef:
    """输出列定义（元数据列与测量列统一表示）。

    元数据列 limit 留空；测量列取该 key 首次出现的 lower/higher/unit。
    """

    name: str
    lower: str
    higher: str
    unit: str


@dataclass(frozen=True)
class UnitRecord:
    """单个 unit 单次 run 解析后的聚合结果。

    一个 unit 可能有多个 run（复测），每个 run 对应一个 UnitRecord。
    """

    # unit 目录名（形如 JMVHTV... 的 SN），用于排序与调试
    unitDirName: str
    # 第几次测试（1-based，按 RunTime 升序；同一 unit 内唯一）
    runIndex: int
    # 本次测试起始时间（time.csv 的 DeviceStartStop StartTime，Unix 秒原始字符串）
    runTime: str
    # 元数据列值，键为 MetaColumn 的 value
    metadata: dict[str, str]
    # 所有测量项
    measurements: list[MeasurementItem]


@dataclass(frozen=True)
class MergedReport:
    """合并后的完整报表。"""

    # 元数据列 + N 个测量列
    columns: list[ColumnDef]
    # 每行一个 unit 的一次 run，行内字段顺序与 columns 一致
    rows: list[list[str]]
    # 解析失败的 unit 列表（每条形如 "unitName [run n]: 原因"）
    parseErrors: list[str]
    # 当前使用的数据来源
    dataSource: str
    # 可用的数据来源集合（可能同时存在 System 和 User）
    availableDataSources: set[str]

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime
from typing import Any

import polars as pl

CHANGE_TYPES = {"all", "new", "removed", "anomaly"}

_IDENTIFIER_COLUMNS = (
    "資產編號",
    "资产编号",
    "Asset ID",
    "RFID",
    "RFID（Tag）",
    "设备编号",
    "設備編號",
    "機身SN",
    "Serial Number",
)
_NAME_COLUMNS = (
    "資產名稱",
    "资产名称",
    "设备名称",
    "設備名稱",
    "Model Number",
)
_OWNER_COLUMNS = (
    "保管人",
    "保管人員",
    "DRI",
    "資產所屬部門代號",
    "资产所属部门代号",
)

_MODULE_SPECS = {
    "ff": (
        ("new_Custodian_assets", "new", "依保管人", "this_Finance_data", "本期财务"),
        (
            "removed_Custodian_assets",
            "removed",
            "依保管人",
            "last_Finance_data",
            "上期财务",
        ),
        ("new_Department_assets", "new", "依保管部门", "this_Finance_data", "本期财务"),
        (
            "removed_Department_assets",
            "removed",
            "依保管部门",
            "last_Finance_data",
            "上期财务",
        ),
        (
            "check_Custodian",
            "anomaly",
            "保管人异常",
            "this_Finance_data",
            "本期财务",
        ),
        (
            "check_Department",
            "anomaly",
            "部门异常",
            "this_Finance_data",
            "本期财务",
        ),
    ),
    "nn": (
        ("new_assets", "new", "有资产记录", "this_Notes_data", "本期 Notes"),
        ("removed_assets", "removed", "有资产记录", "last_Notes_data", "上期 Notes"),
        ("new_No_assets", "new", "无资产编号记录", "this_Notes_data", "本期 Notes"),
        (
            "removed_No_assets",
            "removed",
            "无资产编号记录",
            "last_Notes_data",
            "上期 Notes",
        ),
    ),
    "sfc": (
        ("new_assets", "new", "资产 / 设备", "this_SFC_data", "本期 SFC"),
        ("removed_assets", "removed", "资产 / 设备", "last_SFC_data", "上期 SFC"),
    ),
    "cc": (
        ("new_Customer_assets", "new", "客户资产", "this_Customer_data", "本期客户"),
        (
            "removed_Customer_assets",
            "removed",
            "客户资产",
            "last_Customer_data",
            "上期客户",
        ),
    ),
    "fn": (
        ("new_assets", "new", "Notes 独有", "Notes_data", "本期 Notes"),
        ("removed_assets", "removed", "财务独有", "Finance_data", "本期财务"),
    ),
    "ns": (
        ("Notes_new_assets", "new", "Notes 独有", "this_Notes_data", "本期 Notes"),
        (
            "Notes_removed_assets",
            "removed",
            "SFC 独有",
            "this_SFC_data",
            "本期 SFC",
        ),
    ),
    "cn": (
        ("new_assets", "new", "Notes 独有", "this_Notes_data", "本期 Notes"),
        (
            "remove_assets",
            "removed",
            "客户系统独有",
            "this_Customer_data",
            "本期客户",
        ),
    ),
}


def _display_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime | date):
        return value.isoformat()
    if hasattr(value, "item"):
        return _display_value(value.item())
    return str(value).strip()


def _sequence(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, pl.Series):
        return value.to_list()
    if isinstance(value, str | bytes):
        return [value]
    if isinstance(value, Iterable):
        return list(value)
    return [value]


def _normalized_identifier(value: Any) -> str:
    identifier = _display_value(value)
    if identifier.startswith(("A:", "D:")):
        return identifier[2:]
    return identifier


def _first_value(row: dict[str, Any] | None, columns: tuple[str, ...]) -> str:
    if row is None:
        return ""
    for column in columns:
        value = _display_value(row.get(column))
        if value:
            return value
    return ""


def _frame_index(frame: pl.DataFrame | None) -> dict[str, dict[str, Any]]:
    if frame is None or frame.is_empty():
        return {}
    identifier_columns = [
        column for column in _IDENTIFIER_COLUMNS if column in frame.columns
    ]
    index: dict[str, dict[str, Any]] = {}
    for row in frame.iter_rows(named=True):
        for column in identifier_columns:
            value = _display_value(row.get(column))
            if value:
                index.setdefault(value.casefold(), row)
        name = _first_value(row, _NAME_COLUMNS)
        serial = _display_value(row.get("機身SN"))
        if name and serial:
            index.setdefault(f"{name}||{serial}".casefold(), row)
    return index


def _detail_text(change_type: str, dimension: str, source_label: str) -> str:
    if change_type == "anomaly":
        return f"{source_label}的{dimension}，需核对配置或源数据"
    if change_type == "new":
        return f"仅在{source_label}中出现"
    return f"仅在{source_label}中出现，另一侧未匹配"


def build_difference_details(
    *,
    module_key: str,
    instance: Any,
    change_type: str = "all",
    query: str = "",
    offset: int = 0,
    limit: int = 50,
) -> dict:
    if module_key not in _MODULE_SPECS:
        raise ValueError("不支持的资产核对模块")
    if change_type not in CHANGE_TYPES:
        raise ValueError("不支持的差异类型")

    frame_indexes: dict[str, dict[str, dict[str, Any]]] = {}
    records = []
    for (
        field_name,
        record_change_type,
        dimension,
        frame_name,
        source_label,
    ) in _MODULE_SPECS[module_key]:
        frame = getattr(instance, frame_name, None)
        if frame_name not in frame_indexes:
            frame_indexes[frame_name] = _frame_index(frame)
        index = frame_indexes[frame_name]
        for raw_identifier in _sequence(getattr(instance, field_name, None)):
            lookup_key = _normalized_identifier(raw_identifier).casefold()
            row = index.get(lookup_key)
            identifier = _normalized_identifier(raw_identifier)
            records.append(
                {
                    "id": (
                        f"{module_key}:{record_change_type}:{dimension}:"
                        f"{_display_value(raw_identifier)}"
                    ),
                    "changeType": record_change_type,
                    "dimension": dimension,
                    "identifier": identifier,
                    "name": _first_value(row, _NAME_COLUMNS),
                    "owner": _first_value(row, _OWNER_COLUMNS),
                    "sourceLabel": source_label,
                    "detail": _detail_text(
                        record_change_type,
                        dimension,
                        source_label,
                    ),
                }
            )

    order = {"anomaly": 0, "new": 1, "removed": 2}
    records.sort(
        key=lambda record: (
            order[record["changeType"]],
            record["dimension"],
            record["identifier"],
        )
    )
    # 同一资产编号可能同时命中多个差异维度（如"依保管人"新增与"依保管部门"新增、
    # 保管人异常与部门异常）：按资产编号去重，避免总数把同一条差异重复计算。
    # 保留排序后最先出现的一条（异常 > 新增 > 减少），与导出报表的资产级口径一致。
    unique_records: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for record in records:
        key = record["identifier"]
        if key in seen_ids:
            continue
        seen_ids.add(key)
        unique_records.append(record)
    records = unique_records

    totals = {
        "all": len(records),
        "new": sum(record["changeType"] == "new" for record in records),
        "removed": sum(record["changeType"] == "removed" for record in records),
        "anomaly": sum(record["changeType"] == "anomaly" for record in records),
    }

    filtered = (
        records
        if change_type == "all"
        else [record for record in records if record["changeType"] == change_type]
    )
    normalized_query = query.strip().casefold()
    if normalized_query:
        filtered = [
            record
            for record in filtered
            if normalized_query
            in " ".join(str(value) for value in record.values()).casefold()
        ]

    return {
        "moduleKey": module_key,
        "records": filtered[offset : offset + limit],
        "totals": totals,
        "filteredTotal": len(filtered),
        "offset": offset,
        "limit": limit,
    }

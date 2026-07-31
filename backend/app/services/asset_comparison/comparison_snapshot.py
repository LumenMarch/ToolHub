from __future__ import annotations

import json
import os
import shutil
import uuid
from collections.abc import Iterable
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import polars as pl

SNAPSHOT_FILENAME = "report-snapshot.json"
SNAPSHOT_DATA_DIR = "report-data"

DATA_FIELDS = {
    "ff": ("this_Finance_data", "last_Finance_data"),
    "nn": ("this_Notes_data", "last_Notes_data"),
    "sfc": ("this_SFC_data", "last_SFC_data"),
    "cc": ("this_Customer_data", "last_Customer_data"),
    "fn": ("Notes_data", "Finance_data"),
    "ns": ("this_Notes_data", "this_SFC_data"),
    "cn": ("this_Customer_data", "this_Notes_data"),
}

SIZE_FIELDS = {
    "ff": ("this_Custodian_assets", "last_Custodian_assets"),
    "nn": ("this_assets_filtered", "last_assets_filtered"),
    "sfc": ("this_SFC_assets", "last_SFC_assets"),
    "cc": ("this_Customer_assets", "last_Customer_assets"),
    "cn": ("this_Notes_assets",),
}

SEQUENCE_FIELDS = {
    "ff": (
        "new_Custodian_assets",
        "removed_Custodian_assets",
        "new_Department_assets",
        "removed_Department_assets",
    ),
    "nn": ("new_assets", "removed_assets", "new_No_assets", "removed_No_assets"),
    "sfc": ("new_assets", "removed_assets"),
    "cc": ("new_Customer_assets", "removed_Customer_assets"),
    "fn": ("new_assets", "removed_assets"),
    "ns": ("Notes_new_assets", "Notes_removed_assets"),
    "cn": ("remove_assets", "new_assets"),
}

SCALAR_FIELDS = {
    "nn": ("this_invalid_all_rows", "last_invalid_all_rows"),
}


class SizedValue:
    """只保存集合长度，供汇总统计使用。"""

    def __init__(self, size: int) -> None:
        self._size = size

    def __len__(self) -> int:
        return self._size


def _safe_size(value: Any) -> int:
    if value is None:
        return 0
    try:
        return len(value)
    except Exception:
        return 0


def _json_scalar(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, datetime | date):
        return {"type": "datetime", "value": value.isoformat()}
    if hasattr(value, "item"):
        return _json_scalar(value.item())
    return str(value)


def _restore_scalar(value: Any) -> Any:
    if isinstance(value, dict) and value.get("type") == "datetime":
        return datetime.fromisoformat(value["value"])
    return value


def _sequence_values(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, pl.Series):
        values = value.to_list()
    elif isinstance(value, str | bytes):
        values = [value]
    elif isinstance(value, Iterable):
        values = list(value)
    else:
        values = [value]
    return [_json_scalar(item) for item in values]


def save_comparison_snapshot(summary: dict, job_dir: Path) -> Path:
    """保存最终报告需要的稳定数据，不保留旧核对类实例。"""
    generation = uuid.uuid4().hex
    data_dir = job_dir / SNAPSHOT_DATA_DIR / generation
    data_dir.mkdir(parents=True, exist_ok=True)
    modules = {}

    try:
        for module_key in DATA_FIELDS:
            instance = summary.get(module_key)
            if instance is None:
                raise ValueError(f"缺少资产核对模块结果: {module_key}")
            fields = {}

            for field_name in DATA_FIELDS.get(module_key, ()):
                value = getattr(instance, field_name, None)
                if hasattr(value, "collect"):
                    value = value.collect()
                if value is None:
                    fields[field_name] = {"kind": "none"}
                    continue
                if not isinstance(value, pl.DataFrame):
                    raise TypeError(
                        f"{module_key}.{field_name} 不是可持久化的 Polars DataFrame"
                    )
                relative_path = (
                    Path(SNAPSHOT_DATA_DIR)
                    / generation
                    / f"{module_key}-{field_name}.arrow"
                )
                target_path = job_dir / relative_path
                temporary_path = target_path.with_suffix(".arrow.tmp")
                value.write_ipc(temporary_path)
                os.replace(temporary_path, target_path)
                fields[field_name] = {
                    "kind": "dataframe",
                    "path": relative_path.as_posix(),
                    "rows": len(value),
                    "columns": list(value.columns),
                }

            for field_name in SIZE_FIELDS.get(module_key, ()):
                fields[field_name] = {
                    "kind": "size",
                    "value": _safe_size(getattr(instance, field_name, None)),
                }

            for field_name in SEQUENCE_FIELDS.get(module_key, ()):
                fields[field_name] = {
                    "kind": "sequence",
                    "value": _sequence_values(getattr(instance, field_name, None)),
                }

            for field_name in SCALAR_FIELDS.get(module_key, ()):
                fields[field_name] = {
                    "kind": "scalar",
                    "value": _json_scalar(getattr(instance, field_name, 0)),
                }

            modules[module_key] = {"fields": fields}

        snapshot = {
            "version": 1,
            "generation": generation,
            "results_info": summary.get("results_info", []),
            "modules": modules,
        }
        target_path = job_dir / SNAPSHOT_FILENAME
        temporary_path = target_path.with_suffix(".json.tmp")
        temporary_path.write_text(
            json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(temporary_path, target_path)
    except Exception:
        shutil.rmtree(data_dir, ignore_errors=True)
        raise

    return target_path


def _resolve_snapshot_data_path(job_dir: Path, relative_path: str) -> Path:
    root = job_dir.resolve()
    target = (root / relative_path).resolve()
    if root not in target.parents:
        raise ValueError("资产核对快照包含无效数据路径")
    return target


def load_comparison_snapshot(job_dir: Path) -> dict:
    """从持久化快照重建最终报告所需的只读数据。"""
    snapshot_path = job_dir / SNAPSHOT_FILENAME
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if snapshot.get("version") != 1:
        raise ValueError("不支持的资产核对报告快照版本")

    summary = {"results_info": snapshot.get("results_info", [])}
    for module_key, module_data in snapshot.get("modules", {}).items():
        fields = {}
        for field_name, field_data in module_data.get("fields", {}).items():
            kind = field_data.get("kind")
            if kind == "dataframe":
                fields[field_name] = pl.read_ipc(
                    _resolve_snapshot_data_path(job_dir, field_data["path"])
                )
            elif kind == "size":
                fields[field_name] = SizedValue(int(field_data.get("value", 0)))
            elif kind == "sequence":
                fields[field_name] = [
                    _restore_scalar(value) for value in field_data.get("value", [])
                ]
            elif kind == "scalar":
                fields[field_name] = _restore_scalar(field_data.get("value"))
            elif kind == "none":
                fields[field_name] = None
            else:
                raise ValueError(
                    f"不支持的资产核对快照字段类型: {module_key}.{field_name}"
                )
        summary[module_key] = SimpleNamespace(**fields)
    return summary


def comparison_snapshot_exists(job_dir: Path) -> bool:
    snapshot_path = job_dir / SNAPSHOT_FILENAME
    try:
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        if snapshot.get("version") != 1:
            return False
        modules = snapshot.get("modules")
        if not isinstance(modules, dict) or set(modules) != set(DATA_FIELDS):
            return False
        return all(
            field_data.get("kind") != "dataframe"
            or _resolve_snapshot_data_path(job_dir, field_data["path"]).is_file()
            for module_data in modules.values()
            for field_data in module_data.get("fields", {}).values()
        )
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
        return False

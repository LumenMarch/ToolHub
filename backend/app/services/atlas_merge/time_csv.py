"""解析单个 run 的 system/time.csv，提取整次测试的起始时间（移植自 Swift TimeCSVParser.swift）。

time.csv 结构：TaskOrder,GraphNumber,StartTime,StopTime,Duration,ActionName,TagName,Slot,GraphHash
最后一行 ActionName="DeviceStartStop" 记录整次测试的起止，StartTime 为 Unix 秒。
该时间作为 RunTime 列的值与多 run 排序依据（比解析目录名更权威）。
解析失败或缺失时返回空串，不阻断合并流程。
"""

from __future__ import annotations

from pathlib import Path

from app.services.atlas_merge.csv import parse as parse_csv

# time.csv 列索引
_START_TIME_COL = 2
_STOP_TIME_COL = 3
_TAG_NAME_COL = 6  # DeviceStartStop 标识实际出现在 TagName 列（ActionName 列为空）

# DeviceStartStop 行的 TagName 标识（整次测试的起止记录）
_DEVICE_START_STOP = "DeviceStartStop"


def _read_rows(run_dir: Path) -> list[list[str]] | None:
    """读取并解析 run 目录下的 system/time.csv；文件缺失/读取失败返回 None。"""
    url = run_dir / "system" / "time.csv"
    try:
        text = url.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    return parse_csv(text)


def start_time(run_dir: Path) -> str:
    """从 run 目录的 system/time.csv 读取整次测试的起始时间（Unix 秒，原始字符串）。

    - 优先找 TagName == DeviceStartStop 的行（整次测试起止）
    - 无显式 DeviceStartStop 行：回退到最后一个数据行的 StartTime
    - 文件缺失或无数据行时返回空串
    """
    rows = _read_rows(run_dir)
    if rows is None:
        return ""
    data_rows = rows[1:]  # 跳过表头
    for row in data_rows:
        if len(row) > _TAG_NAME_COL and row[_TAG_NAME_COL] == _DEVICE_START_STOP:
            return row[_START_TIME_COL] if len(row) > _START_TIME_COL else ""
    # 无显式 DeviceStartStop 行：回退到最后一个数据行的 StartTime
    if data_rows:
        last = data_rows[-1]
        if len(last) > _START_TIME_COL:
            return last[_START_TIME_COL]
    return ""


def stop_time(run_dir: Path) -> str:
    """从 run 目录的 system/time.csv 读取整次测试的结束时间（Unix 秒，原始字符串）。

    仅取 DeviceStartStop 行的 StopTime；无该行或文件缺失时返回空串（不回退）。
    """
    rows = _read_rows(run_dir)
    if rows is None:
        return ""
    for row in rows[1:]:
        if len(row) > _TAG_NAME_COL and row[_TAG_NAME_COL] == _DEVICE_START_STOP:
            return row[_STOP_TIME_COL] if len(row) > _STOP_TIME_COL else ""
    return ""

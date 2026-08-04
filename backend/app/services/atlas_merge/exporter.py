"""把 MergedReport 序列化为输出模版的四行范式 CSV（移植自 Swift ReportExporter.swift）。

行1 列名 / 行2 Upper Limit / 行3 Lower Limit / 行4 Measurement Unit / 行5+ 数据行。
"""

from __future__ import annotations

from app.services.atlas_merge.csv import write as write_csv
from app.services.atlas_merge.models import MergedReport


def csv_text(report: MergedReport) -> str:
    """生成完整的 CSV 文本（含表头四行与所有数据行）。"""
    rows: list[list[str]] = []

    # 行 1：列名
    rows.append([c.name for c in report.columns])

    # 行 2~4：Limit/Unit。第一列填范式标签，其余列取各自的 higher/lower/unit
    # （元数据列的 higher/lower/unit 本就为空，自然留空，与模版一致）
    upper = [c.higher for c in report.columns]
    if upper:
        upper[0] = "Upper Limited ---->"
    rows.append(upper)

    lower = [c.lower for c in report.columns]
    if lower:
        lower[0] = "Lower Limited ---->"
    rows.append(lower)

    unit = [c.unit for c in report.columns]
    if unit:
        unit[0] = "Measurement Units ---->"
    rows.append(unit)

    # 行 5+：每个 unit 一次 run 一行数据
    rows.extend(report.rows)

    return write_csv(rows)

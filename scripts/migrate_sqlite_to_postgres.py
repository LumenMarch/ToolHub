#!/usr/bin/env python3
"""把 SQLite 数据搬迁到已完成 Alembic 迁移的 PostgreSQL。

一次性工具：保留原主键，按外键依赖顺序复制，最后修正 identity 序列。
目标库的所有业务表会被 TRUNCATE，执行前必须确认目标库为空或已备份。

执行顺序：
    1. alembic upgrade head
    2. 本脚本
    3. python -m app.bootstrap（补齐新版权限/角色等语义迁移）
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Integer, create_engine, text

import app.models  # noqa: F401 - 注册全部模型
from app.db.base_class import Base


# SQLite 的 DateTime 以文本存储，PostgreSQL 驱动需要 datetime 对象
def _coerce(value: Any, column_type: Any) -> Any:
    if value is None:
        return None
    if isinstance(column_type, Boolean):
        return bool(value)
    if isinstance(column_type, DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="SQLite 文件路径")
    parser.add_argument(
        "--target",
        required=True,
        help="PostgreSQL URL，例如 postgresql+psycopg://user:pw@host/db",
    )
    args = parser.parse_args()

    source = sqlite3.connect(args.source)
    source.row_factory = sqlite3.Row
    source_tables = {
        row[0]
        for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' AND name != 'alembic_version'"
        )
    }

    engine = create_engine(args.target)
    ordered_tables = [
        table for table in Base.metadata.sorted_tables if table.name in source_tables
    ]
    table_names = [table.name for table in ordered_tables]
    if not table_names:
        raise SystemExit("源库没有可迁移的业务表")

    with engine.begin() as connection:
        connection.execute(
            text(
                "TRUNCATE TABLE " + ", ".join(table_names) + " RESTART IDENTITY CASCADE"
            )
        )
        for table in ordered_tables:
            source_columns = {
                row[1] for row in source.execute(f"PRAGMA table_info({table.name})")
            }
            columns = [
                column for column in table.columns if column.name in source_columns
            ]
            rows = source.execute(
                f"SELECT {', '.join(column.name for column in columns)} "
                f"FROM {table.name}"
            ).fetchall()
            payload = [
                {
                    column.name: _coerce(row[column.name], column.type)
                    for column in columns
                }
                for row in rows
            ]
            if payload:
                connection.execute(table.insert(), payload)
            print(f"{table.name}: {len(payload)} rows")

        for table in ordered_tables:
            primary_keys = list(table.primary_key.columns)
            if len(primary_keys) != 1:
                continue
            primary_key = primary_keys[0]
            if not isinstance(primary_key.type, Integer):
                continue
            connection.execute(
                text(
                    f"SELECT setval("
                    f"pg_get_serial_sequence('{table.name}', '{primary_key.name}'), "
                    f"COALESCE(MAX({primary_key.name}), 1), "
                    f"MAX({primary_key.name}) IS NOT NULL"
                    f") FROM {table.name}"
                )
            )

    print("migration completed")


if __name__ == "__main__":
    main()

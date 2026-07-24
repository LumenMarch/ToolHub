import io
import polars as pl


def _read_csv(uploaded_file):
    data = uploaded_file.read()
    return pl.read_csv(io.BytesIO(data), infer_schema_length=1000, ignore_errors=False)


def _normalize(df, trim_whitespace=True, ignore_case=True):
    expressions = []
    for column, dtype in df.schema.items():
        expr = pl.col(column)
        if dtype == pl.String:
            if trim_whitespace:
                expr = expr.str.strip_chars()
            if ignore_case:
                expr = expr.str.to_lowercase()
        expressions.append(expr.alias(column))
    return df.with_columns(expressions)


def compare_csv_files(source_file, target_file, key_column, trim_whitespace=True, ignore_case=True):
    source = _read_csv(source_file)
    target = _read_csv(target_file)

    if key_column not in source.columns or key_column not in target.columns:
        raise ValueError(f"主键字段 {key_column} 必须同时存在于两份文件中")
    if source.select(pl.col(key_column).is_duplicated().any()).item():
        raise ValueError("基准文件的主键存在重复值")
    if target.select(pl.col(key_column).is_duplicated().any()).item():
        raise ValueError("目标文件的主键存在重复值")

    common_columns = [c for c in source.columns if c in target.columns and c != key_column]
    source_normalized = _normalize(source, trim_whitespace, ignore_case)
    target_normalized = _normalize(target, trim_whitespace, ignore_case)

    source_rows = {row[key_column]: row for row in source_normalized.to_dicts()}
    target_rows = {row[key_column]: row for row in target_normalized.to_dicts()}
    source_original = {row[key_column]: row for row in source.to_dicts()}
    target_original = {row[key_column]: row for row in target.to_dicts()}

    source_keys = set(source_rows)
    target_keys = set(target_rows)
    added = sorted(target_keys - source_keys, key=str)
    deleted = sorted(source_keys - target_keys, key=str)
    modified = []

    for key in sorted(source_keys & target_keys, key=str):
        changes = []
        for column in common_columns:
            if source_rows[key].get(column) != target_rows[key].get(column):
                changes.append({
                    "column": column,
                    "before": source_original[key].get(column),
                    "after": target_original[key].get(column),
                })
        if changes:
            modified.append({"key": key, "changes": changes})

    return {
        "source_rows": source.height,
        "target_rows": target.height,
        "added": [target_original[key] for key in added],
        "deleted": [source_original[key] for key in deleted],
        "modified": modified,
        "unchanged_count": len(source_keys & target_keys) - len(modified),
        "common_columns": common_columns,
    }

import csv
import io
from dataclasses import dataclass
from typing import Any


class CsvComparisonError(ValueError):
    pass


@dataclass(frozen=True)
class CompareOptions:
    primary_key: str
    trim_whitespace: bool = True
    ignore_case: bool = False


def decode_csv(content: bytes) -> tuple[str, str]:
    for encoding in ("utf-8-sig", "gb18030", "big5"):
        try:
            return content.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise CsvComparisonError("无法识别 CSV 编码，请使用 UTF-8、GB18030 或 Big5")


def parse_csv(content: bytes) -> tuple[list[str], list[dict[str, str]], str]:
    text, encoding = decode_csv(content)
    if not text.strip():
        raise CsvComparisonError("CSV 文件为空")

    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel

    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    original_headers = reader.fieldnames or []
    if any(not header or not header.strip() for header in original_headers):
        raise CsvComparisonError("CSV 表头包含空字段")
    headers = [header.strip() for header in original_headers]
    if not headers:
        raise CsvComparisonError("CSV 文件缺少表头")
    if len(headers) != len(set(headers)):
        raise CsvComparisonError("CSV 表头存在重复字段")

    rows: list[dict[str, str]] = []
    for row in reader:
        rows.append(
            {
                normalized_header: row.get(original_header, "") or ""
                for original_header, normalized_header in zip(
                    original_headers, headers, strict=True
                )
            }
        )
    return headers, rows, encoding


def normalize(value: str, options: CompareOptions) -> str:
    normalized = value.strip() if options.trim_whitespace else value
    return normalized.casefold() if options.ignore_case else normalized


def index_rows(
    rows: list[dict[str, str]],
    options: CompareOptions,
    file_label: str,
) -> dict[str, dict[str, str]]:
    indexed: dict[str, dict[str, str]] = {}
    duplicate_keys: set[str] = set()
    for row in rows:
        key = normalize(row[options.primary_key], options)
        if not key:
            raise CsvComparisonError(f"{file_label} 的主键字段存在空值")
        if key in indexed:
            duplicate_keys.add(row[options.primary_key])
        indexed[key] = row

    if duplicate_keys:
        preview = "、".join(sorted(duplicate_keys)[:5])
        raise CsvComparisonError(f"{file_label} 的主键存在重复值：{preview}")
    return indexed


def compare_csv_files(
    source_content: bytes,
    target_content: bytes,
    options: CompareOptions,
) -> dict[str, Any]:
    source_headers, source_rows, source_encoding = parse_csv(source_content)
    target_headers, target_rows, target_encoding = parse_csv(target_content)

    if options.primary_key not in source_headers:
        raise CsvComparisonError(f"基准文件中找不到主键字段：{options.primary_key}")
    if options.primary_key not in target_headers:
        raise CsvComparisonError(f"对比文件中找不到主键字段：{options.primary_key}")

    source_index = index_rows(source_rows, options, "基准文件")
    target_index = index_rows(target_rows, options, "对比文件")
    source_keys = set(source_index)
    target_keys = set(target_index)
    shared_columns = [
        column
        for column in source_headers
        if column in target_headers and column != options.primary_key
    ]

    added = [
        {"key": target_index[key][options.primary_key], "row": target_index[key]}
        for key in sorted(target_keys - source_keys)
    ]
    deleted = [
        {"key": source_index[key][options.primary_key], "row": source_index[key]}
        for key in sorted(source_keys - target_keys)
    ]

    modified: list[dict[str, Any]] = []
    unchanged_count = 0
    for key in sorted(source_keys & target_keys):
        source_row = source_index[key]
        target_row = target_index[key]
        changes = [
            {
                "field": column,
                "before": source_row[column],
                "after": target_row[column],
            }
            for column in shared_columns
            if normalize(source_row[column], options) != normalize(target_row[column], options)
        ]
        if changes:
            modified.append({"key": source_row[options.primary_key], "changes": changes})
        else:
            unchanged_count += 1

    result_limit = 200
    return {
        "summary": {
            "sourceRows": len(source_rows),
            "targetRows": len(target_rows),
            "added": len(added),
            "deleted": len(deleted),
            "modified": len(modified),
            "unchanged": unchanged_count,
        },
        "metadata": {
            "sourceEncoding": source_encoding,
            "targetEncoding": target_encoding,
            "primaryKey": options.primary_key,
            "comparedColumns": shared_columns,
            "sourceOnlyColumns": [
                column for column in source_headers if column not in target_headers
            ],
            "targetOnlyColumns": [
                column for column in target_headers if column not in source_headers
            ],
            "resultLimit": result_limit,
        },
        "added": added[:result_limit],
        "deleted": deleted[:result_limit],
        "modified": modified[:result_limit],
    }

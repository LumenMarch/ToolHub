from typing import Any

FORMULA_PREFIXES = ("=", "+", "-", "@")
FORMULA_LEADING_WHITESPACE = " \t\r\n"

XLSXWRITER_SAFE_OPTIONS = {
    "strings_to_formulas": False,
    "strings_to_urls": False,
}


def safe_openpyxl_value(value: Any) -> Any:
    """确保不可信字符串在 openpyxl 中按文本单元格写入。"""
    if not isinstance(value, str):
        return value
    normalized = value.lstrip(FORMULA_LEADING_WHITESPACE)
    if normalized.startswith(FORMULA_PREFIXES):
        return f"'{value}"
    return value

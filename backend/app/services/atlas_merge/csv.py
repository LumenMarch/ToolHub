"""简易 CSV 读写工具，无第三方依赖（移植自 AtlasLog CSV.swift）。

解析采用逐字符状态机，正确处理双引号包裹、转义双引号（""）、
引号内的逗号与换行。字段两端空白会被 trim（FCT 数据用空格对齐列宽）。
"""

from __future__ import annotations

# 字段两端 trim 用的精确字符集：水平空白（空格 + 制表符）。
# 注意与裸 strip() 的区别：\r\n/\r 已在解析前归一化为 \n，
# 而引号内的换行属于字段内容，不能用 strip() 把字段首尾的 \n 误剥掉。
# （Swift 侧 .whitespaces 同样是空格/制表符等水平空白、不含换行。）
_HORIZONTAL_WHITESPACE = " \t"

_QUOTE = '"'


def _trim_field(value: str) -> str:
    return value.strip(_HORIZONTAL_WHITESPACE)


def parse(text: str) -> list[list[str]]:
    """把 CSV 文本解析为二维字符串数组（不区分表头）。"""
    rows: list[list[str]] = []
    field_chars: list[str] = []
    row: list[str] = []
    in_quotes = False

    # 归一化换行：CRLF（\r\n）与孤立 CR 都视为 LF。
    # 必须先做整串替换再逐字符处理，否则 \r\n 会被当作两个字符分别处理。
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    chars = normalized
    n = len(chars)
    i = 0
    while i < n:
        c = chars[i]
        if in_quotes:
            if c == _QUOTE:
                # 遇到 "" 视为转义的双引号，否则结束引号
                if i + 1 < n and chars[i + 1] == _QUOTE:
                    field_chars.append(_QUOTE)
                    i += 2
                else:
                    in_quotes = False
                    i += 1
            else:
                field_chars.append(c)
                i += 1
        else:
            if c == _QUOTE:
                in_quotes = True
                i += 1
            elif c == ",":
                row.append(_trim_field("".join(field_chars)))
                field_chars = []
                i += 1
            elif c == "\n":
                row.append(_trim_field("".join(field_chars)))
                field_chars = []
                rows.append(row)
                row = []
                i += 1
            else:
                field_chars.append(c)
                i += 1

    # 处理文件末尾无换行的最后一行
    if field_chars or row:
        row.append(_trim_field("".join(field_chars)))
        rows.append(row)

    # 过滤整行全空的行
    return [r for r in rows if any(f != "" for f in r)]


def write(rows: list[list[str]]) -> str:
    """把二维数组序列化为 CSV 文本。

    所有字段用双引号包裹，字段内的双引号转义为 ""（与 Swift CSV.write 一致，
    不是 Python csv 模块的默认最小引号行为）。
    """
    out = []
    for row in rows:
        parts = [_quote(field) for field in row]
        out.append(",".join(parts))
    if not out:
        return ""
    return "\n".join(out) + "\n"


def _quote(field: str) -> str:
    escaped = field.replace('"', '""')
    return f'"{escaped}"'

"""箱线图统计服务 — 纯逻辑、不依赖 Web 框架。

输入已解析的表格（polars DataFrame），输出各分组的五数概括
（min / Q1 / median / Q3 / max）、IQR、Tukey fences 与离群点。

分位数约定：默认 JMP Type 6（r=(n+1)p），与 JMP Distribution 官方公式对齐。
可选 Hyndman-Fan R7（线性插值），与 numpy.percentile 默认、
Excel QUARTILE.INC 以及 polars quantile(interpolation="linear") 一致。
须线始终为 Tukey 1.5×IQR。
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import polars as pl

# Tukey fences 的 IQR 乘数（1.5×IQR），业界标准
IQR_FACTOR = 1.5
# R7：Hyndman-Fan type 7（numpy / Excel QUARTILE.INC / polars linear）
# JMP：Hyndman-Fan type 6，r=(n+1)p，与 JMP Distribution 官方公式一致
QUARTILE_METHODS = ("JMP", "R7")
QUARTILE_METHOD_LABELS = {
    "R7": "R7 (linear)",
    "JMP": "JMP Type 6",
}
# 每组回传的离群点上限：仅用于渲染，超出部分只计入 outlier_count
MAX_OUTLIERS_PER_GROUP = 500
# 分组上限：防止基数过大的分组列把响应与渲染撑爆。
# 测试系统导出按机台/工位分组常达数十至上百组（如 Keysight 导出按
# Station ID 分组），故放宽；离群点另有 MAX_OUTLIERS_PER_GROUP 兜底。
MAX_GROUPS = 200
# 分组值下拉上限：超过则截断，前端用筛选把分析集压到 MAX_GROUPS 以内
MAX_GROUP_VALUE_OPTIONS = 500
NULL_GROUP_LABEL = "(无值)"
# 列类型推断的采样行数（columns 接口）
SAMPLE_ROWS = 10_000
# 数据预览返回的行数（columns 接口，供用户确认选列）
PREVIEW_ROWS = 5
# 文本列判定"可数值化"的最低有效比例（0.9 = 容忍少量脏单元格）
NUMERIC_TEXT_RATIO = 0.9
# 时间列判定"可解析"的最低有效比例（同口径）
TIME_TEXT_RATIO = 0.9
# 时间分组粒度：日 / 8 小时班次 / 小时
TIME_UNITS = ("day", "shift", "hour")
SHIFT_HOURS = 8
# 时间列名特征：Start/End Time、Test Start Time、Date、Timestamp、中文日期列
_DATETIME_COLUMN_RE = re.compile(
    r"(?:^|\b)(?:test\s*)?(?:start|end)\s*time\b|^date$|^timestamp$|开始时间|结束时间|日期",
    re.IGNORECASE,
)
# 时间字符串格式（覆盖 Keysight/WiPAS 导出的常见写法）
_DATETIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y/%m/%d %H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %I:%M:%S %p",
    "%Y/%m/%d %H:%M",
    "%Y-%m-%d %H:%M",
    "%m/%d/%Y %H:%M",
)

# AtlasLog 四行范式 CSV 的规格行前缀（表头后的上限/下限/单位行）
_ATLAS_META_PREFIXES = (
    "Upper Limited",
    "Lower Limited",
    "Measurement Units",
)

# 测试结果列名（与 cpk-charts 的识别口径一致）
_FAIL_STATUS_COLUMN_RE = re.compile(
    r"(?:test\s*)?pass\s*/\s*fail\s*status|test\s*status|^status$",
    re.IGNORECASE,
)
# 仅排除明确失败；PASS、空值及其它状态保持原样
_FAIL_STATUS_VALUES = ("FAIL",)


@dataclass(frozen=True)
class _CsvLayout:
    """CSV 布局偏移：跳过文件头行数与表头后的元数据行数。"""

    skip_rows: int = 0
    skip_rows_after_header: int = 0


class BoxPlotValidationError(ValueError):
    """输入数据无法计算箱线图时抛出的校验错误。"""


@dataclass(frozen=True)
class ColumnInfo:
    """单列的类型推断结果。"""

    name: str
    # "numeric"：可作数值列；"text"：可作分组列；
    # "datetime"：可作分组列并支持日/班次/小时聚合；"other"：其它
    kind: str
    non_null_count: int
    # 采样行内的唯一值数量（含空值），供前端过滤高基数分组列
    distinct_count: int


@dataclass(frozen=True)
class GroupStat:
    """一个分组的箱线图统计量。"""

    name: str
    count: int
    min: float
    q1: float
    median: float
    q3: float
    max: float
    iqr: float
    fence_low: float
    fence_high: float
    whisker_low: float
    whisker_high: float
    outlier_count: int
    outliers: list[float]


def read_tabular(path: Path, original_filename: str = "") -> pl.DataFrame:
    """解析上传的数据文件。

    磁盘路径是 tus 的随机句柄（如 {id}.part），格式判断必须使用
    上传元数据中的原始文件名（与 attendance 的做法一致）：

    - .xlsx / .xls：交给 fastexcel（经 polars 集成，内容嗅探不依赖扩展名）；
    - .csv / .tsv：采样检测分隔符；UTF-8 解析失败时回退 GB18030 解码
      （写入隔离的临时 UTF-8 文件再解析），仍失败则报错。
    """
    suffix = Path(original_filename).suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        # fastexcel/calamine 的解析异常（实测为 _fastexcel.CalamineError，
        # 继承 Exception）不能逃逸成 500，统一转译为校验错误 → HTTP 400。
        try:
            return pl.read_excel(path)
        except Exception as exc:
            raise BoxPlotValidationError("无法解析 Excel 文件") from exc
    if suffix not in {".csv", ".tsv"}:
        raise BoxPlotValidationError(f"不支持的文件类型: {suffix or '(无扩展名)'}")
    return _read_csv(path)


def _read_csv(path: Path) -> pl.DataFrame:
    """检测编码与分隔符后读取 CSV。

    polars 对非 UTF-8 字节采用 lossy 替换而非报错，无法靠异常触发回退，
    因此先对采样字节做严格的 UTF-8 校验：不合法则按 GB18030 解码再解析。
    """
    with path.open("rb") as fh:
        head = fh.read(SAMPLE_BYTES)
    separator = _detect_separator(head)
    if not _is_valid_utf8(head):
        return _read_csv_encoded(path, separator)
    layout = _detect_export_layout(head.decode("utf-8"), separator)
    return _parse_csv(path, separator, layout)


def _is_valid_utf8(data: bytes) -> bool:
    """严格 UTF-8 校验：BOM 合法；GB18030 等其它多字节编码在此失败。"""
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def _read_csv_encoded(path: Path, separator: str) -> pl.DataFrame:
    """非 UTF-8 文件：按 GB18030 解码后在内存中转为 UTF-8 解析。

    不再单独限制回退文件大小，统一由上传入口的 1 GiB 上限控制；
    不写入系统临时目录，避免进程异常退出后遗留无主副本。
    """
    data = path.read_bytes()
    try:
        text = data.decode("gb18030")
    except UnicodeDecodeError as exc:
        raise BoxPlotValidationError(
            "无法识别 CSV 编码（已尝试 UTF-8 与 GB18030）"
        ) from exc
    del data

    layout = _detect_export_layout(text, separator)
    buf = io.BytesIO(text.encode("utf-8"))
    del text
    return _parse_csv(buf, separator, layout)


def _parse_csv(
    path: Path | io.BytesIO, separator: str, layout: _CsvLayout | None
) -> pl.DataFrame:
    """按布局偏移读取 CSV；解析错误统一转译为校验错误。"""
    layout = layout or _CsvLayout()
    kwargs: dict[str, int] = {}
    if layout.skip_rows:
        kwargs["skip_rows"] = layout.skip_rows
    if layout.skip_rows_after_header:
        kwargs["skip_rows_after_header"] = layout.skip_rows_after_header
    try:
        return pl.read_csv(path, separator=separator, **kwargs)
    except pl.exceptions.NoDataError as exc:
        raise BoxPlotValidationError("CSV 文件没有可解析的数据行") from exc
    except pl.exceptions.PolarsError as exc:
        raise BoxPlotValidationError("无法解析 CSV 文件") from exc


# 分隔符检测：采样字节数与候选分隔符
SAMPLE_BYTES = 64 * 1024
_SEPARATOR_CANDIDATES = (",", ";", "\t", "|")


def _detect_separator(head: bytes) -> str:
    """按前几行候选分隔符出现数与一致性推断分隔符（默认逗号）。

    中文文件常见 GB18030 编码，采样时用 errors="replace" 解码仅影响
    非 ASCII 字节，分隔符判定不受影响。
    """
    sample = head.decode("utf-8", errors="replace")
    lines = [line for line in sample.splitlines() if line.strip()][:10]
    if not lines:
        return ","
    best, best_score = ",", 0.0
    for candidate in _SEPARATOR_CANDIDATES:
        counts = [line.count(candidate) for line in lines]
        if not any(counts):
            continue
        median = sorted(counts)[len(counts) // 2]
        consistent = sum(1 for count in counts if count == median) / len(counts)
        score = median * consistent
        if score > best_score:
            best, best_score = candidate, score
    return best


# 布局特征识别的采样字符数（与 SAMPLE_BYTES 同量级，足以覆盖前若干行；
# 避免对全量解码文本逐行 splitlines）
LAYOUT_SAMPLE_CHARS = 64 * 1024


# Keysight 测试系统导出 CSV 的规格行第一列前缀（表头后连续五行）
_KEYSIGHT_LAYOUT_FIRST_FIELDS = (
    "Display Name",
    "PDCA",
    "Upper Limit",
    "Lower Limit",
    "Measurement Unit",
)


def _detect_export_layout(text: str, separator: str) -> _CsvLayout | None:
    """识别 Keysight 导出布局：首行标题、次行表头、表头后五行规格行。

    这类测试系统导出文件形如：

        HILO1,3.2.8-3.2.8 - All,...,Parametric,...   ← 标题行
        Site,Product,SerialNumber,...                 ← 真正的表头
        Display Name ----->,...
        PDCA Priority ----->,...
        Upper Limit ----->,...
        Lower Limit ----->,...
        Measurement Unit ----->,...
        数据行...

    命中后跳过标题行与五行规格行；普通 CSV 不受影响。
    """
    lines = [line for line in text[:LAYOUT_SAMPLE_CHARS].splitlines() if line.strip()][
        :10
    ]
    # 布局本身只需前 7 个非空行（标题 + 表头 + 5 行规格行），
    # 零数据行的导出也按布局跳过，交由 _parse_csv 报"没有可解析的数据行"
    if len(lines) < 7:
        return None
    if _first_field(lines[1], separator) != "Site":
        return None
    for line, prefix in zip(lines[2:7], _KEYSIGHT_LAYOUT_FIRST_FIELDS, strict=True):
        if not _first_field(line, separator).startswith(prefix):
            return None
    return _CsvLayout(skip_rows=1, skip_rows_after_header=5)


def _first_field(line: str, separator: str) -> str:
    """取 CSV 行第一列文本（去引号），用于布局特征识别。"""
    field = line.split(separator, 1)[0].strip()
    if len(field) >= 2 and field[0] == '"' and field[-1] == '"':
        field = field[1:-1]
    return field


def exclude_atlas_meta_rows(df: pl.DataFrame) -> tuple[pl.DataFrame, int]:
    """排除 AtlasLog 四行范式 CSV 的规格行（表头后的 Upper/Lower/Units 三行）。

    以第一列前缀识别，普通数据文件不会命中；排除后限制值（数字）与
    单位文本（uA/ohm 等）不再污染列类型判定与分组统计。
    """
    if df.height == 0:
        return df, 0
    series = df[df.columns[0]].cast(pl.Utf8)
    mask = None
    for prefix in _ATLAS_META_PREFIXES:
        part = series.str.starts_with(prefix).fill_null(False)
        mask = part if mask is None else (mask | part)
    count = int(mask.sum())
    if count == 0:
        return df, 0
    return df.filter(~mask), count


def find_fail_status_column(df: pl.DataFrame) -> str | None:
    """识别测试结果列；优先完整的 Test Pass/Fail Status 表头。

    普通箱线图数据没有该列时返回 None，调用方据此跳过过滤。
    """
    candidates = [
        name for name in df.columns if _FAIL_STATUS_COLUMN_RE.search(name.strip())
    ]
    if not candidates:
        return None
    for name in candidates:
        if name.strip().lower() == "test pass/fail status":
            return name
    return candidates[0]


def filter_fail_rows(df: pl.DataFrame, status_col: str) -> tuple[pl.DataFrame, int]:
    """排除状态值为 FAIL 的行（大小写与首尾空白不敏感）。

    返回 (过滤后的表, 排除行数)；空值与其它状态不计入排除。
    """
    status = df[status_col].cast(pl.Utf8).str.strip_chars().str.to_uppercase()
    mask = status.is_in(list(_FAIL_STATUS_VALUES)).fill_null(False)
    count = int(mask.sum())
    if count == 0:
        return df, 0
    return df.filter(~mask), count


def scan_columns(df: pl.DataFrame) -> list[ColumnInfo]:
    """推断各列类型：数值 dtype → numeric；日期 dtype → datetime；
    文本列按可数值化 / 可时间解析的比例判定。"""
    infos: list[ColumnInfo] = []
    for name in df.columns:
        series = df[name]
        null_count = series.null_count()
        if series.dtype.is_numeric():
            kind = "numeric"
        elif series.dtype in (pl.Date, pl.Datetime):
            kind = "datetime"
        elif series.dtype == pl.Utf8:
            if _looks_numeric(series):
                kind = "numeric"
            elif _looks_datetime(name, series):
                kind = "datetime"
            else:
                kind = "text"
        else:
            kind = "other"
        infos.append(
            ColumnInfo(
                name=name,
                kind=kind,
                non_null_count=series.len() - null_count,
                distinct_count=int(series.n_unique()),
            )
        )
    return infos


def list_group_values(
    df: pl.DataFrame, group_col: str, time_unit: str | None = None
) -> tuple[list[str], int, bool]:
    """列出分组列的唯一值（含空值占位），供前端筛选。

    time_unit 非空时先按时间粒度聚合（day / shift / hour）；
    返回 (选项, 唯一值总数, 是否因上限截断)。
    """
    if group_col not in df.columns:
        raise BoxPlotValidationError(f"分组列 '{group_col}' 不存在")
    keys = _group_keys(df, group_col, time_unit)
    unique = [str(value) for value in keys.unique().sort().to_list()]
    total = len(unique)
    truncated = total > MAX_GROUP_VALUE_OPTIONS
    return unique[:MAX_GROUP_VALUE_OPTIONS], total, truncated


def compute_groups(
    df: pl.DataFrame,
    value_col: str,
    group_col: str | None = None,
    quartile_method: str = "JMP",
    group_values: list[str] | None = None,
    time_unit: str | None = None,
) -> tuple[list[GroupStat], int, int]:
    """计算箱线图统计量。

    返回 (每组统计, 有效数值行数, 跳过行数)。数值列中的空值、无法解析
    为数字的文本以及 NaN / ±inf 等非有限值均视为无效并计入跳过。
    quartile_method 为 JMP（默认 Type 6）或 R7；须线始终按 Tukey 1.5×IQR。
    time_unit 非空时按 Start/End Time 等时间列的日/班次/小时桶分组；
    未提供分组列时 time_unit 会报错。
    """
    method = quartile_method.strip().upper()
    if method not in QUARTILE_METHODS:
        raise BoxPlotValidationError(
            f"分位算法 '{quartile_method}' 无效，可选 {', '.join(QUARTILE_METHODS)}"
        )
    if value_col not in df.columns:
        raise BoxPlotValidationError(f"数值列 '{value_col}' 不存在")
    if group_col is not None:
        if group_col not in df.columns:
            raise BoxPlotValidationError(f"分组列 '{group_col}' 不存在")
        if group_col == value_col:
            raise BoxPlotValidationError("数值列与分组列不能相同")
    elif time_unit is not None:
        raise BoxPlotValidationError("按时间粒度分组时必须提供分组列")

    raw = df[value_col].cast(pl.Float64, strict=False)
    # cast(strict=False) 只把解析失败置空；NaN / ±inf 是合法 float，
    # 会原样保留，必须在统计前统一转为 null 跳过。
    values = (
        pl.DataFrame({"_value": raw})
        .select(
            pl.when(pl.col("_value").is_finite())
            .then(pl.col("_value"))
            .otherwise(None)
            .alias("_value")
        )
        .to_series()
    )
    total_rows = df.height

    if group_col is None:
        used_rows = values.len() - values.null_count()
        stat = _summarize(values, "(全部)", method)
        if stat is None:
            raise BoxPlotValidationError(f"数值列 '{value_col}' 不含有效数值")
        return [stat], used_rows, total_rows - used_rows

    keys = _group_keys(df, group_col, time_unit)
    frame = pl.DataFrame({"_key": keys, "_value": values})
    if group_values:
        frame = frame.filter(pl.col("_key").is_in(group_values))

    # 仅对含有效数值的分组计数与迭代：全无效值的分组既不应触发
    # MAX_GROUPS 上限，也不会出现在响应里。
    usable = frame.filter(pl.col("_value").is_not_null())
    used_rows = usable.height
    if usable.height == 0:
        raise BoxPlotValidationError(f"数值列 '{value_col}' 不含有效数值")

    key_counts = usable.group_by("_key").len().sort("_key")
    if key_counts.height > MAX_GROUPS:
        if time_unit is not None:
            raise BoxPlotValidationError(
                f"时间分组过多（{key_counts.height} 组），上限为 {MAX_GROUPS} 组，"
                "请改用更粗的粒度或筛选分组值"
            )
        raise BoxPlotValidationError(
            f"分组过多（{key_counts.height} 组），上限为 {MAX_GROUPS} 组"
        )

    stats = [
        _summarize(usable.filter(pl.col("_key") == key)["_value"], str(key), method)
        for key in key_counts["_key"].to_list()
    ]
    return stats, used_rows, total_rows - used_rows


def _quantile(sorted_values: pl.Series, p: float, method: str) -> float:
    """在已排序序列上取分位。R7 走 polars linear；JMP 用官方 Type 6 公式。"""
    if method == "JMP":
        return _quantile_jmp_type6(sorted_values, p)
    return float(sorted_values.quantile(p, interpolation="linear"))


def _quantile_jmp_type6(sorted_values: pl.Series, p: float) -> float:
    """JMP Distribution 分位：r=(n+1)p，整数秩取该观测，否则相邻秩线性插值。"""
    n = sorted_values.len()
    if n == 1:
        return float(sorted_values[0])
    rank = (n + 1) * p
    if rank >= n:
        return float(sorted_values[n - 1])
    if rank <= 1:
        return float(sorted_values[0])
    index = int(rank)
    fraction = rank - index
    if fraction == 0:
        return float(sorted_values[index - 1])
    lower = float(sorted_values[index - 1])
    upper = float(sorted_values[index])
    return (1 - fraction) * lower + fraction * upper


def _summarize(values: pl.Series, name: str, method: str) -> GroupStat | None:
    """计算单组五数概括。有效样本为 0 时返回 None（组被跳过）。"""
    valid = values.drop_nulls()
    count = valid.len()
    if count == 0:
        return None

    valid = valid.sort()
    min_value = float(valid[0])
    max_value = float(valid[-1])
    q1 = _quantile(valid, 0.25, method)
    median = _quantile(valid, 0.5, method)
    q3 = _quantile(valid, 0.75, method)
    iqr = q3 - q1
    fence_low = q1 - IQR_FACTOR * iqr
    fence_high = q3 + IQR_FACTOR * iqr

    outlier_mask = (valid < fence_low) | (valid > fence_high)
    outliers_all = valid.filter(outlier_mask).to_list()
    inner = valid.filter(~outlier_mask)
    whisker_low = float(inner[0]) if inner.len() > 0 else min_value
    whisker_high = float(inner[-1]) if inner.len() > 0 else max_value

    outlier_count = len(outliers_all)
    return GroupStat(
        name=name,
        count=count,
        min=min_value,
        q1=q1,
        median=median,
        q3=q3,
        max=max_value,
        iqr=iqr,
        fence_low=fence_low,
        fence_high=fence_high,
        whisker_low=whisker_low,
        whisker_high=whisker_high,
        outlier_count=outlier_count,
        outliers=outliers_all[:MAX_OUTLIERS_PER_GROUP],
    )


def _looks_numeric(series: pl.Series) -> bool:
    """文本列能否作为数值列：可成功解析为数字的比例达标。"""
    total = series.len()
    if total == 0:
        return False
    parsed = series.cast(pl.Float64, strict=False)
    valid = parsed.len() - parsed.null_count()
    return valid / total >= NUMERIC_TEXT_RATIO


def _looks_datetime(name: str, series: pl.Series) -> bool:
    """列名命中时间特征且样本可解析为时间时，视为时间列。"""
    if not _DATETIME_COLUMN_RE.search(name.strip()):
        return False
    non_null = series.drop_nulls()
    if non_null.len() == 0:
        return False
    sample = non_null.head(200)
    parsed = sum(
        1 for value in sample.to_list() if _parse_datetime_value(str(value)) is not None
    )
    return parsed / sample.len() >= TIME_TEXT_RATIO


def _parse_datetime_value(raw: str) -> datetime | None:
    """解析一个时间单元格；兼容 ISO 与导出文件常见的斜杠/12 小时制。"""
    text = raw.strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass
    for fmt in _DATETIME_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _time_bucket_label(value: datetime, time_unit: str) -> str:
    """把时间点截断到日 / 8 小时班次 / 小时，返回可排序的 ISO 标签。"""
    if time_unit == "day":
        return value.strftime("%Y-%m-%d")
    hour = value.hour
    if time_unit == "shift":
        hour = (hour // SHIFT_HOURS) * SHIFT_HOURS
    return value.replace(hour=hour, minute=0, second=0, microsecond=0).strftime(
        "%Y-%m-%d %H:00"
    )


def _time_bucket_keys(series: pl.Series, time_unit: str) -> pl.Series:
    """逐行生成时间桶分组键；无法解析的时间归入「(无值)」。

    解析率不足 TIME_TEXT_RATIO 时拒绝分组，避免把格式不匹配的列
    静默塞进一个巨大的「(无值)」组。同一原始字符串只解析一次。
    """
    if time_unit not in TIME_UNITS:
        raise BoxPlotValidationError(
            f"时间粒度 '{time_unit}' 无效，可选 {', '.join(TIME_UNITS)}"
        )
    cache: dict[str, tuple[str, bool]] = {}
    labels: list[str] = []
    non_null = 0
    parsed = 0
    for raw in series.cast(pl.Utf8).to_list():
        text = "" if raw is None else str(raw).strip()
        if not text:
            labels.append(NULL_GROUP_LABEL)
            continue
        non_null += 1
        cached = cache.get(text)
        if cached is None:
            value = _parse_datetime_value(text)
            cached = (
                (_time_bucket_label(value, time_unit), True)
                if value is not None
                else (NULL_GROUP_LABEL, False)
            )
            cache[text] = cached
        label, valid = cached
        if valid:
            parsed += 1
        labels.append(label)
    if non_null == 0 or parsed / non_null < TIME_TEXT_RATIO:
        raise BoxPlotValidationError(
            f"列 '{series.name}' 无法解析为时间，不能按时间粒度分组"
        )
    return pl.Series("_key", labels, dtype=pl.Utf8)


def _group_keys(df: pl.DataFrame, group_col: str, time_unit: str | None) -> pl.Series:
    """生成分组键：普通列按原文，时间列按日/班次/小时桶。"""
    if time_unit is None:
        return df[group_col].cast(pl.Utf8).fill_null(NULL_GROUP_LABEL)
    return _time_bucket_keys(df[group_col], time_unit)

"""箱线图统计服务 — 纯逻辑、不依赖 Web 框架。

输入已解析的表格（polars DataFrame），输出各分组的五数概括
（min / Q1 / median / Q3 / max）、IQR、Tukey fences 与离群点。

分位数约定：Hyndman-Fan R7（线性插值），与 numpy.percentile 默认、
Excel QUARTILE.INC 以及 polars quantile(interpolation="linear") 完全一致，
避免用户对照主流工具产生差异。
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import polars as pl

# Tukey fences 的 IQR 乘数（1.5×IQR），业界标准
IQR_FACTOR = 1.5
# 每组回传的离群点上限：仅用于渲染，超出部分只计入 outlier_count
MAX_OUTLIERS_PER_GROUP = 500
# 分组上限：防止基数过大的分组列把响应与渲染撑爆
MAX_GROUPS = 60
# 列类型推断的采样行数（columns 接口）
SAMPLE_ROWS = 10_000
# 数据预览返回的行数（columns 接口，供用户确认选列）
PREVIEW_ROWS = 5
# 文本列判定"可数值化"的最低有效比例（0.9 = 容忍少量脏单元格）
NUMERIC_TEXT_RATIO = 0.9

# AtlasLog 四行范式 CSV 的规格行前缀（表头后的上限/下限/单位行）
_ATLAS_META_PREFIXES = (
    "Upper Limited",
    "Lower Limited",
    "Measurement Units",
)


class BoxPlotValidationError(ValueError):
    """输入数据无法计算箱线图时抛出的校验错误。"""


@dataclass(frozen=True)
class ColumnInfo:
    """单列的类型推断结果。"""

    name: str
    # "numeric"：可作数值列；"text"：可作分组列；"other"：其它（仅可分组）
    kind: str
    non_null_count: int


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
        return pl.read_excel(path)
    if suffix not in {".csv", ".tsv"}:
        raise BoxPlotValidationError(f"不支持的文件类型: {suffix or '(无扩展名)'}")
    return _read_csv(path)


def _read_csv(path: Path) -> pl.DataFrame:
    """检测编码与分隔符后读取 CSV。

    polars 对非 UTF-8 字节采用 lossy 替换而非报错，无法靠异常触发回退，
    因此先对采样字节做严格的 UTF-8 校验：不合法则按 GB18030 解码再解析。
    """
    head = path.read_bytes()[:SAMPLE_BYTES]
    separator = _detect_separator(head)
    if not _is_valid_utf8(head):
        return _read_csv_encoded(path, separator)
    try:
        return pl.read_csv(path, separator=separator)
    except pl.exceptions.NoDataError as exc:
        raise BoxPlotValidationError("CSV 文件没有可解析的数据行") from exc
    except pl.exceptions.PolarsError as exc:
        raise BoxPlotValidationError("无法解析 CSV 文件") from exc


def _is_valid_utf8(data: bytes) -> bool:
    """严格 UTF-8 校验：BOM 合法；GB18030 等其它多字节编码在此失败。"""
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def _read_csv_encoded(path: Path, separator: str) -> pl.DataFrame:
    """非 UTF-8 文件：按 GB18030 解码后写入临时 UTF-8 文件再解析。"""
    data = path.read_bytes()
    try:
        text = data.decode("gb18030")
    except UnicodeDecodeError as exc:
        raise BoxPlotValidationError(
            "无法识别 CSV 编码（已尝试 UTF-8 与 GB18030）"
        ) from exc

    fd, tmp_name = tempfile.mkstemp(suffix=".csv")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        try:
            return pl.read_csv(tmp_name, separator=separator)
        except pl.exceptions.PolarsError as exc:
            raise BoxPlotValidationError("无法解析 CSV 文件") from exc
    finally:
        os.unlink(tmp_name)


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


def scan_columns(df: pl.DataFrame) -> list[ColumnInfo]:
    """推断各列类型：数值 dtype → numeric；文本列按可数值化比例判定。"""
    infos: list[ColumnInfo] = []
    for name in df.columns:
        series = df[name]
        null_count = series.null_count()
        if series.dtype.is_numeric():
            kind = "numeric"
        elif series.dtype == pl.Utf8:
            kind = "numeric" if _looks_numeric(series) else "text"
        else:
            kind = "other"
        infos.append(
            ColumnInfo(name=name, kind=kind, non_null_count=series.len() - null_count)
        )
    return infos


def compute_groups(
    df: pl.DataFrame,
    value_col: str,
    group_col: str | None = None,
) -> tuple[list[GroupStat], int, int]:
    """计算箱线图统计量。

    返回 (每组统计, 有效数值行数, 跳过行数)。数值列中的空值与
    无法解析为数字的文本均视为无效并计入跳过。
    """
    if value_col not in df.columns:
        raise BoxPlotValidationError(f"数值列 '{value_col}' 不存在")
    if group_col is not None:
        if group_col not in df.columns:
            raise BoxPlotValidationError(f"分组列 '{group_col}' 不存在")
        if group_col == value_col:
            raise BoxPlotValidationError("数值列与分组列不能相同")

    values = df[value_col].cast(pl.Float64, strict=False)
    total_rows = df.height
    used_rows = values.len() - values.null_count()

    if group_col is None:
        stat = _summarize(values, "(全部)")
        if stat is None:
            raise BoxPlotValidationError(f"数值列 '{value_col}' 不含有效数值")
        return [stat], used_rows, total_rows - used_rows

    keys = df[group_col].cast(pl.Utf8).fill_null("(无值)")
    frame = pl.DataFrame({"_key": keys, "_value": values})

    key_counts = frame.group_by("_key").len().sort("_key")
    if key_counts.height > MAX_GROUPS:
        raise BoxPlotValidationError(
            f"分组过多（{key_counts.height} 组），上限为 {MAX_GROUPS} 组"
        )

    stats: list[GroupStat] = []
    for key in key_counts["_key"].to_list():
        sub = frame.filter(pl.col("_key") == key)
        stat = _summarize(sub["_value"], str(key))
        if stat is not None:
            stats.append(stat)
    if not stats:
        raise BoxPlotValidationError(f"数值列 '{value_col}' 不含有效数值")

    return stats, used_rows, total_rows - used_rows


def _summarize(values: pl.Series, name: str) -> GroupStat | None:
    """计算单组五数概括。有效样本为 0 时返回 None（组被跳过）。"""
    valid = values.drop_nulls()
    count = valid.len()
    if count == 0:
        return None

    valid = valid.sort()
    min_value = float(valid[0])
    max_value = float(valid[-1])
    q1 = float(valid.quantile(0.25, interpolation="linear"))
    median = float(valid.quantile(0.5, interpolation="linear"))
    q3 = float(valid.quantile(0.75, interpolation="linear"))
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

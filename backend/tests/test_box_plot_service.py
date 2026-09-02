"""箱线图服务的边界行为测试。

覆盖 CodeRabbit PR #62 指出的三类问题：
- 损坏 Excel 文件解析异常必须转译为 BoxPlotValidationError（而非 500）；
- 数值列中的 NaN / ±inf 非有限值必须与空值同等跳过；
- 全部无效值的分组不应触发 MAX_GROUPS 上限。
"""

from __future__ import annotations

import zipfile

import polars as pl
import pytest

from app.services.boxplot.service import (
    MAX_GROUPS,
    BoxPlotValidationError,
    compute_groups,
    list_group_values,
    read_tabular,
)


def _write_corrupt_xlsx(path, payload: bytes = b"not an Excel workbook") -> None:
    path.write_bytes(payload)


def test_read_tabular_corrupt_xlsx_raises_validation_error(tmp_path):
    """垃圾字节的 .xlsx 应报校验错误，而不是 fastexcel/calamine 原始异常。"""
    target = tmp_path / "upload.part"
    _write_corrupt_xlsx(target)
    with pytest.raises(BoxPlotValidationError, match="无法解析 Excel 文件"):
        read_tabular(target, original_filename="data.xlsx")


def test_read_tabular_empty_and_broken_zip_xlsx(tmp_path):
    """空文件与缺关键条目的 zip 同样转译为校验错误。"""
    empty = tmp_path / "empty.xlsx"
    _write_corrupt_xlsx(empty, b"")
    with pytest.raises(BoxPlotValidationError):
        read_tabular(empty, original_filename="data.xlsx")

    broken = tmp_path / "broken.xlsx"
    with zipfile.ZipFile(broken, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
    with pytest.raises(BoxPlotValidationError):
        read_tabular(broken, original_filename="data.xls")


def test_read_tabular_unsupported_suffix(tmp_path):
    target = tmp_path / "upload.part"
    target.write_text("x")
    with pytest.raises(BoxPlotValidationError, match="不支持的文件类型"):
        read_tabular(target, original_filename="data.parquet")


def test_compute_groups_skips_non_finite_values():
    """NaN / +inf / -inf 与空值一样不计入 used_rows 和统计量。"""
    df = pl.DataFrame(
        {
            "group": ["a", "a", "a", "a", None, None],
            "value": [1.0, 2.0, float("nan"), float("inf"), float("-inf"), None],
        }
    )
    stats, used_rows, skipped_rows = compute_groups(df, "value", "group")

    assert len(stats) == 1
    stat = stats[0]
    assert stat.name == "a"
    # 仅 1.0、2.0 有效；NaN/±inf/null 共 4 行全部跳过
    assert stat.count == 2
    assert used_rows == 2
    assert skipped_rows == 4


def test_compute_groups_all_invalid_groups_not_counted_against_max_groups():
    """61 个全无效组 + 1 个有效组：有效组正常返回，无效组不触发上限。"""
    n_invalid = MAX_GROUPS + 1
    df = pl.DataFrame(
        {
            "group": [f"invalid-{i}" for i in range(n_invalid)] + ["valid"],
            "value": ["not-a-number"] * n_invalid + ["42"],
        }
    )
    stats, used_rows, skipped_rows = compute_groups(df, "value", "group")

    assert [s.name for s in stats] == ["valid"]
    assert stats[0].count == 1
    assert used_rows == 1
    assert skipped_rows == df.height - 1


def test_compute_groups_exceeding_max_usable_groups_still_rejected():
    """上限检查针对的是有可用数值的分组，超限仍应拒绝。"""
    df = pl.DataFrame(
        {
            "group": [f"g{i}" for i in range(MAX_GROUPS + 1)],
            "value": list(range(MAX_GROUPS + 1)),
        }
    )
    with pytest.raises(BoxPlotValidationError, match="分组过多"):
        compute_groups(df, "value", "group")


def test_compute_groups_no_group_column_skips_non_finite():
    """无分组列时同样过滤非有限值。"""
    df = pl.DataFrame({"value": [1.0, float("nan"), 3.0]})
    stats, used_rows, skipped_rows = compute_groups(df, "value")

    assert stats[0].count == 2
    assert used_rows == 2
    assert skipped_rows == 1


def test_compute_groups_all_non_finite_rejected():
    df = pl.DataFrame({"value": [float("inf"), float("-inf"), float("nan")]})
    with pytest.raises(BoxPlotValidationError, match="不含有效数值"):
        compute_groups(df, "value")


def test_compute_groups_jmp_type6_matches_jmp_help_example():
    """JMP Distribution 分位：r=(n+1)p，n=15 时 Q1=y4、Q3=y12（官方帮助例的同一套公式）。"""
    df = pl.DataFrame({"value": list(range(1, 16))})
    stats, used_rows, skipped_rows = compute_groups(df, "value", quartile_method="JMP")

    assert used_rows == 15
    assert skipped_rows == 0
    stat = stats[0]
    assert stat.q1 == 4.0
    assert stat.median == 8.0
    assert stat.q3 == 12.0
    assert stat.iqr == 8.0
    assert stat.fence_low == pytest.approx(4.0 - 1.5 * 8.0)
    assert stat.fence_high == pytest.approx(12.0 + 1.5 * 8.0)
    assert stat.whisker_low == 1.0
    assert stat.whisker_high == 15.0
    assert stat.outlier_count == 0


def test_compute_groups_r7_default_differs_from_jmp_on_quartiles():
    """默认 JMP Type 6；R7 仍可选且四分位不同。"""
    df = pl.DataFrame({"value": list(range(1, 16))})
    r7, _, _ = compute_groups(df, "value", quartile_method="R7")
    jmp, _, _ = compute_groups(df, "value")

    assert r7[0].q1 == pytest.approx(4.5)
    assert r7[0].q3 == pytest.approx(11.5)
    assert r7[0].q1 != jmp[0].q1
    assert r7[0].q3 != jmp[0].q3


def test_compute_groups_jmp_flags_outlier_when_beyond_type6_fence():
    """Type 6 围栏与 R7 不同时，离群判定跟随所选分位。"""
    df = pl.DataFrame({"value": [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]})
    jmp, _, _ = compute_groups(df, "value", quartile_method="JMP")
    stat = jmp[0]
    assert stat.q1 == pytest.approx(2.75)
    assert stat.q3 == pytest.approx(8.25)
    assert stat.outlier_count == 1
    assert stat.outliers == [100.0]
    assert stat.whisker_high == 9.0


def test_compute_groups_rejects_unknown_quartile_method():
    df = pl.DataFrame({"value": [1.0, 2.0, 3.0]})
    with pytest.raises(BoxPlotValidationError, match="分位算法"):
        compute_groups(df, "value", quartile_method="R6")


def test_list_group_values_sorts_and_maps_null():
    df = pl.DataFrame({"station": ["B", None, "A", "A"]})
    values, total, truncated = list_group_values(df, "station")
    assert values == ["(无值)", "A", "B"]
    assert total == 3
    assert truncated is False


def test_compute_groups_filters_by_group_values():
    df = pl.DataFrame(
        {
            "group": ["a", "a", "b", "b", "c", "c"],
            "value": [1.0, 2.0, 10.0, 20.0, 100.0, 200.0],
        }
    )
    stats, used_rows, skipped_rows = compute_groups(
        df, "value", "group", group_values=["a", "c"]
    )
    assert [s.name for s in stats] == ["a", "c"]
    assert used_rows == 4
    assert skipped_rows == 2


def test_compute_groups_empty_group_values_means_all():
    df = pl.DataFrame({"group": ["a", "b"], "value": [1.0, 2.0]})
    stats, _, _ = compute_groups(df, "value", "group", group_values=[])
    assert [s.name for s in stats] == ["a", "b"]

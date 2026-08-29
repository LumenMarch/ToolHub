"""导出过滤：SFC/Notes 带 A:/D: 前缀的对比键正确匹配资产/设备编号列。"""

import polars as pl

from app.api.endpoints.asset_comparison import (
    _filter_by_prefixed_keys,
    _pick_sfc_columns,
)


def test_pick_sfc_columns_prefers_simplified_chinese():
    df = pl.DataFrame(
        {
            "设备名称": ["儀器A"],
            "资产编号": ["13-FD-X001"],
            "设备编号": ["DEV-001"],
            "保管人": ["張三"],
        }
    )
    name_col, asset_col, device_col = _pick_sfc_columns(df)
    assert name_col == "设备名称"
    assert asset_col == "资产编号"
    assert device_col == "设备编号"


def test_filter_prefixed_keys_matches_asset_and_device():
    df = pl.DataFrame(
        {
            "资产编号": ["A001", "A002", None],
            "设备编号": [None, "DEV-002", "DEV-003"],
            "设备名称": ["儀器1", "儀器2", "儀器3"],
            "保管人": ["張三", "李四", "王五"],
        }
    )
    keys = ["A:A001", "D:DEV-003"]
    result = _filter_by_prefixed_keys(
        df, keys, asset_col="资产编号", device_col="设备编号"
    )
    # A:A001 → 资产编号 A001；D:DEV-003 → 设备编号 DEV-003（资产编号为空降级）
    assert result.height == 2
    assert set(result["设备名称"].to_list()) == {"儀器1", "儀器3"}


def test_filter_prefixed_keys_returns_empty_when_no_match():
    df = pl.DataFrame({"资产编号": ["B001"]})
    result = _filter_by_prefixed_keys(df, ["A:A001"], "资产编号", None)
    assert result.is_empty()

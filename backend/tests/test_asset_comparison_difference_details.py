"""差异明细统计：维度去重与维度筛选。"""

import polars as pl

from app.services.asset_comparison.difference_details import (
    build_difference_details,
)


class _FakeFinance:
    """模拟 ff 模块实例：A001 同时命中保管人/部门维度，A002 为保管人/部门减少。"""

    this_Finance_data = pl.DataFrame(
        {
            "資產名稱": ["設備A", "設備A", "設備B"],
            "資產編號": ["A001", "A001", "A002"],
            "資產所屬部門代號": ["DEPT1", "DEPT1", "DEPT3"],
            "保管人員": ["張三", "張三", "王五"],
        }
    )
    last_Finance_data = pl.DataFrame(
        {
            "資產名稱": ["設備A", "設備B"],
            "資產編號": ["A001", "A002"],
            "資產所屬部門代號": ["DEPT2", "DEPT4"],
            "保管人員": ["李四", "趙六"],
        }
    )
    new_Custodian_assets = ["A001"]
    new_Department_assets = ["A001"]
    removed_Custodian_assets = ["A002"]
    removed_Department_assets = ["A002"]
    check_Custodian = ["A001"]
    check_Department = ["A001"]


def test_difference_records_deduplicated_across_dimensions():
    result = build_difference_details(
        module_key="ff",
        instance=_FakeFinance(),
        change_type="all",
        limit=50,
    )
    # 总数按资产编号去重：A001 / A002 各一条 → all = 2
    assert result["totals"]["all"] == 2
    # 全部明细展示每个维度的差异证据：A001 同时命中保管人/部门维度，因此出现多条
    ids = [r["identifier"] for r in result["records"]]
    assert "A001" in ids
    assert "A002" in ids


def test_dimension_totals_count_each_dimension_independently():
    result = build_difference_details(
        module_key="ff",
        instance=_FakeFinance(),
        change_type="all",
        limit=50,
    )
    # A001 同时是保管人新增与部门新增，两个维度各自计 1
    assert result["totals"]["custodianNew"] == 1
    assert result["totals"]["deptNew"] == 1
    assert result["totals"]["custodianRemoved"] == 1
    assert result["totals"]["deptRemoved"] == 1
    assert result["totals"]["anomaly"] == 1


def test_dimension_filter_returns_only_that_dimension():
    result = build_difference_details(
        module_key="ff",
        instance=_FakeFinance(),
        change_type="custodianNew",
        limit=50,
    )
    assert result["filteredTotal"] == 1
    assert result["records"][0]["identifier"] == "A001"
    assert "依保管人" in result["records"][0]["dimension"]
    assert result["records"][0]["changeType"] == "new"

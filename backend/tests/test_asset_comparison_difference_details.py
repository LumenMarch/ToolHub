"""差异明细统计去重：同一资产编号命中多个差异维度时只计一条。"""

import polars as pl

from app.services.asset_comparison.difference_details import (
    build_difference_details,
)


class _FakeFinance:
    """模拟 ff 模块实例：A001 同时命中保管人/部门维度。"""

    this_Finance_data = pl.DataFrame(
        {
            "資產名稱": ["設備A", "設備A"],
            "資產編號": ["A001", "A001"],
            "資產所屬部門代號": ["DEPT1", "DEPT1"],
            "保管人員": ["張三", "張三"],
        }
    )
    last_Finance_data = pl.DataFrame(
        {
            "資產名稱": ["設備A"],
            "資產編號": ["A001"],
            "資產所屬部門代號": ["DEPT2"],
            "保管人員": ["李四"],
        }
    )
    new_Custodian_assets = ["A001"]
    new_Department_assets = ["A001"]
    removed_Custodian_assets = ["A002"]
    removed_Department_assets = ["A002"]
    check_Custodian = ["A001"]
    check_Department = ["A001"]


def test_difference_totals_deduplicated_across_dimensions():
    result = build_difference_details(
        module_key="ff",
        instance=_FakeFinance(),
        change_type="all",
        limit=50,
    )
    # A001 命中 4 条（保管人/部门 × 新增/异常），去重后只计 1 条
    assert result["totals"]["all"] == 2
    assert result["filteredTotal"] == 2
    ids = [r["identifier"] for r in result["records"]]
    assert ids.count("A001") == 1


def test_difference_totals_priority_anomaly_over_new():
    result = build_difference_details(
        module_key="ff",
        instance=_FakeFinance(),
        change_type="all",
        limit=50,
    )
    a001 = next(r for r in result["records"] if r["identifier"] == "A001")
    assert a001["changeType"] == "anomaly"

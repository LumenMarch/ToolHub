"""重测率统计（retest-rate）请求/响应模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    """tus 上传完成后的 upload_id 列表，顺序即分析顺序。

    首个文件用于识别格式与解析测试项规格（与原桌面工具一致）。
    """

    upload_ids: list[str] = Field(..., min_length=1, description="上传文件 ID 列表")


class OverviewRow(BaseModel):
    """数据概览行：计数与占比（占比为 0-1 的小数，展示层格式化）。"""

    key: str
    value: int
    rate: float | None = None


class TimeStatRow(BaseModel):
    """测试时间统计行（秒）；最大/最小行附带 SN 与结果状态。"""

    key: str
    seconds: float
    sn: str | None = None
    status: str | None = None


class RetestStatRow(BaseModel):
    """重测次数分档行；首次 PASS 档不返回 SN 清单。"""

    key: str
    count: int
    rate: float
    sn_list: list[str]


class StationSlotRow(BaseModel):
    """Station|Slot 组合统计（按 SN 首条记录归属）。"""

    station_id: str
    slot_id: str
    total_sn: int
    retest_sn: int
    retest_rate: float
    pure_fail_sn: int
    pure_fail_rate: float


class RetestDetailRow(BaseModel):
    """重测项目明细的逐 SN 行：第一次 FAIL / 第二次 FAIL / 最终 PASS。"""

    sn: str
    first_fail_value: str
    first_fail_station: str
    first_fail_slot: str
    second_fail_value: str
    second_fail_station: str
    second_fail_slot: str
    pass_value: str
    pass_station: str
    pass_slot: str


class RetestItemDetail(BaseModel):
    """单个测试项的重测明细（该 SN 最终 PASS）。"""

    name: str
    count: int
    rate: float
    spec: str
    rows: list[RetestDetailRow]


class DefectDetailRow(BaseModel):
    """不良项目明细的逐 SN 行：第一次 FAIL 后的前三次测试值。"""

    sn: str
    first_fail_value: str
    first_fail_station: str
    first_fail_slot: str
    second_test_value: str
    second_test_station: str
    second_test_slot: str
    third_test_value: str
    third_test_station: str
    third_test_slot: str


class DefectItemDetail(BaseModel):
    """单个测试项的不良明细（该 SN 从未 PASS）。"""

    name: str
    count: int
    rate: float
    spec: str
    rows: list[DefectDetailRow]


class AnalyzeResponse(BaseModel):
    """重测率统计完整结果。"""

    csv_format: str
    station_info: str
    version_info: str
    total_rows: int
    file_count: int
    overview: list[OverviewRow]
    time_stats: list[TimeStatRow]
    retest_stats: list[RetestStatRow]
    station_slot: list[StationSlotRow]
    retest_details: list[RetestItemDetail]
    defect_details: list[DefectItemDetail]

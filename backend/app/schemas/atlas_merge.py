"""atlas-merge 接口响应模型。"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class AtlasMergeAnalyzeResponse(BaseModel):
    """合并完成载荷（done 状态下的完整字段，与同步时代的 analyze 响应完全一致）。

    真实归档的测量列可达上千列，只携带表格骨架所需的预览数据：
    元数据列 + 前 N 个测量列 + 总列数；完整 CSV 走 download 端点。
    """

    result_id: str
    download_filename: str
    expires_at: datetime
    # 产出数据行的 unit 数（按 SerialNumber 去重）
    unit_count: int
    # 总行数（每个 unit 的每次 run 一行）
    run_count: int
    # 数据文件读取失败的记录（形如 "JMV001 [run 2]: 数据文件读取失败"）
    parse_errors: list[str]
    # 实际使用的数据来源（System / User）
    data_source: str
    # 固定 8 个元数据列名
    metadata_columns: list[str]
    # 前 N 个测量列名（预览用）
    preview_measurement_columns: list[str]
    # 测量列总数（含未进预览的列）
    total_measurement_columns: int
    # 元数据列 + 前 N 个测量列（前端表格骨架）
    columns: list[str]
    # 前 N 行数据（仅预览列）
    rows_preview: list[list[str]]


class AnalyzeAcceptedResponse(BaseModel):
    """analyze 立即返回的 202 载荷：任务已受理，进度走 jobs 轮询。"""

    job_id: str


JobStatus = Literal["queued", "running", "done", "error"]


class JobResponse(BaseModel):
    """合并任务进度/结果响应（GET /jobs/{job_id}）。

    按状态取字段：
    - queued/running：仅 status/done/total（total 排队时可为 0，running 时为 unit 总数）
    - done：status + AtlasMergeAnalyzeResponse 全部字段
    - error：status + error（失败原因）
    """

    status: JobStatus
    done: int = 0
    total: int = 0
    # done 状态字段
    result_id: str | None = None
    download_filename: str | None = None
    expires_at: datetime | None = None
    unit_count: int | None = None
    run_count: int | None = None
    parse_errors: list[str] | None = None
    data_source: str | None = None
    metadata_columns: list[str] | None = None
    preview_measurement_columns: list[str] | None = None
    total_measurement_columns: int | None = None
    columns: list[str] | None = None
    rows_preview: list[list[str]] | None = None
    # error 状态字段
    error: str | None = None

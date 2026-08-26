"""box-plot 接口响应模型。"""

from typing import Literal

from pydantic import BaseModel, Field


class BoxPlotColumnsRequest(BaseModel):
    """列类型预览请求，引用已完成的 tus 上传。"""

    upload_id: str = Field(..., min_length=1, description="数据文件上传 ID")


class BoxPlotAnalyzeRequest(BaseModel):
    """箱线图分析请求：数值列必填，分组列可选（缺省全量单组）。"""

    upload_id: str = Field(..., min_length=1, description="数据文件上传 ID")
    value_col: str = Field(..., min_length=1, description="数值列名")
    group_col: str | None = Field(default=None, description="分组列名，缺省不分组")


class ColumnMeta(BaseModel):
    """单列类型推断结果。"""

    name: str
    kind: Literal["numeric", "text", "other"]
    non_null_count: int


class ColumnsResponse(BaseModel):
    """列预览载荷：前端据此生成数值列 / 分组列下拉选项。"""

    filename: str
    rows: int
    # 类型按前 SAMPLE_ROWS 行推断（大文件不整读）
    sampled: bool
    columns: list[ColumnMeta]
    # 数据预览（前 PREVIEW_ROWS 行，列顺序与 columns 一致），供用户确认选列
    preview_columns: list[str]
    preview_rows: list[list[str]]
    # 自动排除的 AtlasLog 规格行数（上限/下限/单位行）
    excluded_rows: int = 0


class GroupStatModel(BaseModel):
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
    # 渲染用离群点（每组上限 500），完整数量看 outlier_count
    outliers: list[float]


class AnalyzeResponse(BaseModel):
    """箱线图统计载荷。"""

    filename: str
    value_column: str
    group_column: str | None
    # 分位数算法约定（Hyndman-Fan R7，与 numpy / Excel QUARTILE.INC 一致）
    quartile_method: str = "R7 (linear)"
    # 后端按 Tukey fences 计算；前端可切换 min-max 仅影响渲染
    whisker: str = "tukey"
    total_rows: int
    used_rows: int
    skipped_rows: int
    groups: list[GroupStatModel]

"""tt-time 分析建议接口模型。"""

from pydantic import BaseModel, Field


class TtTimeStats(BaseModel):
    """测试时间五数概括（单位：秒）。"""

    count: int = 0
    min: float | None = None
    max: float | None = None
    q1: float | None = None
    q2: float | None = None
    q3: float | None = None


class TtTimeBin(BaseModel):
    """单个测试时间分箱。"""

    label: str
    count: int
    percent: float


class TtTimeStationCount(BaseModel):
    """单个机台的样本条数。"""

    id: str
    count: int


class TtTimeTail(BaseModel):
    """基于真实样本的长尾统计（由前端精确算出）。"""

    iqrThreshold: float = 0
    outlierCount: int = 0
    outlierPercent: float = 0


class TtTimeAnalyzeRequest(BaseModel):
    """分析请求：前端在当前筛选下算好的统计结构（不传原始 CSV）。"""

    fileName: str = Field(default="", description="源文件名")
    stationFilter: str = Field(default="all", description="当前筛选机台，all 表示全部")
    totalRows: int = Field(default=0, ge=0, description="当前筛选下的样本条数")
    stats: TtTimeStats = Field(default_factory=TtTimeStats)
    distribution: list[TtTimeBin] = Field(default_factory=list)
    percentiles: dict[str, float] = Field(default_factory=dict)
    tail: TtTimeTail = Field(default_factory=TtTimeTail)
    stations: list[TtTimeStationCount] = Field(default_factory=list)


class TtTimeAnalyzeResponse(BaseModel):
    """分析结论载荷。"""

    advice: str
    model: str
    elapsedMs: int
    error: str | None = None

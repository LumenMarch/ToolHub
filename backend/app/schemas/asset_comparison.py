from pydantic import BaseModel, ConfigDict, Field


class AssetComparisonJobCreate(BaseModel):
    """创建核对任务的请求体。

    输入文件不直接传路径：客户端先上传文件并调用 /tools/asset/scan 得到
    scan_id，本请求仅引用该扫描会话；文件定位完全由服务端在受管目录内完成。
    """

    model_config = ConfigDict(extra="forbid")

    scanId: str = Field(
        ...,
        min_length=8,
        max_length=128,
        description="扫描会话 ID（/tools/asset/scan 返回）",
    )
    clientRequestId: str = Field(..., min_length=8, max_length=64)


class AssetComparisonAnnotationsUpdate(BaseModel):
    expectedRevision: int = Field(..., ge=0)
    remarks: dict[str, str] = Field(default_factory=dict)
    reviews: dict[str, str] = Field(default_factory=dict)

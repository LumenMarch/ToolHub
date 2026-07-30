from pydantic import BaseModel, Field


class AssetComparisonJobCreate(BaseModel):
    thisFinance: str
    lastFinance: str
    thisSFC: str
    lastSFC: str
    thisNotes: str
    lastNotes: str
    thisCustomer: str
    lastCustomer: str
    departmentData: str
    custodianData: str
    driData: str
    clientRequestId: str = Field(..., min_length=8, max_length=64)


class AssetComparisonAnnotationsUpdate(BaseModel):
    expectedRevision: int = Field(..., ge=0)
    remarks: dict[str, str] = Field(default_factory=dict)
    reviews: dict[str, str] = Field(default_factory=dict)

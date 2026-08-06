"""health 工具端点：健康评估。Requires authentication + tool:use。"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import require_permission, require_tool_enabled
from app.models.user import User
from app.services.health_tools.service import calculate_health

router = APIRouter()

VALID_GENDERS = ("male", "female")


class HealthRequest(BaseModel):
    """健康评估请求参数，全部必填（缺失时手动返回 400 对齐 60s 文案）。"""

    height: float | None = None
    weight: float | None = None
    gender: str | None = None
    age: int | None = None


@router.post("/calculate")
def calculate(
    request: HealthRequest,
    current_user: User = Depends(require_permission("tool:use")),
    __: None = Depends(require_tool_enabled("health")),
):
    """计算健康评估报告（BMI、代谢、体脂、三围等）。Requires authentication."""
    if (
        request.height is None
        or request.weight is None
        or request.gender is None
        or request.age is None
    ):
        raise HTTPException(
            status_code=400,
            detail="参数 height, weight, gender, age 不能为空",
        )

    if request.gender not in VALID_GENDERS:
        raise HTTPException(
            status_code=400,
            detail='参数 gender 必须是 "male" 或 "female"',
        )

    if (
        request.height < 50
        or request.height > 300
        or request.weight < 10
        or request.weight > 300
        or request.age < 1
        or request.age > 150
    ):
        raise HTTPException(
            status_code=400,
            detail="参数超出合理范围：身高 (50-300cm)，体重 (10-300kg)，年龄 (1-150岁)",
        )

    return {
        "result": calculate_health(
            request.height, request.weight, request.gender, request.age
        )
    }

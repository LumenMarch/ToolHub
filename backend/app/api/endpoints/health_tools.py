"""health 工具端点：健康评估。Requires authentication + tool:health:use。"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.services.audit import log_action
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
    request: Request,
    req: HealthRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("health")),
):
    """计算健康评估报告（BMI、代谢、体脂、三围等）。Requires authentication."""
    if (
        req.height is None
        or req.weight is None
        or req.gender is None
        or req.age is None
    ):
        raise HTTPException(
            status_code=400,
            detail="参数 height, weight, gender, age 不能为空",
        )

    if req.gender not in VALID_GENDERS:
        raise HTTPException(
            status_code=400,
            detail='参数 gender 必须是 "male" 或 "female"',
        )

    if (
        req.height < 50
        or req.height > 300
        or req.weight < 10
        or req.weight > 300
        or req.age < 1
        or req.age > 150
    ):
        raise HTTPException(
            status_code=400,
            detail="参数超出合理范围：身高 (50-300cm)，体重 (10-300kg)，年龄 (1-150岁)",
        )

    result = calculate_health(req.height, req.weight, req.gender, req.age)
    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.health.calculate",
        target_type="tool",
        target_id="health",
        # 摘要记录性别与年龄，不落身高体重等敏感指标
        detail={"gender": req.gender, "age": req.age},
    )
    return {"result": result}

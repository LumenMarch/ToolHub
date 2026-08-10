import base64
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.auth import require_tool_permission
from app.models.user import User
from app.services.audit import log_action
from app.services.sixty_seconds.daily import get_daily_image, get_daily_news
from app.services.sixty_seconds.service import get_random_hitokoto

router = APIRouter()


class DailyRequest(BaseModel):
    date: str | None = None  # YYYY-MM-DD，缺省今天
    force_update: bool = False  # true 时绕过缓存重新拉取


class ImageRequest(BaseModel):
    date: str | None = None  # YYYY-MM-DD，缺省今天
    force_update: bool = False  # true 时绕过缓存重新拉取


@router.post("/daily")
def get_sixty_seconds_daily(
    request: Request,
    req: DailyRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("sixty-seconds")),
):
    """60s 每日新闻。Requires authentication."""
    if req.date is not None:
        try:
            datetime.strptime(req.date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=400, detail="日期格式无效,应为 YYYY-MM-DD"
            ) from None

    data = get_daily_news(date=req.date, force_update=req.force_update)
    if data is None:
        raise HTTPException(status_code=502, detail="获取 60s 数据失败,请稍后重试")
    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.sixty_seconds.daily",
        target_type="tool",
        target_id="sixty-seconds",
        detail={"date": req.date, "force_update": req.force_update},
    )
    return {"result": data}


@router.post("/image")
def get_sixty_seconds_image(
    request: Request,
    req: ImageRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(require_tool_permission("sixty-seconds")),
):
    """60s 每日新闻图片。Requires authentication."""
    if req.date is not None:
        try:
            datetime.strptime(req.date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(
                status_code=400, detail="日期格式无效,应为 YYYY-MM-DD"
            ) from None

    data = get_daily_image(date=req.date, force_update=req.force_update)
    if data is None:
        raise HTTPException(status_code=502, detail="获取 60s 图片失败,请稍后重试")

    date_str, img_bytes = data
    b64_str = base64.b64encode(img_bytes).decode("ascii")
    data_uri = f"data:image/png;base64,{b64_str}"

    log_action(
        db,
        request=request,
        user=current_user,
        action="tool.sixty_seconds.image",
        target_type="tool",
        target_id="sixty-seconds",
        detail={"date": req.date, "force_update": req.force_update},
    )
    return {
        "result": {
            "date": date_str,
            "mime_type": "image/png",
            "base64": b64_str,
            "data_uri": data_uri,
        }
    }


@router.get("/hitokoto")
def get_hitokoto():
    """随机返回一条每日一言。无需认证，登录页可直接调用。"""
    return get_random_hitokoto()

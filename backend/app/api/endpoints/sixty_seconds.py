from fastapi import APIRouter

from app.services.sixty_seconds.service import get_random_hitokoto

router = APIRouter()


@router.get("/hitokoto")
def get_hitokoto():
    """随机返回一条每日一言。无需认证，登录页可直接调用。"""
    return get_random_hitokoto()

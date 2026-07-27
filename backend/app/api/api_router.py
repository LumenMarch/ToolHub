from fastapi import APIRouter

from app.api.endpoints import (
    asset_comparison,
    attendance,
    auth,
    sixty_seconds,
    string_tools,
    users,
)

# Unified API Router
api_router = APIRouter()

# Register core endpoints
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])

# Register Tool endpoints dynamically
# To add a new tool, import its router and include it here
api_router.include_router(
    string_tools.router, prefix="/tools/string", tags=["string_tools"]
)
api_router.include_router(
    asset_comparison.router, prefix="/tools/asset", tags=["asset_comparison"]
)
api_router.include_router(
    attendance.router, prefix="/tools/attendance", tags=["attendance"]
)
api_router.include_router(
    sixty_seconds.router, prefix="/tools/sixty-seconds", tags=["sixty_seconds"]
)

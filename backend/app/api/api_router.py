from fastapi import APIRouter
from app.api.endpoints import auth, users, string_tools

# Unified API Router
api_router = APIRouter()

# Register core endpoints
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])

# Register Tool endpoints dynamically
# To add a new tool, import its router and include it here
api_router.include_router(string_tools.router, prefix="/tools/string", tags=["string_tools"])

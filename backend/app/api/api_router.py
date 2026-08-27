from fastapi import APIRouter

from app.api.endpoints import (
    admin_audit,
    admin_roles,
    admin_stats,
    admin_tools,
    admin_users,
    asset_comparison,
    atlas_merge,
    attendance,
    auth,
    box_plot,
    calendar_tools,
    cpk_charts,
    notifications,
    qrcode_tools,
    realtime,
    sixty_seconds,
    tools_meta,
    upload,
    users,
)

# Unified API Router
api_router = APIRouter()

# Register core endpoints
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])

# 实时通知 WebSocket（登录后单一通道，事件仅通知）
api_router.include_router(realtime.router, prefix="/realtime", tags=["realtime"])

# 通知中心（登录即可）
api_router.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)

# Register Tool endpoints dynamically
# To add a new tool, import its router and include it here
api_router.include_router(
    qrcode_tools.router, prefix="/tools/qrcode", tags=["qrcode_tools"]
)
api_router.include_router(
    calendar_tools.router, prefix="/tools/calendar", tags=["calendar_tools"]
)
api_router.include_router(
    asset_comparison.router, prefix="/tools/asset", tags=["asset_comparison"]
)
api_router.include_router(
    attendance.router, prefix="/tools/attendance", tags=["attendance"]
)
api_router.include_router(
    atlas_merge.router, prefix="/tools/atlas-merge", tags=["atlas_merge"]
)
api_router.include_router(
    cpk_charts.router, prefix="/tools/cpk-charts", tags=["cpk_charts"]
)
api_router.include_router(
    sixty_seconds.router, prefix="/tools/sixty-seconds", tags=["sixty_seconds"]
)
api_router.include_router(box_plot.router, prefix="/tools/box-plot", tags=["box_plot"])

# 工具元数据（已登录用户可读，主控台用）
api_router.include_router(tools_meta.router, prefix="/tools-meta", tags=["tools_meta"])

# 管理员 endpoints（需 admin 角色）
api_router.include_router(
    admin_users.router, prefix="/admin/users", tags=["admin_users"]
)
api_router.include_router(
    admin_audit.router, prefix="/admin/audit", tags=["admin_audit"]
)
api_router.include_router(
    admin_tools.router, prefix="/admin/tools", tags=["admin_tools"]
)
api_router.include_router(
    admin_stats.router, prefix="/admin/stats", tags=["admin_stats"]
)
api_router.include_router(admin_roles.router, prefix="/admin", tags=["admin_roles"])

# 上传端点（tus 协议 — 基础设施）
api_router.include_router(upload.router, prefix="/upload", tags=["upload"])

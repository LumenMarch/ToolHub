"""出勤整理服务。

业务实现拆分为两个子模块：
- ``service``：出勤解析、整理与分析逻辑。
- ``cache``：进程内敏感结果短时缓存。

本模块对外重导出公共 API，调用方统一从 ``app.services.attendance`` 导入即可。
"""

from app.services.attendance.cache import (
    AttendanceResultCache,
    AttendanceResultExpiredError,
    AttendanceResultNotFoundError,
    CachedAttendanceResult,
    attendance_result_cache,
)
from app.services.attendance.service import (
    OUTPUT_HEADERS,
    AttendanceAnalysis,
    AttendanceOutputRow,
    AttendanceOutputSheet,
    AttendanceRecord,
    AttendanceService,
    AttendanceSummary,
    AttendanceValidationError,
    LeaveResult,
    ShiftSchedule,
    validate_upload_extensions,
)

__all__ = [
    "OUTPUT_HEADERS",
    "AttendanceAnalysis",
    "AttendanceOutputRow",
    "AttendanceOutputSheet",
    "AttendanceRecord",
    "AttendanceResultCache",
    "AttendanceResultExpiredError",
    "AttendanceResultNotFoundError",
    "AttendanceService",
    "AttendanceSummary",
    "AttendanceValidationError",
    "CachedAttendanceResult",
    "LeaveResult",
    "ShiftSchedule",
    "attendance_result_cache",
    "validate_upload_extensions",
]

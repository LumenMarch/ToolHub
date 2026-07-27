from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class AttendanceSummaryResponse(BaseModel):
    total_records: int
    employee_count: int
    sheet_count: int
    leave_event_count: int
    attention_record_count: int
    overtime_leave_count: int
    meal_overtime_count: int
    capture_time_anomaly_count: int
    missing_entry_count: int


class AttendanceRowResponse(BaseModel):
    key: str
    values: list[str]
    status_text: str
    anomaly_text: str
    flags: list[str]
    tone: Literal["default", "success", "danger", "warning"]
    attention: bool


class AttendanceSheetResponse(BaseModel):
    name: str
    row_count: int
    rows: list[AttendanceRowResponse]


class AttendanceAnalyzeResponse(BaseModel):
    result_id: str
    download_filename: str
    expires_at: datetime
    columns: list[str]
    summary: AttendanceSummaryResponse
    sheets: list[AttendanceSheetResponse]

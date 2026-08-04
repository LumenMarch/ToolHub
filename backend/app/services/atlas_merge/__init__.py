"""测试日志合并（atlas-merge）服务。

把原生 macOS 应用 AtlasLog 的合并逻辑从 Swift 移植为 Python，
拆分为多个子模块（对齐 Swift 源码结构）：
- ``csv`` / ``time_csv`` / ``pivot_parser`` / ``records_parser``：解析层
- ``merge_engine``：合并主逻辑
- ``exporter``：四行范式 CSV 输出
- ``archive``：zip 上传安全解压
- ``cache``：结果短时缓存

调用方统一从 ``app.services.atlas_merge`` 导入公共 API。
"""

from app.services.atlas_merge.archive import (
    MAX_UNCOMPRESSED_BYTES,
    ArchiveExtractError,
    extract_archive_zip,
    extract_archive_zip_file,
)
from app.services.atlas_merge.cache import (
    AtlasMergeResultCache,
    AtlasMergeResultExpiredError,
    AtlasMergeResultNotFoundError,
    CachedAtlasMergeResult,
    atlas_merge_result_cache,
)
from app.services.atlas_merge.csv import parse as parse_csv
from app.services.atlas_merge.csv import write as write_csv
from app.services.atlas_merge.exporter import csv_text
from app.services.atlas_merge.jobs import (
    JOB_TTL_SECONDS,
    STATUS_DONE,
    STATUS_ERROR,
    STATUS_QUEUED,
    STATUS_RUNNING,
    AtlasMergeJobRegistry,
    JobEntry,
    atlas_merge_jobs,
)
from app.services.atlas_merge.merge_engine import (
    build_metadata,
    detect_available_sources,
    empty_report,
    merge,
    meta_columns,
    parse_unit,
)
from app.services.atlas_merge.models import (
    ColumnDef,
    DataSourceType,
    MeasurementItem,
    MergedReport,
    MetaColumn,
    PivotData,
    UnitRecord,
)
from app.services.atlas_merge.pivot_parser import parse_text as parse_pivot_text
from app.services.atlas_merge.pivot_parser import parse_url as parse_pivot_url
from app.services.atlas_merge.records_parser import parse_text as parse_records_text
from app.services.atlas_merge.records_parser import parse_url as parse_records_url
from app.services.atlas_merge.time_csv import start_time, stop_time

__all__ = [
    "ArchiveExtractError",
    "AtlasMergeJobRegistry",
    "AtlasMergeResultCache",
    "AtlasMergeResultExpiredError",
    "AtlasMergeResultNotFoundError",
    "CachedAtlasMergeResult",
    "ColumnDef",
    "DataSourceType",
    "JOB_TTL_SECONDS",
    "JobEntry",
    "MAX_UNCOMPRESSED_BYTES",
    "MeasurementItem",
    "MergedReport",
    "MetaColumn",
    "PivotData",
    "STATUS_DONE",
    "STATUS_ERROR",
    "STATUS_QUEUED",
    "STATUS_RUNNING",
    "UnitRecord",
    "atlas_merge_jobs",
    "atlas_merge_result_cache",
    "build_metadata",
    "csv_text",
    "detect_available_sources",
    "empty_report",
    "extract_archive_zip",
    "extract_archive_zip_file",
    "merge",
    "meta_columns",
    "parse_csv",
    "parse_pivot_text",
    "parse_pivot_url",
    "parse_records_text",
    "parse_records_url",
    "parse_unit",
    "start_time",
    "stop_time",
    "write_csv",
]

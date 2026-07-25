from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.config import Settings, get_settings
from app.core.security import require_user
from app.modules.csv_compare.service import (
    CompareOptions,
    CsvComparisonError,
    compare_csv_files,
)

router = APIRouter(prefix="/api/tools/csv-compare", tags=["CSV 数据对比"])
ConfigDependency = Annotated[Settings, Depends(get_settings)]
UserDependency = Annotated[str, Depends(require_user)]


@router.post("")
async def compare_csv(
    source_file: Annotated[UploadFile, File()],
    target_file: Annotated[UploadFile, File()],
    primary_key: Annotated[str, Form(min_length=1, max_length=128)],
    _: UserDependency,
    config: ConfigDependency,
    trim_whitespace: Annotated[bool, Form()] = True,
    ignore_case: Annotated[bool, Form()] = False,
) -> dict:
    for uploaded_file in (source_file, target_file):
        if not (uploaded_file.filename or "").lower().endswith(".csv"):
            raise HTTPException(status_code=422, detail="仅支持 .csv 文件")

    source_content = await source_file.read(config.max_upload_bytes + 1)
    target_content = await target_file.read(config.max_upload_bytes + 1)
    if (
        len(source_content) > config.max_upload_bytes
        or len(target_content) > config.max_upload_bytes
    ):
        raise HTTPException(status_code=413, detail="单个文件不能超过 20 MB")

    try:
        result = compare_csv_files(
            source_content,
            target_content,
            CompareOptions(
                primary_key=primary_key.strip(),
                trim_whitespace=trim_whitespace,
                ignore_case=ignore_case,
            ),
        )
    except CsvComparisonError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    result["files"] = {
        "source": source_file.filename or "基准文件",
        "target": target_file.filename or "对比文件",
    }
    return result

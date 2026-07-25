from pathlib import Path
from typing import Annotated

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.auth import (
    authenticate,
    clear_session_cookie,
    create_session,
    require_user,
    set_session_cookie,
)
from app.config import Settings, get_settings
from app.schemas import LoginRequest, ToolResponse, UserResponse
from app.services.csv_compare import CompareOptions, CsvComparisonError, compare_csv_files

app = FastAPI(title="ToolHub API", version="0.1.0")
settings = get_settings()
ConfigDependency = Annotated[Settings, Depends(get_settings)]
UserDependency = Annotated[str, Depends(require_user)]

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/login", response_model=UserResponse)
def login(payload: LoginRequest, response: Response, config: ConfigDependency):
    if not authenticate(payload.username, payload.password, config):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    set_session_cookie(response, create_session(payload.username, config), config)
    return UserResponse(username=payload.username)


@app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, config: ConfigDependency) -> None:
    clear_session_cookie(response, config)


@app.get("/api/auth/me", response_model=UserResponse)
def current_user(username: UserDependency) -> UserResponse:
    return UserResponse(username=username)


@app.get("/api/tools", response_model=list[ToolResponse])
def list_tools(_: UserDependency) -> list[ToolResponse]:
    return [
        ToolResponse(
            id="csv-compare",
            name="CSV 数据对比",
            description="比较两份 CSV，识别新增、删除和字段变化。",
            category="数据处理",
            status="available",
        )
    ]


@app.post("/api/tools/csv-compare")
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


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

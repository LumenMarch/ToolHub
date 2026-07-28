from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.formparsers import MultiPartParser

from app.api.api_router import api_router
from app.db.base_class import Base
from app.db.session import engine
from app.seed import run_seed

# 增大 Starlette multipart 上传限制（默认 max_part_size 仅 1MB，Excel 文件轻松超标）
MultiPartParser.max_part_size = 100 * 1024 * 1024  # 单个 part 最大 100MB

# Create database tables
Base.metadata.create_all(bind=engine)

# 写入默认权限与角色（幂等 — 已有数据时跳过）
run_seed()

app = FastAPI(
    title="ToolHub API",
    openapi_url="/api/v1/openapi.json",
)

# Configure CORS — 局域网内其他 Mac 也能访问
# allow_credentials=True 不能搭配 allow_origins=["*"]，用正则匹配所有局域网地址
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Mount all API routes from the single API aggregator
app.include_router(api_router, prefix="/api/v1")


@app.get("/")
def read_root():
    return {"message": "Welcome to ToolHub API"}


@app.get("/health")
def health(request: Request):
    """健康检查 + 客户端 IP 信息"""
    return {
        "status": "ok",
        "client_host": request.client.host if request.client else "unknown",
    }

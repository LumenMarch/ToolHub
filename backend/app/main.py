from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.api_router import api_router
from app.db.base_class import Base
from app.db.session import engine

from app.migrations import run_rbac_migration

# Create database tables
Base.metadata.create_all(bind=engine)

# 执行 RBAC 数据迁移（幂等 — 已有数据时跳过）
run_rbac_migration()

app = FastAPI(title="ToolHub API", openapi_url="/api/v1/openapi.json")

# Configure CORS
origins = [
    "http://localhost:5173",  # Vite default port
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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

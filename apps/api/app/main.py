from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.modules.auth.router import router as auth_router
from app.modules.csv_compare.router import router as csv_compare_router
from app.modules.tool_catalog.router import router as tool_catalog_router

app = FastAPI(title="ToolHub API", version="0.1.0")
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(auth_router)
app.include_router(tool_catalog_router)
app.include_router(csv_compare_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


frontend_dist = Path(__file__).resolve().parents[2] / "web" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

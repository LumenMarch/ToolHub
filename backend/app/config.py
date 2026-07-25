from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="TOOLHUB_",
        extra="ignore",
    )

    username: str
    password: str
    secret_key: str = Field(min_length=32)
    session_max_age: int = 28_800
    cookie_secure: bool = False
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    max_upload_bytes: int = 20 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()

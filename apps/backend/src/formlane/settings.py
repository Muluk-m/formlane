from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(repr=False)
    openai_api_key: str = Field(default="", repr=False)
    endpoint: str = "https://api.openai.com/v1"
    model: str = "gpt-4.1"
    allowed_origins: str = ""
    public_origin: str = "http://localhost:8090"
    compiler_command: str = '["node", "../compiler/dist/index.js"]'
    build_version: str = "development"
    build_commit: str = "development"
    browser_executable: str | None = Field(
        default=None, validation_alias=AliasChoices("BROWSER_EXECUTABLE_PATH", "browser_executable")
    )
    worker_enabled: bool = True
    dbos_system_schema: str = Field(default="dbos", pattern=r"^[a-z_][a-z0-9_]{0,62}$")

    @property
    def durable_database_url(self) -> str:
        return self.database_url

    @field_validator("database_url")
    @classmethod
    def postgres_only(cls, value: str) -> str:
        if not value.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("DATABASE_URL must use PostgreSQL with psycopg.")
        return value

    @field_validator("public_origin")
    @classmethod
    def valid_public_origin(cls, value: str) -> str:
        return validate_origin(value)

    @field_validator("allowed_origins")
    @classmethod
    def valid_origins(cls, value: str) -> str:
        return ",".join(validate_origin(item.strip()) for item in value.split(",") if item.strip())

    @property
    def cors_origins(self) -> list[str]:
        return self.allowed_origins.split(",") if self.allowed_origins else []


def validate_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
        or "*" in value
    ):
        raise ValueError("Use an explicit HTTP(S) origin without credentials, path or wildcard.")
    return f"{parsed.scheme}://{parsed.netloc}"

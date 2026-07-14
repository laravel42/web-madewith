from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str
    github_token: str
    github_api_version: str = "2022-11-28"
    github_concurrency: int = Field(default=4, ge=1, le=12)
    request_timeout_seconds: float = 30
    refresh_after_days: int = 14
    classifier_llm_enabled: bool = False
    openai_api_key: str | None = None
    classifier_model: str = "gpt-4.1-mini"

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://boxcode:boxcode@localhost:5432/boxcode_hrms"
    jwt_secret: str = "change-me"
    default_tz: str = "Asia/Kolkata"
    api_prefix: str = "/api/v1"


settings = Settings()

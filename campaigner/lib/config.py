"""
Central config loading for campaigner.

Single source of truth for every env var. Tools, cli, and lib modules must
call `Config.load()` rather than reading `os.environ` directly — keeps env
surface discoverable and validated in one place.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, fields


class ConfigError(RuntimeError):
    pass


_PLACEHOLDERS = {
    "",
    "your-app-id",
    "your-app-secret",
    "your-access-token",
    "your-account-id",
    "your-page-id",
    "aiweon-uuid",
    "sk-ant-your-dev-key",
}


def _env(key: str) -> str | None:
    v = os.environ.get(key, "").strip()
    if not v or v in _PLACEHOLDERS or v.startswith("your-") or v == "act_your-account-id":
        return None
    return v


@dataclass(frozen=True)
class Config:
    # Anthropic (for Claude Code headless invocations)
    anthropic_api_key: str | None

    # GCP / Vertex AI Imagen
    gcp_project_id: str
    gcp_location: str

    # Meta Marketing API
    meta_app_id: str | None
    meta_app_secret: str | None
    meta_access_token: str | None
    meta_ad_account_id: str | None
    meta_page_id: str | None

    # Business identity
    business_id: str | None
    business_name: str

    # Postgres (local or Supabase)
    database_url: str | None

    # Supabase (future remote — optional)
    supabase_url: str | None
    supabase_service_role_key: str | None

    @classmethod
    def load(cls) -> Config:
        """Load config from os.environ. Optionally loads .env if python-dotenv is available."""
        try:
            from dotenv import load_dotenv

            load_dotenv(override=False)
        except ImportError:
            pass

        return cls(
            anthropic_api_key=_env("ANTHROPIC_API_KEY"),
            gcp_project_id=_env("GCP_PROJECT_ID") or "bemtech-478413",
            gcp_location=_env("GCP_LOCATION") or "us-central1",
            meta_app_id=_env("META_APP_ID"),
            meta_app_secret=_env("META_APP_SECRET"),
            meta_access_token=_env("META_ACCESS_TOKEN"),
            meta_ad_account_id=_env("META_AD_ACCOUNT_ID"),
            meta_page_id=_env("META_PAGE_ID"),
            business_id=_env("BUSINESS_ID"),
            business_name=_env("BUSINESS_NAME") or "Aiweon",
            database_url=_env("DATABASE_URL"),
            supabase_url=_env("SUPABASE_URL"),
            supabase_service_role_key=_env("SUPABASE_SERVICE_ROLE_KEY"),
        )

    def require(self, *keys: str) -> None:
        """Raise ConfigError if any of the given dataclass field names are unset."""
        valid = {f.name for f in fields(self)}
        unknown = [k for k in keys if k not in valid]
        if unknown:
            raise ConfigError(f"Unknown config keys: {unknown}")
        missing = [k.upper() for k in keys if getattr(self, k) in (None, "")]
        if missing:
            raise ConfigError(
                "Missing required env vars (or they hold placeholder values): " + ", ".join(missing)
            )

    # Convenience bundles — each client module calls the one it needs.

    def require_meta(self) -> None:
        self.require(
            "meta_app_id",
            "meta_app_secret",
            "meta_access_token",
            "meta_ad_account_id",
            "meta_page_id",
        )

    def require_db(self) -> None:
        self.require("database_url")

    def require_business(self) -> None:
        self.require("business_id")

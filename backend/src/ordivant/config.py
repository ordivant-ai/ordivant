from __future__ import annotations

import os
import hmac
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    return Path(os.getenv("ORDIVANT_DATA_DIR", str(REPO_ROOT / ".data"))).expanduser().resolve()


def database_url() -> str:
    configured = os.getenv("ORDIVANT_DATABASE_URL")
    if not configured and os.getenv("ORDIVANT_DATABASE_URL_FILE"):
        configured = Path(os.environ["ORDIVANT_DATABASE_URL_FILE"]).read_text(encoding="utf-8").strip()
    if configured:
        if configured.startswith("postgres://"):
            return "postgresql+psycopg://" + configured.removeprefix("postgres://")
        if configured.startswith("postgresql://") and "+" not in configured.split(":", 1)[0]:
            return "postgresql+psycopg://" + configured.removeprefix("postgresql://")
        return configured
    db_path = data_dir() / "ordivant.db"
    return f"sqlite:///{db_path.as_posix()}"


def app_mode() -> str:
    value = os.getenv("ORDIVANT_MODE", "development").strip().lower()
    if value not in {"development", "production"}:
        raise RuntimeError("ORDIVANT_MODE must be 'development' or 'production'")
    return value


def authorized_dev_proxy(supplied: str | None) -> bool:
    configured_path = os.getenv("ORDIVANT_DEV_PROXY_TOKEN_FILE")
    try:
        expected = Path(configured_path).read_text(encoding="utf-8").strip() if configured_path else os.getenv("ORDIVANT_DEV_PROXY_TOKEN", "")
    except OSError:
        return False
    return bool(expected and supplied and hmac.compare_digest(expected.encode("utf-8"), supplied.encode("utf-8")))

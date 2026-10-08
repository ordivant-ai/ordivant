from __future__ import annotations

import os
import hmac
from dataclasses import dataclass
from pathlib import Path


_SOURCE_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _SOURCE_PARENTS[min(5, len(_SOURCE_PARENTS) - 1)]


def authorized_dev_proxy(supplied: str | None) -> bool:
    configured_path = os.getenv("ORDIVANT_DEV_PROXY_TOKEN_FILE")
    try:
        expected = Path(configured_path).read_text(encoding="utf-8").strip() if configured_path else os.getenv("ORDIVANT_DEV_PROXY_TOKEN", "")
    except OSError:
        return False
    return bool(expected and supplied and hmac.compare_digest(expected.encode("utf-8"), supplied.encode("utf-8")))


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    database_url: str
    mode: str


def get_settings() -> Settings:
    mode = os.getenv("ORDIVANT_MODE", "development").strip().lower()
    if mode not in {"development", "production"}:
        raise RuntimeError("ORDIVANT_MODE must be 'development' or 'production'")

    data_dir = Path(os.getenv("ORDIVANT_KNOWLEDGE_DATA_DIR", str(REPO_ROOT / ".data" / "knowledge"))).expanduser().resolve()
    database_url = os.getenv("ORDIVANT_KNOWLEDGE_DATABASE_URL", "").strip()
    if not database_url and os.getenv("ORDIVANT_KNOWLEDGE_DATABASE_URL_FILE"):
        database_url = Path(os.environ["ORDIVANT_KNOWLEDGE_DATABASE_URL_FILE"]).read_text(encoding="utf-8").strip()
    if not database_url:
        database_url = f"sqlite:///{(data_dir / 'knowledge.sqlite3').as_posix()}"
    elif database_url.startswith("postgres://"):
        database_url = "postgresql+psycopg://" + database_url.removeprefix("postgres://")
    elif database_url.startswith("postgresql://"):
        database_url = "postgresql+psycopg://" + database_url.removeprefix("postgresql://")
    return Settings(data_dir=data_dir, database_url=database_url, mode=mode)

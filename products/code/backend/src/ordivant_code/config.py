from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

_SOURCE_PARENTS = Path(__file__).resolve().parents
REPO_ROOT = _SOURCE_PARENTS[min(5, len(_SOURCE_PARENTS) - 1)]


def data_dir() -> Path:
    raw = os.getenv("ORDIVANT_CODE_DATA_DIR")
    path = Path(raw).expanduser() if raw else REPO_ROOT / ".data" / "code"
    return (path if path.is_absolute() else REPO_ROOT / path).resolve()


def database_url() -> str:
    configured = os.getenv("ORDIVANT_CODE_DATABASE_URL")
    if not configured:
        url_file = os.getenv("ORDIVANT_CODE_DATABASE_URL_FILE")
        if url_file:
            path = Path(url_file).expanduser()
            if not path.is_absolute():
                path = REPO_ROOT / path
            try:
                configured = path.read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise RuntimeError("ORDIVANT_CODE_DATABASE_URL_FILE could not be read") from exc
            if not configured:
                raise RuntimeError("ORDIVANT_CODE_DATABASE_URL_FILE is empty")
    if configured:
        if configured.startswith("postgres://"):
            return "postgresql+psycopg://" + configured.removeprefix("postgres://")
        if configured.startswith("postgresql://"):
            return "postgresql+psycopg://" + configured.removeprefix("postgresql://")
        return configured
    return f"sqlite:///{(data_dir() / 'ordivant-code.db').as_posix()}"


def app_mode() -> str:
    value = os.getenv("ORDIVANT_MODE", "development").strip().lower()
    if value not in {"development", "production"}:
        raise RuntimeError("ORDIVANT_MODE must be 'development' or 'production'")
    return value


@dataclass(frozen=True)
class GiteaConfig:
    url: str
    token: str
    webhook_secret: str

    @property
    def api_base(self) -> str:
        parsed = urlsplit(self.url)
        path = parsed.path.rstrip("/")
        if not path.endswith("/api/v1"):
            path += "/api/v1"
        return f"{parsed.scheme}://{parsed.netloc}{path}"


def load_gitea_config() -> GiteaConfig | None:
    config_path = os.getenv("ORDIVANT_CODE_GITEA_CONFIG")
    if config_path:
        path = Path(config_path).expanduser()
        if not path.is_absolute():
            path = REPO_ROOT / path
        data = json.loads(path.read_text(encoding="utf-8"))
        url, token, secret = data.get("url"), data.get("token"), data.get("webhook_secret")
    else:
        url = os.getenv("ORDIVANT_CODE_GITEA_URL")
        token = os.getenv("ORDIVANT_CODE_GITEA_TOKEN")
        secret = os.getenv("ORDIVANT_CODE_WEBHOOK_SECRET")
    if not url or not token or not secret:
        return None
    parsed = urlsplit(url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("ORDIVANT_CODE_GITEA_URL must be an http(s) base URL without credentials or query data")
    return GiteaConfig(url=url.rstrip("/"), token=token, webhook_secret=secret)

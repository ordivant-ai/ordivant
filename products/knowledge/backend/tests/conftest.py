from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from ordivant_knowledge.config import Settings
from ordivant_knowledge.main import create_app
from ordivant_knowledge.seed import seed_knowledge


@pytest.fixture
def system(tmp_path) -> Iterator[dict[str, object]]:
    database_file = tmp_path / "knowledge.sqlite3"
    database_url = f"sqlite:///{database_file.as_posix()}"
    settings = Settings(data_dir=tmp_path, database_url=database_url, mode="development")
    bootstrap = seed_knowledge(settings=settings)
    application = create_app(database_url, mode="development")
    yield {
        "app": application,
        "database_url": database_url,
        "settings": settings,
        "bootstrap": bootstrap,
    }
    application.state.engine.dispose()


def auth(token: str, key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def client_for(system: dict[str, object]) -> TestClient:
    return TestClient(system["app"], client=("127.0.0.1", 50881))

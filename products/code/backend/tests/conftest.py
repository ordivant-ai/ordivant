from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[4]
TEST_DATA = REPO_ROOT / ".data" / "code-tests"
os.environ["ORDIVANT_CODE_DATA_DIR"] = str(TEST_DATA)
os.environ["ORDIVANT_MODE"] = "development"
for variable in (
    "ORDIVANT_CODE_DATABASE_URL",
    "ORDIVANT_CODE_DATABASE_URL_FILE",
    "ORDIVANT_CODE_GITEA_URL",
    "ORDIVANT_CODE_GITEA_TOKEN",
    "ORDIVANT_CODE_WEBHOOK_SECRET",
    "ORDIVANT_CODE_GITEA_CONFIG",
):
    os.environ.pop(variable, None)

from ordivant_code import models  # noqa: E402,F401
from ordivant_code.db import Base, SessionLocal, engine  # noqa: E402
from ordivant_code.main import app  # noqa: E402
from ordivant_code.seed import run_seed  # noqa: E402


@pytest.fixture(scope="session")
def api():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    run_seed()
    with TestClient(app, client=("127.0.0.1", 52000)) as client:
        yield client


@pytest.fixture(scope="session")
def credentials(api):
    return json.loads((TEST_DATA / "bootstrap.json").read_text(encoding="utf-8"))


@pytest.fixture
def repository(credentials):
    from ordivant_code.models import Project, Repository
    from ordivant_code.security import new_id, now_utc

    with SessionLocal() as session:
        project = session.query(Project).filter_by(key="code-demo").one()
        repo = Repository(
            id=new_id(), project_id=project.id, provider="gitea", owner="demo-owner",
            name=f"test-{new_id()[:8]}", default_branch="main",
            web_url="http://127.0.0.1:3001/demo-owner/demo", clone_url="http://127.0.0.1:3001/demo-owner/demo.git",
            created_at=now_utc(),
        )
        session.add(repo)
        session.commit()
        return {"id": repo.id, "project_id": project.id, "owner": repo.owner, "name": repo.name}


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

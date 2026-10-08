from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from ordivant.api import app
from ordivant.db import Base, get_db, make_engine
from ordivant.models import (
    Agent,
    Organization,
    Principal,
    Project,
    ProjectMembership,
    Team,
)
from ordivant.security import issue_token, new_id, now_utc


@pytest.fixture
def system(tmp_path, monkeypatch):
    monkeypatch.setenv("ORDIVANT_MODE", "development")
    database_file = tmp_path / "ordivant-test.db"
    database_url = f"sqlite:///{database_file.as_posix()}"
    test_engine = make_engine(database_url)
    Base.metadata.create_all(bind=test_engine)
    factory = sessionmaker(bind=test_engine, expire_on_commit=False, autoflush=False)

    with factory() as session:
        organization = Organization(id=new_id(), name="Test Org", created_at=now_utc())
        team = Team(id=new_id(), organization_id=organization.id, name="Test Team", created_at=now_utc())
        session.add(organization)
        session.flush()
        session.add(team)
        session.flush()
        manager = Principal(
            id=new_id(), name="manager", kind="human", role="manager", organization_id=organization.id,
            team_id=team.id, active=True,
        )
        worker_a = Principal(
            id=new_id(), name="worker-a", kind="agent", role="worker", organization_id=organization.id,
            team_id=team.id, active=True,
        )
        worker_b = Principal(
            id=new_id(), name="worker-b", kind="agent", role="worker", organization_id=organization.id,
            team_id=team.id, active=True,
        )
        reviewer = Principal(
            id=new_id(), name="reviewer-c", kind="agent", role="reviewer", organization_id=organization.id,
            team_id=team.id, active=True,
        )
        outsider = Principal(
            id=new_id(), name="isolated-agent", kind="agent", role="worker", organization_id=organization.id,
            team_id=team.id, active=True,
        )
        runtime = Principal(
            id=new_id(), name="runtime", kind="runtime", role="manager", organization_id=organization.id,
            team_id=team.id, active=True,
        )
        session.add_all([manager, worker_a, worker_b, reviewer, outsider, runtime])
        session.flush()
        main_project = Project(
            id=new_id(), key="TST", name="Test Project", description="", organization_id=organization.id,
            team_id=team.id, budget_usd=100, created_at=now_utc(),
        )
        isolated_project = Project(
            id=new_id(), key="ISO", name="Isolated Project", description="", organization_id=organization.id,
            team_id=team.id, budget_usd=10, created_at=now_utc(),
        )
        session.add_all([main_project, isolated_project])
        session.flush()
        agent_specs = [
            (worker_a, "worker-a", "worker", "external", main_project.id),
            (worker_b, "worker-b", "worker", "pi", main_project.id),
            (reviewer, "reviewer-c", "reviewer", "external", main_project.id),
            (outsider, "isolated-agent", "worker", "external", isolated_project.id),
        ]
        agents = {}
        for principal, name, role, runtime_kind, project_id in agent_specs:
            agent = Agent(
                id=new_id(), principal_id=principal.id, name=name, role=role, team_id=team.id,
                capabilities_json="[]", status="available", runtime=runtime_kind, model=None, created_at=now_utc(),
            )
            session.add(agent)
            session.add(ProjectMembership(id=new_id(), project_id=project_id, principal_id=principal.id))
            agents[name] = agent
        for principal in (manager, runtime):
            for project in (main_project, isolated_project) if principal is manager else (main_project,):
                session.add(ProjectMembership(id=new_id(), project_id=project.id, principal_id=principal.id))
        tokens = {
            "manager": issue_token(session, manager.id),
            "worker_a": issue_token(session, worker_a.id),
            "worker_b": issue_token(session, worker_b.id),
            "reviewer": issue_token(session, reviewer.id),
            "outsider": issue_token(session, outsider.id),
            "runtime": issue_token(session, runtime.id),
        }
        session.commit()

    def override_get_db() -> Iterator:
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    result = {
        "engine": test_engine,
        "factory": factory,
        "database_url": database_url,
        "tokens": tokens,
        "ids": {
            "organization": organization.id,
            "team": team.id,
            "project": main_project.id,
            "isolated_project": isolated_project.id,
            "manager": manager.id,
            "worker_a": worker_a.id,
            "worker_b": worker_b.id,
            "reviewer": reviewer.id,
            "outsider": outsider.id,
            "runtime": runtime.id,
        },
        "agents": {name: agent.id for name, agent in agents.items()},
    }
    yield result
    app.dependency_overrides.clear()
    test_engine.dispose()


@pytest.fixture
def api_client(system) -> Iterator[TestClient]:
    with TestClient(app, client=("127.0.0.1", 50821)) as client:
        yield client


def headers(system, name: str, idempotency_key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {system['tokens'][name]}"}
    if idempotency_key:
        result["Idempotency-Key"] = idempotency_key
    return result


def create_task(api_client, system, *, title="Test task", **fields):
    value = {"project_id": system["ids"]["project"], "title": title, **fields}
    response = api_client.post("/api/tasks", json=value, headers=headers(system, "manager"))
    assert response.status_code == 201, response.text
    return response.json()

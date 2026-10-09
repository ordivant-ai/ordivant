from __future__ import annotations

import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from ordivant.bootstrap_runtime import BootstrapError, initialize_runtime
from ordivant.db import Base, make_engine
from ordivant.models import Agent, AuthToken, Organization, Principal, Project, ProjectMembership, Task
from ordivant.security import issue_token, new_id, now_utc, principal_for_token


@pytest.fixture
def installation(tmp_path, monkeypatch):
    monkeypatch.delenv("ORDIVANT_IDENTITY_ORG_ID", raising=False)
    engine = make_engine(f"sqlite:///{(tmp_path / 'work.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    yield tmp_path / "data", factory
    engine.dispose()


def test_clean_installation_creates_only_a_scoped_execution_identity(installation):
    directory, factory = installation
    initialize_runtime(directory=directory, factory=factory)
    bootstrap = json.loads((directory / "bootstrap.json").read_text())
    with factory() as session:
        actor = principal_for_token(session, bootstrap["runtime_token"])
        assert actor.kind == "runtime" and actor.role == "manager" and actor.active
        assert session.scalar(select(func.count()).select_from(Organization)) == 1
        assert session.scalar(select(func.count()).select_from(Principal)) == 1
        for model in (Agent, Project, ProjectMembership, Task):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_repeated_initialization_keeps_the_same_private_credential(installation):
    directory, factory = installation
    initialize_runtime(directory=directory, factory=factory)
    first = (directory / "bootstrap.json").read_bytes()
    initialize_runtime(directory=directory, factory=factory)
    assert (directory / "bootstrap.json").read_bytes() == first
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(AuthToken)) == 1


@pytest.mark.parametrize("content", ['["invalid"]', '{"runtime_token":"invalid-private-value"}', 'not json'])
def test_invalid_existing_configuration_is_not_replaced_or_echoed(installation, content):
    directory, factory = installation
    directory.mkdir()
    path = directory / "bootstrap.json"
    path.write_text(content)
    with pytest.raises(BootstrapError) as error:
        initialize_runtime(directory=directory, factory=factory)
    assert "invalid-private-value" not in str(error.value)
    assert path.read_text() == content
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(AuthToken)) == 0


def test_multiple_organizations_require_an_explicit_selection(installation, monkeypatch):
    directory, factory = installation
    with factory() as session:
        organizations = [Organization(id=new_id(), name=name, created_at=now_utc()) for name in ("First", "Second")]
        session.add_all(organizations)
        session.commit()
    with pytest.raises(BootstrapError, match="Select the Work organization"):
        initialize_runtime(directory=directory, factory=factory)
    assert not (directory / "bootstrap.json").exists()
    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", organizations[1].id)
    initialize_runtime(directory=directory, factory=factory)
    bootstrap = json.loads((directory / "bootstrap.json").read_text())
    with factory() as session:
        assert principal_for_token(session, bootstrap["runtime_token"]).organization_id == organizations[1].id
    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", organizations[0].id)
    with pytest.raises(BootstrapError, match="invalid for this organization"):
        initialize_runtime(directory=directory, factory=factory)


def test_disabled_execution_identity_is_not_reactivated(installation):
    directory, factory = installation
    with factory() as session:
        organization = Organization(id=new_id(), name="Team", created_at=now_utc())
        session.add(organization)
        session.flush()
        session.add(Principal(id=new_id(), name="runtime", kind="runtime", role="manager", organization_id=organization.id, active=False))
        session.commit()
    with pytest.raises(BootstrapError, match="disabled"):
        initialize_runtime(directory=directory, factory=factory)
    assert not (directory / "bootstrap.json").exists()


def test_valid_demo_configuration_and_other_fields_are_preserved(installation):
    directory, factory = installation
    initialize_runtime(directory=directory, factory=factory)
    path = directory / "bootstrap.json"
    previous = json.loads(path.read_text())
    previous.update(agents={"sample": {"id": "sample-agent"}}, project_id="sample-project")
    path.write_text(json.dumps(previous))
    initialize_runtime(directory=directory, factory=factory)
    assert json.loads(path.read_text()) == previous


def test_human_credential_cannot_be_used_as_execution_identity(installation):
    directory, factory = installation
    directory.mkdir()
    with factory() as session:
        organization = Organization(id=new_id(), name="Team", created_at=now_utc())
        session.add(organization)
        session.flush()
        human = Principal(id=new_id(), name="Owner", kind="human", role="admin", organization_id=organization.id, active=True)
        session.add(human)
        session.flush()
        token = issue_token(session, human.id)
        session.commit()
    path = directory / "bootstrap.json"
    path.write_text(json.dumps({"runtime_token": token}))
    with pytest.raises(BootstrapError) as error:
        initialize_runtime(directory=directory, factory=factory)
    assert token not in str(error.value)
    assert json.loads(path.read_text())["runtime_token"] == token


def test_initialized_runtime_keeps_the_existing_rest_scope(api_client, system, tmp_path):
    initialize_runtime(directory=tmp_path, factory=system["factory"])
    token = json.loads((tmp_path / "bootstrap.json").read_text())["runtime_token"]
    response = api_client.get("/api/projects", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "runtime_scope"

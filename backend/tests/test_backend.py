from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import sessionmaker
from starlette.testclient import TestClient

from ordivant.api import app
from ordivant.db import make_engine
from ordivant.models import Agent, AuditEvent, Execution, IdempotencyRecord, Message, OutboxEvent, Task
from ordivant.security import now_utc

from conftest import create_task, headers


def test_concurrent_claims_have_one_winner(api_client, system):
    task = create_task(api_client, system, title="Claim race")

    def claim(agent_name: str):
        return api_client.post(
            f"/api/tasks/{task['id']}/claim",
            json={"lease_seconds": 300},
            headers=headers(system, agent_name),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(claim, ("worker_a", "worker_b")))
    assert sorted(response.status_code for response in responses) == [200, 409]
    with system["factory"]() as session:
        executions = list(session.scalars(select(Execution).where(Execution.task_id == task["id"])))
        current_task = session.get(Task, task["id"])
        assert len(executions) == 1
        assert current_task.status == "in_progress"


def test_expired_lease_is_discoverable_and_fences_old_progress(api_client, system):
    task = create_task(api_client, system, title="Expiry recovery", assignee_id=system["agents"]["worker-a"])
    first = api_client.post(
        f"/api/tasks/{task['id']}/claim", json={}, headers=headers(system, "worker_a")
    ).json()
    with system["factory"]() as session:
        session.execute(
            update(Execution)
            .where(Execution.id == first["execution"]["id"])
            .values(lease_expires_at=now_utc() - timedelta(seconds=1))
        )
        session.commit()

    ready = api_client.get("/api/tasks", params={"ready_only": "true"}, headers=headers(system, "worker_a"))
    assert any(item["id"] == task["id"] and item["status"] == "ready" for item in ready.json())
    second = api_client.post(
        f"/api/tasks/{task['id']}/claim", json={}, headers=headers(system, "worker_a")
    )
    assert second.status_code == 200, second.text
    current = second.json()
    stale = api_client.post(
        f"/api/tasks/{task['id']}/progress",
        json={
            "execution_id": first["execution"]["id"],
            "lease_token": first["lease_token"],
            "progress": 99,
        },
        headers=headers(system, "worker_a"),
    )
    assert stale.status_code == 409
    assert current["execution"]["id"] != first["execution"]["id"]
    with system["factory"]() as session:
        old_execution = session.get(Execution, first["execution"]["id"])
        task_row = session.get(Task, task["id"])
        assert old_execution.status == "expired"
        assert task_row.progress == 0


def test_project_scope_actor_identity_and_input_tampering(api_client, system):
    main_task = create_task(api_client, system, title="Main scoped task")
    hidden = api_client.get(
        f"/api/tasks/{main_task['id']}", headers=headers(system, "outsider")
    )
    assert hidden.status_code == 404
    project_list = api_client.get(
        "/api/tasks", params={"project_id": system["ids"]["isolated_project"]}, headers=headers(system, "worker_a")
    )
    assert project_list.status_code == 404

    impersonation = api_client.post(
        f"/api/tasks/{main_task['id']}/claim",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "worker_a"),
    )
    assert impersonation.status_code == 403
    tampering = api_client.post(
        "/api/tasks",
        json={"project_id": system["ids"]["project"], "title": "Forged", "actor_id": system["ids"]["manager"]},
        headers=headers(system, "worker_a"),
    )
    assert tampering.status_code == 422


def test_dependency_cycle_blocking_and_successor_unlock(api_client, system):
    prerequisite = create_task(
        api_client,
        system,
        title="Prerequisite",
        assignee_id=system["agents"]["worker-a"],
        reviewer_id=system["agents"]["reviewer-c"],
    )
    successor = create_task(api_client, system, title="Successor", dependency_ids=[prerequisite["id"]])
    assert successor["status"] == "blocked"
    blocked_claim = api_client.post(
        f"/api/tasks/{successor['id']}/claim", json={}, headers=headers(system, "worker_a")
    )
    assert blocked_claim.status_code == 409
    assert blocked_claim.json()["detail"]["code"] == "task_not_ready"

    first = create_task(api_client, system, title="Cycle A")
    second = create_task(api_client, system, title="Cycle B")
    changed = api_client.patch(
        f"/api/tasks/{first['id']}", json={"dependency_ids": [second["id"]]}, headers=headers(system, "manager")
    )
    assert changed.status_code == 200
    cycle = api_client.patch(
        f"/api/tasks/{second['id']}", json={"dependency_ids": [first["id"]]}, headers=headers(system, "manager")
    )
    assert cycle.status_code == 409
    assert cycle.json()["detail"]["code"] == "dependency_cycle"

    claim = api_client.post(
        f"/api/tasks/{prerequisite['id']}/claim",
        json={},
        headers=headers(system, "worker_a"),
    ).json()
    submitted = api_client.post(
        f"/api/tasks/{prerequisite['id']}/submit",
        json={
            "execution_id": claim["execution"]["id"],
            "lease_token": claim["lease_token"],
            "summary": "Prerequisite complete",
            "artifacts": [{"kind": "test_report", "title": "Checks", "content": "passed"}],
        },
        headers=headers(system, "worker_a"),
    )
    assert submitted.status_code == 200
    accepted = api_client.post(
        f"/api/tasks/{prerequisite['id']}/review",
        json={"decision": "accept", "comment": "Evidence meets the criteria."},
        headers=headers(system, "reviewer"),
    )
    assert accepted.status_code == 200
    refreshed = api_client.get(f"/api/tasks/{successor['id']}", headers=headers(system, "manager"))
    assert refreshed.json()["status"] == "ready"


def test_help_reply_delegation_submission_and_independent_review(api_client, system):
    parent = create_task(
        api_client,
        system,
        title="Parent workflow",
        assignee_id=system["agents"]["worker-a"],
        reviewer_id=system["agents"]["reviewer-c"],
    )
    claimed = api_client.post(
        f"/api/tasks/{parent['id']}/claim", json={}, headers=headers(system, "worker_a")
    ).json()
    help_request = api_client.post(
        "/api/messages",
        json={
            "project_id": system["ids"]["project"],
            "task_id": parent["id"],
            "recipient_id": system["agents"]["worker-b"],
            "kind": "help_request",
            "body": "Please inspect the dependency plan.",
        },
        headers=headers(system, "worker_a"),
    )
    assert help_request.status_code == 201
    inbox = api_client.get("/api/messages", params={"inbox": "true"}, headers=headers(system, "worker_b"))
    assert any(item["id"] == help_request.json()["id"] for item in inbox.json())
    reply = api_client.post(
        "/api/messages",
        json={
            "project_id": system["ids"]["project"],
            "task_id": parent["id"],
            "kind": "reply",
            "reply_to_id": help_request.json()["id"],
            "body": "The dependencies are consistent.",
        },
        headers=headers(system, "worker_b"),
    )
    assert reply.status_code == 201
    assert reply.json()["recipient_id"] == system["ids"]["worker_a"]
    assert api_client.get(
        "/api/messages", params={"inbox": "true"}, headers=headers(system, "worker_a")
    ).json()[0]["id"] == reply.json()["id"]

    delegated = api_client.post(
        f"/api/tasks/{parent['id']}/delegate",
        json={
            "agent_id": system["agents"]["worker-b"],
            "title": "Child review work",
            "goal": "Prepare a testable result.",
            "acceptance_criteria": ["Evidence is attached"],
        },
        headers=headers(system, "worker_a"),
    )
    assert delegated.status_code == 201, delegated.text
    child = delegated.json()
    assert child["parent_task_id"] == parent["id"]
    b_claim = api_client.post(
        f"/api/tasks/{child['id']}/claim", json={}, headers=headers(system, "worker_b")
    ).json()
    submission_body = {
        "execution_id": b_claim["execution"]["id"],
        "lease_token": b_claim["lease_token"],
        "summary": "Child work complete",
        "artifacts": [{"kind": "test_report", "title": "Child evidence", "content": "checks passed"}],
    }
    submitted = api_client.post(
        f"/api/tasks/{child['id']}/submit", json=submission_body, headers=headers(system, "worker_b", "submit-child")
    )
    assert submitted.status_code == 200
    review = api_client.post(
        f"/api/tasks/{child['id']}/review",
        json={"decision": "accept", "comment": "Independent review passed."},
        headers=headers(system, "reviewer"),
    )
    assert review.status_code == 200
    assert review.json()["task"]["status"] == "done"
    repeated_submit = api_client.post(
        f"/api/tasks/{child['id']}/submit", json=submission_body, headers=headers(system, "worker_b", "submit-child")
    )
    assert repeated_submit.status_code == 200
    assert repeated_submit.json()["task"]["status"] == "in_review"

    parent_context = api_client.get(f"/api/tasks/{parent['id']}/context", headers=headers(system, "manager"))
    assert parent_context.json()["task"]["status"] == "in_progress"
    assert any(item["kind"] == "reply" for item in parent_context.json()["messages"])


def test_submitting_actor_cannot_review_own_result(api_client, system):
    task = create_task(api_client, system, title="Human claim review separation", assignee_id=system["agents"]["worker-a"])
    claimed = api_client.post(
        f"/api/tasks/{task['id']}/claim",
        json={"agent_id": system["agents"]["worker-a"]},
        headers=headers(system, "manager"),
    ).json()
    submitted = api_client.post(
        f"/api/tasks/{task['id']}/submit",
        json={
            "execution_id": claimed["execution"]["id"],
            "lease_token": claimed["lease_token"],
            "summary": "Evidence complete",
            "artifacts": [{"kind": "summary", "title": "Evidence", "content": "result"}],
        },
        headers=headers(system, "manager"),
    )
    assert submitted.status_code == 200
    self_review = api_client.post(
        f"/api/tasks/{task['id']}/review",
        json={"decision": "accept", "comment": "I accept my own work."},
        headers=headers(system, "manager"),
    )
    assert self_review.status_code == 403
    independent = api_client.post(
        f"/api/tasks/{task['id']}/review",
        json={"decision": "accept", "comment": "Independent review accepted."},
        headers=headers(system, "reviewer"),
    )
    assert independent.status_code == 200
    assert independent.json()["task"]["status"] == "done"


def test_idempotency_replays_without_duplicates_and_keys_include_resource(api_client, system):
    payload = {
        "project_id": system["ids"]["project"],
        "title": "Idempotent task",
        "goal": "Create once.",
    }
    first = api_client.post("/api/tasks", json=payload, headers=headers(system, "manager", "same-task"))
    replay = api_client.post("/api/tasks", json=payload, headers=headers(system, "manager", "same-task"))
    assert first.status_code == replay.status_code == 201
    assert first.json()["id"] == replay.json()["id"]
    changed = api_client.post(
        "/api/tasks",
        json={**payload, "title": "Changed body"},
        headers=headers(system, "manager", "same-task"),
    )
    assert changed.status_code == 409

    first_task = create_task(api_client, system, title="First blocked")
    second_task = create_task(api_client, system, title="Second blocked")
    for task, agent in ((first_task, "worker_a"), (second_task, "worker_b")):
        claimed = api_client.post(f"/api/tasks/{task['id']}/claim", json={}, headers=headers(system, agent)).json()
        blocked = api_client.post(
            f"/api/tasks/{task['id']}/block",
            json={
                "execution_id": claimed["execution"]["id"],
                "lease_token": claimed["lease_token"],
                "reason": "Waiting for an input.",
            },
            headers=headers(system, agent),
        )
        assert blocked.status_code == 200
    first_unblock = api_client.post(
        f"/api/tasks/{first_task['id']}/unblock", json={}, headers=headers(system, "manager", "same-unblock")
    )
    second_unblock = api_client.post(
        f"/api/tasks/{second_task['id']}/unblock", json={}, headers=headers(system, "manager", "same-unblock")
    )
    assert first_unblock.status_code == second_unblock.status_code == 200
    assert first_unblock.json()["id"] == first_task["id"]
    assert second_unblock.json()["id"] == second_task["id"]

    message_body = {
        "project_id": system["ids"]["project"],
        "kind": "question",
        "body": "Only one message should be created.",
    }
    sent = api_client.post("/api/messages", json=message_body, headers=headers(system, "manager", "same-message"))
    resent = api_client.post("/api/messages", json=message_body, headers=headers(system, "manager", "same-message"))
    assert sent.json()["id"] == resent.json()["id"]
    with system["factory"]() as session:
        assert session.scalar(select(func.count()).select_from(Task).where(Task.title == "Idempotent task")) == 1
        assert session.scalar(select(func.count()).select_from(Message).where(Message.body == message_body["body"])) == 1


def test_agent_creation_replay_does_not_store_token_or_duplicate_agent(api_client, system):
    body = {
        "name": "new-agent",
        "role": "worker",
        "project_ids": [system["ids"]["project"]],
        "capabilities": ["tests"],
    }
    first = api_client.post("/api/agents", json=body, headers=headers(system, "manager", "agent-create"))
    retry = api_client.post("/api/agents", json=body, headers=headers(system, "manager", "agent-create"))
    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    assert first.json()["token"] != retry.json()["token"]
    auth = api_client.get("/api/me", headers={"Authorization": f"Bearer {retry.json()['token']}"})
    assert auth.status_code == 200
    with system["factory"]() as session:
        assert session.scalar(select(func.count()).select_from(Agent).where(Agent.name == "new-agent")) == 1
        row = session.scalar(select(IdempotencyRecord).where(IdempotencyRecord.key == "agent-create"))
        assert "ovt_" not in row.response_json


def test_outbox_dispatch_is_atomic_and_delivery_token_is_fenced(api_client, system):
    task = create_task(api_client, system, title="Dispatchable", assignee_id=system["agents"]["worker-b"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager", "dispatch-once"),
    )
    assert dispatch.status_code == 201, dispatch.text
    duplicate = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager", "dispatch-once"),
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == dispatch.json()["id"]
    event_id = dispatch.json()["id"]
    runtime_headers = headers(system, "runtime")
    first_claim = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "worker-one", "limit": 5}, headers=runtime_headers
    )
    assert first_claim.status_code == 200, first_claim.text
    item = next(event for event in first_claim.json() if event["id"] == event_id)
    with system["factory"]() as session:
        session.execute(
            update(OutboxEvent)
            .where(OutboxEvent.id == event_id)
            .values(claim_expires_at=now_utc() - timedelta(seconds=1))
        )
        session.commit()
    second_claim = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "worker-two", "limit": 5}, headers=runtime_headers
    ).json()
    reclaimed = next(event for event in second_claim if event["id"] == event_id)
    old_ack = api_client.post(
        f"/api/runtime/outbox/{event_id}/ack",
        json={"worker_id": "worker-one", "delivery_token": item["delivery_token"], "status": "delivered"},
        headers=runtime_headers,
    )
    assert old_ack.status_code == 409
    new_ack = api_client.post(
        f"/api/runtime/outbox/{event_id}/ack",
        json={"worker_id": "worker-two", "delivery_token": reclaimed["delivery_token"], "status": "delivered"},
        headers=runtime_headers,
    )
    assert new_ack.status_code == 200
    with system["factory"]() as session:
        assert session.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.task_id == task["id"])) == 1
        idem = list(session.scalars(select(IdempotencyRecord)))
        assert all("delivery_token" not in row.response_json for row in idem)


def test_runtime_credential_cannot_use_business_permissions(api_client, system):
    tasks = api_client.get("/api/tasks", headers=headers(system, "runtime"))
    assert tasks.status_code == 403
    create = api_client.post(
        "/api/projects",
        json={"key": "NOPE", "name": "Runtime must not create projects"},
        headers=headers(system, "runtime"),
    )
    assert create.status_code == 403


def test_database_restart_keeps_audit_and_local_session_is_loopback_only(api_client, system, monkeypatch):
    monkeypatch.setenv("ORDIVANT_MODE", "development")
    created = create_task(api_client, system, title="Restart recovery")
    local = api_client.post("/api/auth/local-session")
    assert local.status_code == 200
    assert api_client.get("/api/me", headers={"Authorization": f"Bearer {local.json()['token']}"}).status_code == 200

    with TestClient(app, client=("192.0.2.22", 50822)) as remote_client:
        denied = remote_client.post("/api/auth/local-session")
    assert denied.status_code == 403

    restarted_engine = make_engine(system["database_url"])
    restarted_factory = sessionmaker(bind=restarted_engine, expire_on_commit=False)
    with restarted_factory() as session:
        task = session.get(Task, created["id"])
        audit = session.scalar(
            select(AuditEvent).where(AuditEvent.entity_id == created["id"], AuditEvent.action == "task.created")
        )
        assert task is not None
        assert audit is not None
    restarted_engine.dispose()


def test_task_patch_can_clear_optional_assignments(api_client, system):
    task = create_task(
        api_client,
        system,
        title="Clear assignee",
        assignee_id=system["agents"]["worker-a"],
        reviewer_id=system["agents"]["reviewer-c"],
    )
    response = api_client.patch(
        f"/api/tasks/{task['id']}", json={"assignee_id": None, "reviewer_id": None}, headers=headers(system, "manager")
    )
    assert response.status_code == 200
    assert response.json()["assignee_id"] is None
    assert response.json()["reviewer_id"] is None

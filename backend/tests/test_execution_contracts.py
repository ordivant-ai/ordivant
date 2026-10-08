from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import select

from ordivant.models import (
    Agent,
    Execution,
    IdempotencyRecord,
    OutboxEvent,
    ProjectMembership,
    RunEvent,
    RunMirror,
    RunToolConnectionSnapshot,
    ToolConnection,
    WorkflowInstance,
    WorkflowSchedule,
)
from ordivant.security import now_utc


def headers(system, name: str, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {system['tokens'][name]}"}
    if key:
        result["Idempotency-Key"] = key
    return result


def post_task(api_client, system, project_id: str, **values):
    result = api_client.post(
        "/api/tasks",
        json={"project_id": project_id, "title": "Execution contract test", "goal": "test", **values},
        headers=headers(system, "manager"),
    )
    assert result.status_code == 201, result.text
    return result.json()


def claim_runtime_event(api_client, system, run_id: str, worker_id: str):
    response = api_client.post(
        "/api/runtime/outbox/claim",
        json={"worker_id": worker_id, "limit": 10},
        headers=headers(system, "runtime"),
    )
    assert response.status_code == 200, response.text
    event = next(item for item in response.json() if item["id"] == run_id)
    return {**event, "worker_id": worker_id}


def runtime_handoff(api_client, system, event: dict):
    return api_client.post(
        f"/api/runtime/outbox/{event['id']}/configuration",
        json={"worker_id": event["worker_id"], "delivery_token": event["delivery_token"]},
        headers=headers(system, "runtime"),
    )


def test_run_mirror_queued_stop_and_retry_are_transactional_and_idempotent(api_client, system):
    task = post_task(api_client, system, system["ids"]["project"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    assert dispatch.status_code == 201, dispatch.text
    run_id = dispatch.json()["id"]

    with system["factory"]() as session:
        assert session.get(OutboxEvent, run_id) is not None
        run = session.get(RunMirror, run_id)
        assert run is not None and run.id == run_id and run.status == "queued"

    stopped = api_client.post(
        f"/api/runs/{run_id}/control", json={"action": "stop"}, headers=headers(system, "manager", "stop-key")
    )
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["status"] == "aborted"
    assert api_client.get("/api/runtime/outbox/claim", headers=headers(system, "runtime")).status_code == 405
    claim = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "runtime-test", "limit": 10}, headers=headers(system, "runtime")
    )
    assert claim.status_code == 200 and all(item["id"] != run_id for item in claim.json())

    retry = api_client.post(
        f"/api/runs/{run_id}/control", json={"action": "retry"}, headers=headers(system, "manager", "retry-key")
    )
    duplicate = api_client.post(
        f"/api/runs/{run_id}/control", json={"action": "retry"}, headers=headers(system, "manager", "retry-key")
    )
    assert retry.status_code == 200, retry.text
    assert duplicate.status_code == 200 and duplicate.json()["id"] == retry.json()["id"]
    assert retry.json()["id"] != run_id and retry.json()["retry_of"] == run_id
    assert api_client.get(f"/api/tasks/{task['id']}", headers=headers(system, "manager")).json()["status"] == "ready"


def test_runtime_run_sync_fences_sequence_and_sanitizes_receipts_events_and_answer(api_client, system):
    task = post_task(api_client, system, system["ids"]["project"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    run_id = dispatch.json()["id"]
    claim = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "runtime-test", "limit": 5}, headers=headers(system, "runtime")
    )
    event = next(item for item in claim.json() if item["id"] == run_id)
    delivery = {"worker_id": "runtime-test", "delivery_token": event["delivery_token"]}
    sync_url = f"/api/runtime/runs/{run_id}/sync"
    claimed_task = api_client.post(
        f"/api/tasks/{task['id']}/claim", json={"lease_seconds": 300}, headers=headers(system, "worker_b")
    )
    assert claimed_task.status_code == 200, claimed_task.text
    execution = claimed_task.json()["execution"]
    lease_token = claimed_task.json()["lease_token"]

    running = {
        **delivery,
        "sequence": 1,
        "status": "running",
        "execution_id": execution["id"],
        "mode": "demo",
        "events": [{"kind": "model", "data": {"api_key": "synthetic-event-secret", "text": "Bearer synthetic-event-token"}}],
    }
    first = api_client.post(sync_url, json=running, headers=headers(system, "runtime"))
    duplicate = api_client.post(sync_url, json=running, headers=headers(system, "runtime"))
    assert first.status_code == 200 and duplicate.status_code == 200
    assert first.json()["status"] == duplicate.json()["status"] == "running"
    second_running = api_client.post(
        sync_url,
        json={**delivery, "sequence": 2, "status": "running", "execution_id": execution["id"], "events": []},
        headers=headers(system, "runtime"),
    )
    assert second_running.status_code == 200
    stale = api_client.post(sync_url, json={**delivery, "sequence": 1, "status": "running"}, headers=headers(system, "runtime"))
    assert stale.status_code == 409

    terminal = {
        **delivery,
        "sequence": 3,
        "status": "done",
        "execution_id": execution["id"],
        "mode": "demo",
        "receipt": {"mode": "demo", "requested": None, "returned": None, "usage": None, "tools": [], "cost_usd": 17.5},
        "answer": "API_KEY=synthetic-answer-secret",
        "events": [{"kind": "tool_end", "data": {"result": "safe"}}],
    }
    premature_done = api_client.post(sync_url, json=terminal, headers=headers(system, "runtime"))
    assert premature_done.status_code == 409
    assert premature_done.json()["detail"]["code"] == "run_completion_unsubmitted"
    submitted = api_client.post(
        f"/api/tasks/{task['id']}/submit",
        json={
            "execution_id": execution["id"],
            "lease_token": lease_token,
            "summary": "Execution result submitted",
            "artifacts": [{"kind": "summary", "title": "Result", "content": "submitted"}],
        },
        headers=headers(system, "worker_b"),
    )
    assert submitted.status_code == 200, submitted.text
    result = api_client.post(sync_url, json=terminal, headers=headers(system, "runtime"))
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "done" and result.json()["receipt"]["cost_usd"] is None
    assert "synthetic-answer-secret" not in result.text and "synthetic-event-secret" not in result.text
    assert "synthetic-event-token" not in result.text
    replay = api_client.post(sync_url, json=terminal, headers=headers(system, "runtime"))
    changed_token = api_client.post(
        sync_url,
        json={**terminal, "delivery_token": "different-delivery-token-12345"},
        headers=headers(system, "runtime"),
    )
    changed_payload = api_client.post(sync_url, json={**terminal, "answer": "different"}, headers=headers(system, "runtime"))
    changed_worker = api_client.post(sync_url, json={**terminal, "worker_id": "other-worker"}, headers=headers(system, "runtime"))
    assert replay.status_code == 200 and replay.json() == result.json()
    assert changed_token.status_code == changed_payload.status_code == changed_worker.status_code == 409
    events = api_client.get(f"/api/runs/{run_id}/events", headers=headers(system, "manager"))
    assert events.status_code == 200
    assert all("api_key" not in json.dumps(item).lower() for item in events.json())
    assert "synthetic-event-token" not in events.text
    with system["factory"]() as session:
        run = session.get(RunMirror, run_id)
        outbox = session.get(OutboxEvent, run_id)
        assert run.last_sync_sequence == 3 and outbox.status == "delivered" and outbox.delivery_token_hash is None
        assert session.scalar(select(RunEvent.id).where(RunEvent.run_id == run_id)) is not None


def test_done_sync_accepts_submitted_execution_after_fast_rejection(api_client, system):
    task = post_task(api_client, system, system["ids"]["project"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    run_id = dispatch.json()["id"]
    outbox = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "runtime-test", "limit": 5}, headers=headers(system, "runtime")
    )
    event = next(item for item in outbox.json() if item["id"] == run_id)
    delivery = {"worker_id": "runtime-test", "delivery_token": event["delivery_token"]}
    claim = api_client.post(
        f"/api/tasks/{task['id']}/claim", json={"lease_seconds": 300}, headers=headers(system, "worker_b")
    )
    execution = claim.json()["execution"]
    lease_token = claim.json()["lease_token"]
    running = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={**delivery, "sequence": 1, "status": "running", "execution_id": execution["id"], "mode": "demo"},
        headers=headers(system, "runtime"),
    )
    assert running.status_code == 200, running.text
    submitted = api_client.post(
        f"/api/tasks/{task['id']}/submit",
        json={
            "execution_id": execution["id"],
            "lease_token": lease_token,
            "summary": "Result submitted before fast review",
            "artifacts": [{"kind": "test_report", "title": "Evidence", "content": "reviewed"}],
        },
        headers=headers(system, "worker_b"),
    )
    assert submitted.status_code == 200, submitted.text
    rejected = api_client.post(
        f"/api/tasks/{task['id']}/review",
        json={"decision": "reject", "comment": "Needs another attempt."},
        headers=headers(system, "reviewer"),
    )
    assert rejected.status_code == 200 and rejected.json()["task"]["status"] == "ready"
    terminal = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={
            **delivery,
            "sequence": 2,
            "status": "done",
            "execution_id": execution["id"],
            "mode": "demo",
            "answer": "The submitted execution completed.",
        },
        headers=headers(system, "runtime"),
    )
    assert terminal.status_code == 200, terminal.text
    assert terminal.json()["status"] == "done" and terminal.json()["execution_id"] == execution["id"]


def test_active_run_stop_fences_execution_until_runtime_abort_ack(api_client, system):
    task = post_task(api_client, system, system["ids"]["project"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    run_id = dispatch.json()["id"]
    claim_outbox = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "runtime-test", "limit": 5}, headers=headers(system, "runtime")
    )
    event = next(item for item in claim_outbox.json() if item["id"] == run_id)
    claim_task = api_client.post(
        f"/api/tasks/{task['id']}/claim",
        json={"lease_seconds": 300},
        headers=headers(system, "worker_b"),
    )
    assert claim_task.status_code == 200, claim_task.text
    execution = claim_task.json()["execution"]
    lease = claim_task.json()["lease_token"]
    delivery = {"worker_id": "runtime-test", "delivery_token": event["delivery_token"]}
    sync = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={**delivery, "sequence": 1, "status": "running", "execution_id": execution["id"], "mode": "demo"},
        headers=headers(system, "runtime"),
    )
    assert sync.status_code == 200, sync.text

    stopped = api_client.post(
        f"/api/runs/{run_id}/control", json={"action": "stop"}, headers=headers(system, "manager", "active-stop")
    )
    assert stopped.status_code == 200 and stopped.json()["status"] == "running"
    assert stopped.json()["desired_action"] == "stop"
    assert api_client.get(f"/api/tasks/{task['id']}", headers=headers(system, "manager")).json()["status"] == "ready"
    for action in ("pause", "resume", "retry"):
        rejected = api_client.post(
            f"/api/runs/{run_id}/control",
            json={"action": action},
            headers=headers(system, "manager", f"invalid-{action}"),
        )
        assert rejected.status_code == 409

    progress = api_client.post(
        f"/api/tasks/{task['id']}/progress",
        json={"execution_id": execution["id"], "lease_token": lease, "progress": 50},
        headers=headers(system, "worker_b"),
    )
    submit = api_client.post(
        f"/api/tasks/{task['id']}/submit",
        json={
            "execution_id": execution["id"],
            "lease_token": lease,
            "summary": "stale result",
            "artifacts": [{"kind": "summary", "title": "stale", "content": "stale"}],
        },
        headers=headers(system, "worker_b"),
    )
    assert progress.status_code == 409 and submit.status_code == 409
    done_while_stopping = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={
            **delivery,
            "sequence": 2,
            "status": "done",
            "execution_id": execution["id"],
            "mode": "demo",
            "answer": "stale completion",
        },
        headers=headers(system, "runtime"),
    )
    assert done_while_stopping.status_code == 409
    assert done_while_stopping.json()["detail"]["code"] == "run_stopping"
    with system["factory"]() as session:
        outbox = session.get(OutboxEvent, run_id)
        run = session.get(RunMirror, run_id)
        assert outbox.status == "claimed" and outbox.worker_id == "runtime-test"
        assert run.status == "running" and run.desired_action == "stop"

    aborted = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={**delivery, "sequence": 2, "status": "aborted", "execution_id": execution["id"], "mode": "demo"},
        headers=headers(system, "runtime"),
    )
    assert aborted.status_code == 200 and aborted.json()["status"] == "aborted"
    assert aborted.json()["desired_action"] is None
    retry = api_client.post(
        f"/api/runs/{run_id}/control", json={"action": "retry"}, headers=headers(system, "manager", "after-abort-retry")
    )
    assert retry.status_code == 200 and retry.json()["retry_of"] == run_id and retry.json()["id"] != run_id


def test_runtime_handoff_recovers_renewed_execution_after_delivery_restart(api_client, system):
    task = post_task(api_client, system, system["ids"]["project"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    run_id = dispatch.json()["id"]
    first_event = claim_runtime_event(api_client, system, run_id, "runtime-before-restart")
    first_handoff = runtime_handoff(api_client, system, first_event)
    assert first_handoff.status_code == 200, first_handoff.text
    assert first_handoff.json()["execution_lease"] is None

    claimed = api_client.post(
        f"/api/tasks/{task['id']}/claim",
        json={"lease_seconds": 300},
        headers=headers(system, "worker_b"),
    )
    assert claimed.status_code == 200, claimed.text
    execution_id = claimed.json()["execution"]["id"]
    running = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={
            "worker_id": first_event["worker_id"],
            "delivery_token": first_event["delivery_token"],
            "sequence": 1,
            "status": "running",
            "execution_id": execution_id,
            "mode": "demo",
        },
        headers=headers(system, "runtime"),
    )
    assert running.status_code == 200, running.text
    renewed = api_client.post(
        f"/api/tasks/{task['id']}/renew",
        json={"execution_id": execution_id, "lease_token": claimed.json()["lease_token"], "lease_seconds": 300},
        headers=headers(system, "worker_b"),
    )
    assert renewed.status_code == 200, renewed.text
    renewed_token = renewed.json()["lease_token"]

    with system["factory"]() as session:
        event = session.get(OutboxEvent, run_id)
        event.claim_expires_at = now_utc() - timedelta(seconds=1)
        session.commit()

    second_event = claim_runtime_event(api_client, system, run_id, "runtime-after-restart")
    recovered = runtime_handoff(api_client, system, second_event)
    assert recovered.status_code == 200, recovered.text
    lease = recovered.json()["execution_lease"]
    assert lease is not None
    assert lease["task_id"] == task["id"]
    assert lease["execution_id"] == execution_id
    assert lease["agent_id"] == system["agents"]["worker-b"]
    assert lease["lease_token"] != renewed_token
    assert lease["expires_at"] == renewed.json()["execution"]["lease_expires_at"]

    with system["factory"]() as session:
        executions = list(session.scalars(select(Execution).where(Execution.task_id == task["id"])))
        assert len(executions) == 1 and executions[0].id == execution_id

    old_token = api_client.post(
        f"/api/tasks/{task['id']}/progress",
        json={"execution_id": execution_id, "lease_token": renewed_token, "progress": 60},
        headers=headers(system, "worker_b"),
    )
    recovered_token = api_client.post(
        f"/api/tasks/{task['id']}/progress",
        json={"execution_id": execution_id, "lease_token": lease["lease_token"], "progress": 60},
        headers=headers(system, "worker_b"),
    )
    assert old_token.status_code == 409
    assert recovered_token.status_code == 200, recovered_token.text


def test_runtime_handoff_does_not_recover_expired_execution_lease(api_client, system):
    task = post_task(api_client, system, system["ids"]["project"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    run_id = dispatch.json()["id"]
    first_event = claim_runtime_event(api_client, system, run_id, "runtime-before-restart")
    claimed = api_client.post(
        f"/api/tasks/{task['id']}/claim",
        json={"lease_seconds": 300},
        headers=headers(system, "worker_b"),
    )
    assert claimed.status_code == 200, claimed.text
    execution_id = claimed.json()["execution"]["id"]
    running = api_client.post(
        f"/api/runtime/runs/{run_id}/sync",
        json={
            "worker_id": first_event["worker_id"],
            "delivery_token": first_event["delivery_token"],
            "sequence": 1,
            "status": "running",
            "execution_id": execution_id,
            "mode": "demo",
        },
        headers=headers(system, "runtime"),
    )
    assert running.status_code == 200, running.text

    with system["factory"]() as session:
        event = session.get(OutboxEvent, run_id)
        execution = session.get(Execution, execution_id)
        event.claim_expires_at = now_utc() - timedelta(seconds=1)
        execution.lease_expires_at = now_utc() - timedelta(seconds=1)
        old_token_hash = execution.lease_token_hash
        old_expiry = execution.lease_expires_at
        session.commit()

    second_event = claim_runtime_event(api_client, system, run_id, "runtime-after-restart")
    recovered = runtime_handoff(api_client, system, second_event)
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["execution_lease"] is None
    with system["factory"]() as session:
        execution = session.get(Execution, execution_id)
        assert execution.lease_token_hash == old_token_hash
        assert execution.lease_expires_at.replace(tzinfo=None) == old_expiry.replace(tzinfo=None)


def test_runtime_handoff_does_not_recover_execution_from_another_run(api_client, system):
    tasks = [post_task(api_client, system, system["ids"]["project"]) for _ in range(2)]
    agents = [system["agents"]["worker-b"], system["agents"]["worker-a"]]
    runs = []
    executions = []
    with system["factory"]() as session:
        session.get(Agent, agents[1]).runtime = "pi"
        session.commit()
    for task, agent_id in zip(tasks, agents, strict=True):
        dispatch = api_client.post(
            f"/api/tasks/{task['id']}/dispatch",
            json={"agent_id": agent_id},
            headers=headers(system, "manager"),
        )
        assert dispatch.status_code == 201, dispatch.text
        runs.append(dispatch.json()["id"])

    claimed_events = api_client.post(
        "/api/runtime/outbox/claim",
        json={"worker_id": "runtime-before-restart", "limit": 10},
        headers=headers(system, "runtime"),
    )
    assert claimed_events.status_code == 200, claimed_events.text
    deliveries = {item["id"]: {**item, "worker_id": "runtime-before-restart"} for item in claimed_events.json()}

    for task, run_id, worker_name in zip(tasks, runs, ("worker_b", "worker_a"), strict=True):
        claimed = api_client.post(
            f"/api/tasks/{task['id']}/claim",
            json={"lease_seconds": 300},
            headers=headers(system, worker_name),
        )
        assert claimed.status_code == 200, claimed.text
        execution = claimed.json()["execution"]
        executions.append(execution)
        running = api_client.post(
            f"/api/runtime/runs/{run_id}/sync",
            json={
                "worker_id": deliveries[run_id]["worker_id"],
                "delivery_token": deliveries[run_id]["delivery_token"],
                "sequence": 1,
                "status": "running",
                "execution_id": execution["id"],
                "mode": "demo",
            },
            headers=headers(system, "runtime"),
        )
        assert running.status_code == 200, running.text

    with system["factory"]() as session:
        run = session.get(RunMirror, runs[0])
        other_execution = session.get(Execution, executions[1]["id"])
        run.execution_id = other_execution.id
        other_token_hash = other_execution.lease_token_hash
        session.commit()

    handoff = runtime_handoff(api_client, system, deliveries[runs[0]])
    assert handoff.status_code == 200, handoff.text
    assert handoff.json()["execution_lease"] is None
    with system["factory"]() as session:
        other_execution = session.get(Execution, executions[1]["id"])
        assert other_execution.lease_token_hash == other_token_hash


def test_agent_project_bindings_are_filtered_in_each_dispatch_snapshot(api_client, system, tmp_path, monkeypatch):
    monkeypatch.setenv("ORDIVANT_DATA_DIR", str(tmp_path / "work-data"))
    monkeypatch.setenv("ORDIVANT_TOOL_ALLOWED_HOSTS", "fixture.internal")
    monkeypatch.setenv("ORDIVANT_TOOL_HTTP_HOSTS", "fixture.internal")
    monkeypatch.setenv("ORDIVANT_TOOL_PRIVATE_HOSTS", "fixture.internal")
    monkeypatch.setattr(
        "ordivant.tool_connections.socket.getaddrinfo",
        lambda host, port, type=None: [(2, 1, 6, "", ("127.0.0.1", port))],
    )

    project_a = system["ids"]["project"]
    project_b = system["ids"]["isolated_project"]
    created = []
    for project_id, label, secret in ((project_a, "A", "synthetic-tool-secret-A"), (project_b, "B", "synthetic-tool-secret-B")):
        response = api_client.post(
            "/api/tool-connections",
            json={
                "project_id": project_id,
                "name": f"Tool {label}",
                "endpoint": "http://fixture.internal:8050/mcp",
                "allowed_tools": ["synthetic_add"],
                "auth_token": secret,
            },
            headers=headers(system, "manager", f"tool-secret-{label}"),
        )
        assert response.status_code == 201, response.text
        assert secret not in response.text and "auth_token" not in response.json()
        created.append((response.json(), secret))

    profile = api_client.post(
        "/api/sandbox-profiles",
        json={"project_id": project_b, "name": "Project B sandbox", "enabled": True, "limits": {}},
        headers=headers(system, "manager"),
    )
    assert profile.status_code == 201, profile.text
    tool_a, secret_a = created[0]
    tool_b, secret_b = created[1]
    agent = api_client.post(
        "/api/agents",
        json={
            "name": "Multi-project execution agent",
            "role": "worker",
            "project_ids": [project_a, project_b],
            "runtime": "pi",
            "execution_config": {
                "instructions": "project-scoped tools",
                "tool_connection_ids": [tool_a["id"], tool_b["id"]],
                "sandbox_profile_id": profile.json()["id"],
            },
        },
        headers=headers(system, "manager"),
    )
    assert agent.status_code == 201, agent.text

    template = api_client.post(
        "/api/agent-templates",
        json={
            "key": "project-a-tool-template",
            "name": "Project A tool template",
            "definition": {
                "role": "worker",
                "capabilities": [],
                "instructions": "project A",
                "tool_connection_ids": [tool_a["id"]],
                "sandbox_profile_id": None,
                "limits": {"max_turns": 20, "timeout_seconds": 600},
            },
        },
        headers=headers(system, "manager"),
    )
    assert template.status_code == 201, template.text
    visible = api_client.get("/api/agent-templates", headers=headers(system, "outsider"))
    assert visible.status_code == 200 and all(item["id"] != template.json()["id"] for item in visible.json())

    invalid = api_client.post(
        "/api/tool-connections",
        json={
            "project_id": project_a,
            "name": "Invalid endpoint",
            "endpoint": "not a URL",
            "auth_token": "synthetic-invalid-tool-secret",
            "extra_secret": "synthetic-invalid-tool-secret",
        },
        headers=headers(system, "manager"),
    )
    assert invalid.status_code == 422 and "synthetic-invalid-tool-secret" not in invalid.text
    assert '"input"' not in invalid.text and '"ctx"' not in invalid.text

    task = post_task(api_client, system, project_a, assignee_id=agent.json()["id"])
    dispatch = api_client.post(
        f"/api/tasks/{task['id']}/dispatch", json={"agent_id": agent.json()["id"]}, headers=headers(system, "manager")
    )
    assert dispatch.status_code == 201, dispatch.text
    payload_config = dispatch.json()["payload"]["execution_config"]
    assert payload_config["tool_connection_ids"] == [tool_a["id"]]
    assert payload_config["sandbox_profile_id"] is None
    assert secret_a not in dispatch.text and secret_b not in dispatch.text
    claimed = api_client.post(
        "/api/runtime/outbox/claim", json={"worker_id": "runtime-test", "limit": 5}, headers=headers(system, "runtime")
    )
    event = next(item for item in claimed.json() if item["id"] == dispatch.json()["id"])
    handoff = api_client.post(
        f"/api/runtime/outbox/{event['id']}/configuration",
        json={"worker_id": "runtime-test", "delivery_token": event["delivery_token"]},
        headers=headers(system, "runtime"),
    )
    assert handoff.status_code == 200, handoff.text
    assert [item["id"] for item in handoff.json()["tool_connections"]] == [tool_a["id"]]
    assert handoff.json()["tool_connections"][0]["auth_token"] == secret_a
    assert secret_b not in handoff.text
    sync = api_client.post(
        f"/api/runtime/runs/{event['id']}/sync",
        json={
            "worker_id": "runtime-test",
            "delivery_token": event["delivery_token"],
            "sequence": 1,
            "status": "running",
            "mode": "demo",
            "answer": f"tool echoed {secret_a}",
            "events": [{"kind": "tool_end", "data": {"result": secret_a}}],
        },
        headers=headers(system, "runtime"),
    )
    assert sync.status_code == 200 and secret_a not in sync.text
    with system["factory"]() as session:
        snapshots = list(session.scalars(select(RunToolConnectionSnapshot).where(RunToolConnectionSnapshot.run_id == event["id"])))
        assert len(snapshots) == 1 and snapshots[0].connection_id == tool_a["id"]
        assert snapshots[0].auth_token_ciphertext != secret_a
        connections = list(session.scalars(select(ToolConnection).order_by(ToolConnection.project_id)))
        assert len(connections) == 2 and all(row.auth_token_ciphertext not in {secret_a, secret_b} for row in connections)
        cached_tool_secret = session.scalar(
            select(IdempotencyRecord).where(IdempotencyRecord.route == "/api/tool-connections")
        )
        assert cached_tool_secret is None


def test_new_project_workflow_tick_admits_runtime_and_creates_one_outbox(api_client, system):
    project = api_client.post(
        "/api/projects", json={"key": "FRESH", "name": "Fresh workflow project"}, headers=headers(system, "manager")
    )
    assert project.status_code == 201, project.text
    project_id = project.json()["id"]
    agent = api_client.post(
        "/api/agents",
        json={"name": "Fresh Pi worker", "role": "worker", "capabilities": ["fresh"], "project_ids": [project_id], "runtime": "pi"},
        headers=headers(system, "manager"),
    )
    assert agent.status_code == 201, agent.text
    workflow = api_client.post(
        "/api/workflows",
        json={
            "project_id": project_id,
            "key": "fresh-flow",
            "name": "Fresh flow",
            "steps": [{"key": "build", "title": "Build", "goal": "Build", "agent_id": agent.json()["id"], "capabilities": []}],
            "schedule": {"enabled": True, "interval_minutes": 1, "max_runs": 1},
        },
        headers=headers(system, "manager"),
    )
    assert workflow.status_code == 201, workflow.text
    assert workflow.json()["schedule"]["enabled"] is True
    assert workflow.json()["next_run_at"] is not None
    with system["factory"]() as session:
        membership = session.scalar(
            select(ProjectMembership.id).where(
                ProjectMembership.project_id == project_id, ProjectMembership.principal_id == system["ids"]["runtime"]
            )
        )
        schedule = session.get(WorkflowSchedule, workflow.json()["id"])
        assert membership is not None and schedule is not None
        schedule.next_run_at = now_utc() - timedelta(minutes=2)
        session.commit()

    tick = api_client.post("/api/runtime/workflows/tick", json={}, headers=headers(system, "runtime"))
    assert tick.status_code == 200, tick.text
    assert tick.json()["admitted_schedules"] == 1
    instances = api_client.get("/api/workflow-runs", params={"project_id": project_id}, headers=headers(system, "manager"))
    assert instances.status_code == 200 and len(instances.json()) == 1
    overlap = api_client.post(
        f"/api/workflows/{workflow.json()['id']}/start",
        json={},
        headers=headers(system, "manager", "overlap-key"),
    )
    assert overlap.status_code == 409 and overlap.json()["detail"]["code"] == "workflow_active"
    task_id = instances.json()[0]["steps"][0]["task_id"]
    run_list = api_client.get("/api/runs", params={"task_id": task_id}, headers=headers(system, "manager"))
    assert run_list.status_code == 200 and len(run_list.json()) == 1
    duplicate_tick = api_client.post("/api/runtime/workflows/tick", json={}, headers=headers(system, "runtime"))
    assert duplicate_tick.status_code == 200
    repeated = api_client.get("/api/runs", params={"task_id": task_id}, headers=headers(system, "manager"))
    assert len(repeated.json()) == 1
    with system["factory"]() as session:
        assert session.scalar(select(WorkflowInstance.id).where(WorkflowInstance.id == instances.json()[0]["id"])) is not None


def test_workflow_key_and_schedule_locks_follow_consistent_order(api_client, system, monkeypatch):
    from ordivant import automation

    lock_order = []
    original_lock_key = automation._lock_workflow_key
    original_lock_schedule = automation._lock_workflow_schedule

    def record_key_lock(session, workflow, *, skip_locked=False):
        lock_order.append("key")
        return original_lock_key(session, workflow, skip_locked=skip_locked)

    def record_schedule_lock(session, workflow_id):
        lock_order.append("schedule")
        return original_lock_schedule(session, workflow_id)

    monkeypatch.setattr(automation, "_lock_workflow_key", record_key_lock)
    monkeypatch.setattr(automation, "_lock_workflow_schedule", record_schedule_lock)
    step = {
        "key": "build",
        "title": "Build",
        "goal": "Build the result",
        "agent_id": system["agents"]["worker-b"],
        "capabilities": [],
    }
    created = api_client.post(
        "/api/workflows",
        json={"project_id": system["ids"]["project"], "key": "LOCK_ORDER", "name": "Lock order", "steps": [step]},
        headers=headers(system, "manager"),
    )
    assert created.status_code == 201, created.text

    version = api_client.post(
        f"/api/workflows/{created.json()['id']}/versions",
        json={"name": "Lock order v2", "steps": [step]},
        headers=headers(system, "manager"),
    )
    assert version.status_code == 201, version.text
    assert lock_order == ["key", "schedule"]

    lock_order.clear()
    schedule = api_client.patch(
        f"/api/workflows/{version.json()['id']}/schedule",
        json={"enabled": True, "interval_minutes": 1, "max_runs": 2},
        headers=headers(system, "manager"),
    )
    assert schedule.status_code == 200, schedule.text
    assert lock_order == ["key", "schedule"]

    lock_order.clear()
    started = api_client.post(
        f"/api/workflows/{version.json()['id']}/start",
        json={},
        headers=headers(system, "manager", "workflow-lock-order-start"),
    )
    assert started.status_code == 201, started.text
    assert lock_order == ["key", "schedule"]

    with system["factory"]() as session:
        due_schedule = session.get(WorkflowSchedule, version.json()["id"])
        due_schedule.next_run_at = now_utc() - timedelta(minutes=2)
        session.commit()
    lock_order.clear()
    tick = api_client.post("/api/runtime/workflows/tick", json={}, headers=headers(system, "runtime"))
    assert tick.status_code == 200, tick.text
    assert tick.json()["admitted_schedules"] == 0
    assert lock_order == ["key", "schedule"]

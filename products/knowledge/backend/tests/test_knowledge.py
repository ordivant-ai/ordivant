from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from fastapi.testclient import TestClient
from sqlalchemy import select

from ordivant_knowledge.main import create_app
from ordivant_knowledge.models import SpaceMembership
from ordivant_knowledge.seed import seed_knowledge

from conftest import auth, client_for


def test_versions_concurrency_provenance_search_and_scope(system):
    bootstrap = system["bootstrap"]
    writer = bootstrap["writer_token"]
    reader = bootstrap["reader_token"]
    primary = bootstrap["primary_scope_id"]
    isolated = bootstrap["isolated_scope_id"]
    task_ref = {
        "product": "work",
        "kind": "task",
        "uri": "ordivant://work/tasks/task-001",
        "title": "Knowledge acceptance task",
    }
    pr_ref = {
        "product": "code",
        "kind": "pull_request",
        "uri": "ordivant://code/repositories/repo-001/pulls/7",
        "title": "Knowledge PR provenance",
    }
    with client_for(system) as client:
        created = client.post(
            "/api/documents",
            headers=auth(writer, "create-knowledge-v1"),
            json={
                "space_id": primary,
                "title": "Ordivant delivery rules",
                "summary": "Versioned workflow",
                "body": "The first immutable body remains exact. baseline marker.",
                "tags": ["workflow", "acceptance"],
                "change_summary": "Create initial rules.",
                "source_refs": [task_ref],
            },
        )
        assert created.status_code == 201, created.text
        context = created.json()
        document_id = context["document"]["id"]
        assert context["document"]["current_version"] == 1
        assert context["version"]["body"] == "The first immutable body remains exact. baseline marker."
        assert context["version"]["content_sha256"] == hashlib.sha256(context["version"]["body"].encode()).hexdigest()
        assert context["version"]["source_refs"] == [task_ref]

    barrier = Barrier(2)

    def publish(client: TestClient, body: str):
        barrier.wait(timeout=10)
        return client.post(
            f"/api/documents/{document_id}/versions",
            headers=auth(writer, f"publish-{hashlib.sha256(body.encode()).hexdigest()[:10]}"),
            json={
                "expected_version": 1,
                "body": body,
                "change_summary": "Publish from concurrent writers.",
                "source_refs": [task_ref, pr_ref],
            },
        )

    app = system["app"]
    with TestClient(app, client=("127.0.0.1", 50882)) as client_a, TestClient(
        app, client=("127.0.0.1", 50883)
    ) as client_b:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda args: publish(*args), [(client_a, "v2 from writer A"), (client_b, "v2 from writer B")]))
    assert sorted(response.status_code for response in results) == [201, 409]
    winner = next(response.json() for response in results if response.status_code == 201)
    assert winner["version"] == 2
    assert winner["source_refs"] == [task_ref, pr_ref]

    with client_for(system) as client:
        old = client.get(f"/api/documents/{document_id}/versions/1", headers=auth(writer))
        latest = client.get(f"/api/documents/{document_id}", headers=auth(writer))
        assert old.status_code == 200
        assert old.json()["body"] == "The first immutable body remains exact. baseline marker."
        assert old.json()["content_sha256"] == hashlib.sha256(old.json()["body"].encode()).hexdigest()
        assert latest.json()["document"]["current_version"] == 2
        assert latest.json()["history"][0]["version"] == 2
        assert latest.json()["history"][1]["version"] == 1
        assert latest.json()["history"][1]["body"] == old.json()["body"]

        search = client.get("/api/documents", params={"space_id": primary, "q": "v2 from writer"}, headers=auth(writer))
        assert search.status_code == 200
        result = search.json()[0]
        assert result["snippet"] == winner["body"]
        assert result["version"] == 2
        assert result["uri"] == f"ordivant://knowledge/spaces/{primary}/documents/{document_id}/versions/2"

        decision = client.post(
            "/api/decisions",
            headers=auth(writer, "decision-with-code-provenance"),
            json={
                "space_id": primary,
                "document_id": document_id,
                "title": "Publish after review",
                "body": "The selected version was checked against its Code PR.",
                "source_refs": [task_ref, pr_ref],
            },
        )
        assert decision.status_code == 201, decision.text
        assert decision.json()["source_refs"] == [task_ref, pr_ref]
        decisions = client.get("/api/decisions", params={"space_id": primary}, headers=auth(writer))
        assert decisions.json()[0]["id"] == decision.json()["id"]

        events = client.get("/api/events", params={"space_id": primary}, headers=auth(writer))
        assert events.status_code == 200
        publish_event = next(event for event in events.json() if event["action"] == "knowledge.document.version_published")
        assert publish_event["data"]["source_refs"] == [task_ref, pr_ref]

        assert client.get(f"/api/spaces/{isolated}", headers=auth(writer)).status_code == 404
        assert client.get(f"/api/documents/{document_id}", headers=auth(reader)).status_code == 200
        assert client.post(
            "/api/documents",
            headers=auth(reader),
            json={"space_id": primary, "title": "forbidden", "body": "reader write"},
        ).status_code == 403
        assert client.post(
            "/api/documents",
            headers=auth(writer),
            json={"space_id": isolated, "title": "hidden", "body": "cross-space"},
        ).status_code == 404


def test_idempotent_create_and_publish_replay_without_extra_versions(system):
    bootstrap = system["bootstrap"]
    writer = bootstrap["writer_token"]
    primary = bootstrap["primary_scope_id"]
    with client_for(system) as client:
        body = {
            "space_id": primary,
            "title": "Replay-safe document",
            "body": "First published content.",
            "change_summary": "Initial publish.",
        }
        first = client.post("/api/documents", headers=auth(writer, "document-create-replay"), json=body)
        replay = client.post("/api/documents", headers=auth(writer, "document-create-replay"), json=body)
        assert first.status_code == replay.status_code == 201
        assert replay.json() == first.json()
        assert len(replay.json()["history"]) == 1
        document_id = first.json()["document"]["id"]

        publish_body = {
            "expected_version": 1,
            "body": "Second published content.",
            "change_summary": "Publish revision two.",
        }
        first_version = client.post(
            f"/api/documents/{document_id}/versions",
            headers=auth(writer, "version-two-replay"),
            json=publish_body,
        )
        replayed_version = client.post(
            f"/api/documents/{document_id}/versions",
            headers=auth(writer, "version-two-replay"),
            json=publish_body,
        )
        assert first_version.status_code == replayed_version.status_code == 201
        assert replayed_version.json() == first_version.json()
        assert replayed_version.json()["version"] == 2
        assert len(client.get(f"/api/documents/{document_id}/versions", headers=auth(writer)).json()) == 2

        changed = {**publish_body, "body": "Changed request payload."}
        conflict = client.post(
            f"/api/documents/{document_id}/versions",
            headers=auth(writer, "version-two-replay"),
            json=changed,
        )
        assert conflict.status_code == 409
        assert conflict.json()["detail"]["code"] == "idempotency_conflict"


def test_idempotent_replay_rechecks_current_scope(system):
    bootstrap = system["bootstrap"]
    manager = bootstrap["manager_token"]
    primary = bootstrap["primary_scope_id"]
    body = {"space_id": primary, "title": "Scoped replay", "body": "Only visible while scoped."}
    with client_for(system) as client:
        first = client.post("/api/documents", headers=auth(manager, "scoped-document-create"), json=body)
        assert first.status_code == 201, first.text

        with system["app"].state.session_factory() as session:
            membership = session.scalar(
                select(SpaceMembership).where(
                    SpaceMembership.principal_id == bootstrap["manager_id"],
                    SpaceMembership.space_id == primary,
                )
            )
            assert membership is not None
            session.delete(membership)
            session.commit()

        replay = client.post("/api/documents", headers=auth(manager, "scoped-document-create"), json=body)
        assert replay.status_code == 404


def test_seed_local_sessions_and_database_survive_restart(system):
    bootstrap = system["bootstrap"]
    settings = system["settings"]
    database_url = system["database_url"]
    with client_for(system) as client:
        local = client.post("/api/auth/local-session", json={"principal_id": bootstrap["manager_id"]})
        default_local = client.post("/api/auth/local-session", json={})
        assert default_local.status_code == 200
        assert default_local.json()["principal"]["id"] == bootstrap["manager_id"]
        assert local.status_code == 200, local.text
        local_token = local.json()["token"]
        assert client.get("/api/me", headers=auth(local_token)).json()["id"] == bootstrap["manager_id"]
        health = client.get("/api/health").json()
        assert health == {"status": "ok", "product": "knowledge", "database": "sqlite", "mode": "development"}

        created = client.post(
            "/api/documents",
            headers=auth(bootstrap["writer_token"]),
            json={"space_id": bootstrap["primary_scope_id"], "title": "Restart proof", "body": "Persisted body."},
        )
        assert created.status_code == 201
        document_id = created.json()["document"]["id"]

    repeated_seed = seed_knowledge(settings=settings)
    assert repeated_seed == bootstrap
    restarted_app = create_app(database_url, mode="development")
    with TestClient(restarted_app, client=("127.0.0.1", 50884)) as restarted:
        result = restarted.get(f"/api/documents/{document_id}", headers=auth(bootstrap["writer_token"]))
        assert result.status_code == 200
        assert result.json()["version"]["body"] == "Persisted body."
        assert restarted.get("/api/spaces", headers=auth(bootstrap["reader_token"])).json() == [
            restarted.get(f"/api/spaces/{bootstrap['primary_scope_id']}", headers=auth(bootstrap["reader_token"])).json()
        ]
        serialized = json.dumps(result.json(), ensure_ascii=False)
        assert bootstrap["writer_token"] not in serialized

    production_app = create_app(database_url, mode="production")
    with TestClient(production_app, client=("127.0.0.1", 50885)) as production:
        disabled = production.post("/api/auth/local-session", json={"principal_id": bootstrap["manager_id"]})
        assert disabled.status_code == 403


def test_dev_proxy_secret_does_not_enable_production_sessions(system, tmp_path, monkeypatch):
    secret_file = tmp_path / "dev-proxy-secret"
    secret_file.write_text("generated-knowledge-test-secret", encoding="utf-8")
    monkeypatch.setenv("ORDIVANT_DEV_PROXY_TOKEN_FILE", str(secret_file))
    with TestClient(system["app"], client=("172.20.0.9", 50888)) as client:
        assert client.post("/api/auth/local-session", json={}, headers={"X-Forwarded-For": "127.0.0.1", "X-Ordivant-Dev-Proxy": "forged"}).status_code == 403
        assert client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": "generated-knowledge-test-secret"}).status_code == 200
    production_app = create_app(system["database_url"], mode="production")
    with TestClient(production_app, client=("172.20.0.9", 50889)) as client:
        assert client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": "generated-knowledge-test-secret"}).status_code == 403

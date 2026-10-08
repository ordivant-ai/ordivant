from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy import select

from ordivant.identity import IdentityBinding
from ordivant.model_settings import ModelSettingsOperatorAudit, _decrypt_secret, import_model_settings
from ordivant.models import (
    Agent,
    AgentModelConfig,
    AuthToken,
    AuditEvent,
    IdempotencyRecord,
    ModelProviderSetting,
    Organization,
    OutboxEvent,
    Principal,
    ProjectMembership,
)
from ordivant.security import hash_secret, issue_token, new_id, now_utc

from conftest import create_task, headers


SYNTHETIC_KEY = "synthetic-provider-key-never-send"
SELECTION_A = {
    "provider_id": "local-api",
    "model_id": "model-a",
    "reasoning_effort": "medium",
    "max_output_tokens": 4096,
}
SELECTION_B = {
    "provider_id": "local-api",
    "model_id": "model-b",
    "reasoning_effort": "high",
    "max_output_tokens": 8192,
}


def settings_body(*, revision=None, api_key=SYNTHETIC_KEY, base_url="https://models.invalid/v1", default=SELECTION_A):
    body = {
        "providers": [
            {
                "id": "local-api",
                "name": "Synthetic API",
                "base_url": base_url,
                "enabled": True,
                "models": [
                    {
                        "id": "model-a",
                        "name": "Model A",
                        "context_window": 32768,
                        "max_output_tokens": 4096,
                        "reasoning_efforts": ["low", "medium", "high"],
                    },
                    {
                        "id": "model-b",
                        "name": "Model B",
                        "context_window": 65536,
                        "max_output_tokens": 8192,
                        "reasoning_efforts": ["high", "xhigh"],
                    },
                ],
            }
        ],
        "default": default,
    }
    if api_key is not None:
        body["providers"][0]["api_key"] = api_key
    if revision is not None:
        body["revision"] = revision
    return body


def put_settings(api_client, system, body, *, idempotency_key="sensitive-model-settings"):
    return api_client.put(
        "/api/model-settings",
        json=body,
        headers=headers(system, "manager", idempotency_key),
    )


def test_settings_are_org_scoped_encrypted_revisioned_and_never_cached(api_client, system, tmp_path, monkeypatch):
    monkeypatch.setenv("ORDIVANT_DATA_DIR", str(tmp_path / "work-data"))
    initial = api_client.get("/api/model-settings", headers=headers(system, "manager"))
    assert initial.status_code == 200
    assert initial.json() == {"revision": 0, "providers": [], "default": None}

    first = put_settings(api_client, system, settings_body())
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 1
    assert SYNTHETIC_KEY not in first.text
    assert first.json()["providers"][0]["key_configured"] is True
    assert first.json()["default"] == SELECTION_A

    catalog = api_client.get("/api/model-catalog", headers=headers(system, "worker_b"))
    assert catalog.status_code == 200
    assert catalog.json()["providers"] == first.json()["providers"]
    assert "api_key" not in catalog.text

    with system["factory"]() as session:
        provider = session.get(ModelProviderSetting, (system["ids"]["organization"], "local-api"))
        assert provider is not None
        assert SYNTHETIC_KEY not in provider.api_key_ciphertext
        assert _decrypt_secret(provider.api_key_ciphertext, system["ids"]["organization"], "local-api") == SYNTHETIC_KEY
        assert session.scalar(select(IdempotencyRecord).where(IdempotencyRecord.route == "/api/model-settings")) is None
        audit = session.scalar(
            select(AuditEvent).where(AuditEvent.action == "model_settings.updated").order_by(AuditEvent.created_at.desc())
        )
        assert audit is not None and SYNTHETIC_KEY not in audit.data_json

    second = put_settings(api_client, system, settings_body(revision=1, api_key=""))
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2
    with system["factory"]() as session:
        provider = session.get(ModelProviderSetting, (system["ids"]["organization"], "local-api"))
        assert _decrypt_secret(provider.api_key_ciphertext, system["ids"]["organization"], "local-api") == SYNTHETIC_KEY

    stale = put_settings(api_client, system, settings_body(revision=1, api_key="another-synthetic-key"))
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "model_settings_revision_conflict"
    endpoint_change_without_key = put_settings(
        api_client, system, settings_body(revision=2, api_key=None, base_url="https://changed.invalid/v1")
    )
    assert endpoint_change_without_key.status_code == 422
    assert endpoint_change_without_key.json()["detail"]["code"] == "provider_key_required"
    endpoint_change_with_key = put_settings(
        api_client,
        system,
        settings_body(revision=2, api_key="replacement-synthetic-key", base_url="https://changed.invalid/v1"),
    )
    assert endpoint_change_with_key.status_code == 200
    assert endpoint_change_with_key.json()["revision"] == 3
    with system["factory"]() as session:
        provider = session.get(ModelProviderSetting, (system["ids"]["organization"], "local-api"))
        assert _decrypt_secret(provider.api_key_ciphertext, system["ids"]["organization"], "local-api") == "replacement-synthetic-key"

    other_org = Organization(id=new_id(), name="Other Org", created_at=now_utc())
    other_admin = Principal(
        id=new_id(), name="other-manager", kind="human", role="manager", organization_id=other_org.id, active=True
    )
    with system["factory"]() as session:
        session.add_all([other_org, other_admin])
        session.flush()
        other_token = issue_token(session, other_admin.id)
        session.commit()
    other_settings = api_client.get("/api/model-settings", headers={"Authorization": f"Bearer {other_token}"})
    assert other_settings.status_code == 200
    assert other_settings.json() == {"revision": 0, "providers": [], "default": None}
    assert "local-api" not in other_settings.text


def test_identity_member_manager_cannot_read_or_write_global_model_settings(api_client, system, monkeypatch):
    monkeypatch.setenv("ORDIVANT_AUTH_COOKIE_NAME", "ordivant_session")
    with system["factory"]() as session:
        session.add(
            IdentityBinding(
                subject="identity-member",
                principal_id=system["ids"]["manager"],
                organization_id=system["ids"]["organization"],
                identity_admin=False,
            )
        )
        session.commit()

    denied_read = api_client.get("/api/model-settings", headers=headers(system, "manager"))
    denied_write = put_settings(api_client, system, settings_body())
    assert denied_read.status_code == denied_write.status_code == 403

    with system["factory"]() as session:
        binding = session.get(IdentityBinding, "identity-member")
        binding.identity_admin = True
        session.commit()
    allowed_read = api_client.get("/api/model-settings", headers=headers(system, "manager"))
    assert allowed_read.status_code == 200


def test_invalid_settings_validation_does_not_echo_provider_key(api_client, system):
    body = settings_body()
    body["providers"][0].pop("name")
    response = put_settings(api_client, system, body)
    assert response.status_code == 422
    assert SYNTHETIC_KEY not in response.text
    assert "input" not in response.text
    with system["factory"]() as session:
        assert session.scalar(
            select(IdempotencyRecord).where(IdempotencyRecord.route == "/api/model-settings")
        ) is None
        assert session.scalar(
            select(AuditEvent).where(AuditEvent.action == "model_settings.updated")
        ) is None


def test_host_operator_import_uses_same_revision_encryption_and_nullable_audit(api_client, system, tmp_path, monkeypatch):
    monkeypatch.setenv("ORDIVANT_DATA_DIR", str(tmp_path / "work-data"))
    with system["factory"]() as session:
        imported = import_model_settings(session, system["ids"]["organization"], settings_body())
        assert imported["revision"] == 1
        session.commit()
    with system["factory"]() as session:
        audit = session.scalar(
            select(ModelSettingsOperatorAudit).where(
                ModelSettingsOperatorAudit.action == "model_settings.operator_imported"
            )
        )
        provider = session.get(ModelProviderSetting, (system["ids"]["organization"], "local-api"))
        assert audit is not None and audit.actor_id is None
        assert SYNTHETIC_KEY not in audit.data_json
        assert _decrypt_secret(provider.api_key_ciphertext, system["ids"]["organization"], "local-api") == SYNTHETIC_KEY


def test_agent_model_override_null_clear_and_legacy_model_compatibility(api_client, system, tmp_path, monkeypatch):
    monkeypatch.setenv("ORDIVANT_DATA_DIR", str(tmp_path / "work-data"))
    saved = put_settings(api_client, system, settings_body())
    assert saved.status_code == 200, saved.text

    created = api_client.post(
        "/api/agents",
        json={
            "name": "configured-agent",
            "role": "worker",
            "project_ids": [system["ids"]["project"]],
            "runtime": "pi",
            "model": "legacy-model-name",
            "model_config": SELECTION_B,
        },
        headers=headers(system, "manager"),
    )
    assert created.status_code == 201, created.text
    assert created.json()["model"] == "legacy-model-name"
    assert created.json()["model_config"] == SELECTION_B
    assert created.json()["effective_model_config"] == SELECTION_B

    cleared = api_client.patch(
        f"/api/agents/{created.json()['id']}",
        json={"model_config": None},
        headers=headers(system, "manager"),
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["model"] == "legacy-model-name"
    assert cleared.json()["model_config"] is None
    assert cleared.json()["effective_model_config"] == SELECTION_A
    with system["factory"]() as session:
        assert session.get(AgentModelConfig, created.json()["id"]) is None


def test_dispatch_snapshot_handoff_fences_renews_and_revokes_agent_credential(
    api_client, system, tmp_path, monkeypatch
):
    monkeypatch.setenv("ORDIVANT_DATA_DIR", str(tmp_path / "work-data"))
    configured = put_settings(api_client, system, settings_body())
    assert configured.status_code == 200, configured.text

    new_project = api_client.post(
        "/api/projects",
        json={"key": "NEW", "name": "Newly created project"},
        headers=headers(system, "manager"),
    )
    assert new_project.status_code == 201, new_project.text
    project_id = new_project.json()["id"]
    agent = api_client.post(
        "/api/agents",
        json={
            "name": "new-project-runtime-agent",
            "role": "worker",
            "project_ids": [project_id],
            "runtime": "pi",
        },
        headers=headers(system, "manager"),
    )
    assert agent.status_code == 201, agent.text

    first_task = create_task(api_client, system, title="Snapshot first", project_id=project_id)
    dispatch = api_client.post(
        f"/api/tasks/{first_task['id']}/dispatch",
        json={"agent_id": agent.json()["id"]},
        headers=headers(system, "manager"),
    )
    assert dispatch.status_code == 201, dispatch.text
    event_id = dispatch.json()["id"]
    assert dispatch.json()["payload"]["model_config"] == SELECTION_A

    changed = put_settings(api_client, system, settings_body(revision=1, default=SELECTION_B, api_key=""))
    assert changed.status_code == 200, changed.text
    with system["factory"]() as session:
        event = session.get(OutboxEvent, event_id)
        payload = json.loads(event.payload_json)
        assert payload["model_config"] == SELECTION_A
        assert payload["execution_mode"] == "configured"
        runtime_membership = session.scalar(
            select(ProjectMembership).where(
                ProjectMembership.project_id == project_id,
                ProjectMembership.principal_id == system["ids"]["runtime"],
            )
        )
        assert runtime_membership is not None

    claimed = api_client.post(
        "/api/runtime/outbox/claim",
        json={"worker_id": "local-runtime", "limit": 1},
        headers=headers(system, "runtime"),
    )
    assert claimed.status_code == 200, claimed.text
    event = next(item for item in claimed.json() if item["id"] == event_id)
    delivery_body = {"worker_id": "local-runtime", "delivery_token": event["delivery_token"]}
    wrong_fence = api_client.post(
        f"/api/runtime/outbox/{event_id}/configuration",
        json={"worker_id": "stale-runtime", "delivery_token": event["delivery_token"]},
        headers=headers(system, "runtime"),
    )
    assert wrong_fence.status_code == 409
    wrong_token = api_client.post(
        f"/api/runtime/outbox/{event_id}/configuration",
        json={"worker_id": "local-runtime", "delivery_token": "delivery_invalid_token_value_123456"},
        headers=headers(system, "runtime"),
    )
    assert wrong_token.status_code == 409

    handoff = api_client.post(
        f"/api/runtime/outbox/{event_id}/configuration", json=delivery_body, headers=headers(system, "runtime")
    )
    assert handoff.status_code == 200, handoff.text
    assert handoff.headers["cache-control"] == "no-store"
    assert handoff.json()["model_config"] == SELECTION_A
    assert handoff.json()["provider"]["api_key"] == SYNTHETIC_KEY
    assert handoff.json()["provider"]["base_url"] == "https://models.invalid/v1"
    agent_token = handoff.json()["agent"]["token"]
    retry_handoff = api_client.post(
        f"/api/runtime/outbox/{event_id}/configuration", json=delivery_body, headers=headers(system, "runtime")
    )
    assert retry_handoff.status_code == 200
    assert retry_handoff.json()["agent"]["token"] == agent_token
    assert api_client.get("/api/me", headers={"Authorization": f"Bearer {agent_token}"}).status_code == 200
    assert api_client.get("/api/tasks", headers=headers(system, "runtime")).status_code == 403

    renew = api_client.post(
        f"/api/runtime/outbox/{event_id}/renew", json=delivery_body, headers=headers(system, "runtime")
    )
    assert renew.status_code == 200, renew.text
    assert renew.json()["id"] == event_id
    with system["factory"]() as session:
        event_row = session.get(OutboxEvent, event_id)
        event_row.claim_expires_at = now_utc() - timedelta(seconds=1)
        session.commit()
    expired = api_client.post(
        f"/api/runtime/outbox/{event_id}/configuration", json=delivery_body, headers=headers(system, "runtime")
    )
    assert expired.status_code == 409
    assert expired.json()["detail"]["code"] == "delivery_lease_expired"

    retried_claim = api_client.post(
        "/api/runtime/outbox/claim",
        json={"worker_id": "local-runtime", "limit": 1},
        headers=headers(system, "runtime"),
    )
    assert retried_claim.status_code == 200
    current_event = next(item for item in retried_claim.json() if item["id"] == event_id)
    current_delivery = {"worker_id": "local-runtime", "delivery_token": current_event["delivery_token"]}
    retried_handoff = api_client.post(
        f"/api/runtime/outbox/{event_id}/configuration",
        json=current_delivery,
        headers=headers(system, "runtime"),
    )
    assert retried_handoff.status_code == 200
    assert retried_handoff.json()["agent"]["token"] == agent_token
    with system["factory"]() as session:
        row = session.scalar(select(AuthToken).where(AuthToken.token_hash == hash_secret(agent_token)))
        assert row is not None
        assert row.principal_id == agent.json()["principal_id"]
        assert row.revoked_at is None

    ack = api_client.post(
        f"/api/runtime/outbox/{event_id}/ack",
        json={**current_delivery, "status": "delivered"},
        headers=headers(system, "runtime"),
    )
    assert ack.status_code == 200, ack.text
    assert api_client.get("/api/me", headers={"Authorization": f"Bearer {agent_token}"}).status_code == 401
    with system["factory"]() as session:
        row = session.scalar(select(AuthToken).where(AuthToken.token_hash == hash_secret(agent_token)))
        assert row is not None and row.revoked_at is not None


def test_dispatch_without_config_is_explicit_demo(api_client, system):
    task = create_task(api_client, system, title="Unconfigured demo")
    dispatched = api_client.post(
        f"/api/tasks/{task['id']}/dispatch",
        json={"agent_id": system["agents"]["worker-b"]},
        headers=headers(system, "manager"),
    )
    assert dispatched.status_code == 201, dispatched.text
    assert dispatched.json()["payload"]["model_config"] is None
    assert dispatched.json()["payload"]["execution_mode"] == "demo"

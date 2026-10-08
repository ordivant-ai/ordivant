"""Cookie/RBAC model settings acceptance on isolated QA with a synthetic provider key.

No provider requests are sent. This does not read or modify a user's account.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import httpx

from auth_acceptance import QA_EMAIL, QA_PASSWORD

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8092"


def main() -> int:
    tag = uuid.uuid4().hex[:8]
    report_dir = ROOT / ".data/validation" / ("model-settings-" + tag)
    report_dir.mkdir(parents=True, exist_ok=True)
    key = "qa-provider-fixture-" + uuid.uuid4().hex
    report = {"status": "running", "base_url": BASE, "provider_calls": 0, "checks": {}}

    def check(name, passed):
        report["checks"][name] = passed
        if not passed:
            raise RuntimeError(name)

    def request(client, method, path, body=None, status=200, headers=None):
        result = client.request(method, path, json=body, headers=headers)
        if result.status_code != status:
            raise RuntimeError(f"{method} {path}: HTTP {result.status_code}; response body suppressed")
        check("credential_absent_from_" + method.lower() + "_" + path.rsplit("/", 1)[-1], key not in result.text)
        return result

    try:
        with httpx.Client(base_url=BASE, headers={"Origin": BASE}, trust_env=False, timeout=20) as admin, httpx.Client(
            base_url=BASE, headers={"Origin": BASE}, trust_env=False, timeout=20
        ) as member, httpx.Client(base_url=BASE, trust_env=False, timeout=20) as anonymous:
            login = request(admin, "POST", "/auth-api/login", {"email": QA_EMAIL, "password": QA_PASSWORD}).json()
            admin.headers["X-CSRF-Token"] = login["csrf_token"]
            check("anonymous_settings_401", anonymous.get("/api/model-settings").status_code == 401)
            before = request(admin, "GET", "/api/model-settings")
            check("settings_response_no_store", before.headers.get("Cache-Control") == "no-store")
            current = before.json()
            provider = {"id": "qa-fixture", "name": "QA fixture（不連外）", "base_url": "https://fixture.invalid/v1",
                        "api_key": key, "enabled": True, "models": [{"id": "gpt-6.1-sol", "name": "GPT-6.1 Sol",
                        "context_window": 1050000, "max_output_tokens": 128000,
                        "reasoning_efforts": ["low", "medium", "high", "xhigh", "max"]}]}
            selection = {"provider_id": provider["id"], "model_id": "gpt-6.1-sol", "reasoning_effort": "low", "max_output_tokens": 4096}
            body = {"revision": current["revision"], "providers": [provider], "default": selection}
            check("settings_write_csrf_403", admin.put("/api/model-settings", json=body, headers={"X-CSRF-Token": "wrong"}).status_code == 403)
            check("settings_write_origin_403", admin.put("/api/model-settings", json=body, headers={"Origin": "https://untrusted.invalid"}).status_code == 403)
            malformed = {**body, "providers": [{field: value for field, value in provider.items() if field != "name"}]}
            invalid = request(admin, "PUT", "/api/model-settings", malformed, status=422)
            check("invalid_body_error_never_echoes_key", key not in invalid.text)
            saved_response = request(admin, "PUT", "/api/model-settings", body)
            saved = saved_response.json()
            check("settings_write_no_store", saved_response.headers.get("Cache-Control") == "no-store")
            check("admin_can_configure_connection", saved["default"] == selection and saved["providers"][0]["key_configured"])
            check("api_never_returns_ciphertext", "ciphertext" not in saved_response.text and "api_key" not in saved_response.text)
            check("stale_revision_409", admin.put("/api/model-settings", json=body).status_code == 409)
            body["revision"] = saved["revision"]
            body["providers"][0]["api_key"] = ""
            body["default"] = {**selection, "reasoning_effort": "medium"}
            saved = request(admin, "PUT", "/api/model-settings", body).json()
            check("empty_key_preserves_connection", saved["providers"][0]["key_configured"])
            changed_endpoint = {**body, "revision": saved["revision"], "providers": [{**body["providers"][0], "base_url": "https://other.invalid/v1"}]}
            check("new_endpoint_requires_explicit_key", admin.put("/api/model-settings", json=changed_endpoint).status_code == 422)
            body["revision"] = saved["revision"]
            body["default"] = selection
            saved = request(admin, "PUT", "/api/model-settings", body).json()
            catalog = request(admin, "GET", "/api/model-catalog").json()
            check("catalog_contains_secret_free_configured_model", catalog["default"] == selection and len(catalog["providers"]) == 1)
            project = request(admin, "POST", "/api/projects", {"key": "MODEL-" + tag, "name": "模型設定驗收 " + tag}, status=201).json()
            invite = request(admin, "POST", "/auth-api/invitations", {
                "email": "model-member-" + tag + "@example.com", "name": "Model QA Member", "role": "member",
                "permissions": {"work": {"role": "manager", "scope_ids": [project["id"]]},
                                "knowledge": {"role": "reader", "scope_ids": []}, "code": {"role": "reader", "scope_ids": []}},
            }, status=201).json()
            member_session = request(member, "POST", "/auth-api/accept-invitation", {
                "invitation_code": invite["invitation_code"], "password": QA_PASSWORD,
            }, status=201).json()
            member.headers["X-CSRF-Token"] = member_session["csrf_token"]
            request(member, "GET", "/api/me")
            check("scoped_manager_cannot_read_global_settings", member.get("/api/model-settings").status_code == 403)
            body["revision"] = saved["revision"]
            check("scoped_manager_cannot_write_global_settings", member.put("/api/model-settings", json=body).status_code == 403)
            check("member_can_select_catalog_without_key", request(member, "GET", "/api/model-catalog").json()["default"] == selection)
            agent = request(member, "POST", "/api/agents", {"name": "Model UI Fixture " + tag, "role": "worker", "runtime": "pi",
                "project_ids": [project["id"]], "capabilities": ["qa"], "model_config": None}, status=201).json()
            check("agent_inherits_global_default", agent["model_config"] is None and agent["effective_model_config"] == selection)
            changed = request(member, "PATCH", "/api/agents/" + agent["id"], {"model_config": {**selection, "reasoning_effort": "high", "max_output_tokens": 2048}}).json()
            check("agent_override_is_effective", changed["effective_model_config"]["reasoning_effort"] == "high")
            cleared = request(member, "PATCH", "/api/agents/" + agent["id"], {"model_config": None}).json()
            check("agent_explicit_null_restores_inheritance", cleared["model_config"] is None and cleared["effective_model_config"] == selection)
            check("output_below_adapter_minimum_rejected", member.patch("/api/agents/" + agent["id"], json={"model_config": {**selection, "max_output_tokens": 15}}).status_code == 422)
            check("output_above_model_ceiling_rejected", member.patch("/api/agents/" + agent["id"], json={"model_config": {**selection, "max_output_tokens": 128001}}).status_code == 422)
            report.update({"project_id": project["id"], "project_name": project["name"], "agent_id": agent["id"], "agent_name": agent["name"]})
            report["status"] = "passed"
        code = 0
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc).replace(key, "[redacted]")[:300] if isinstance(exc, RuntimeError) else type(exc).__name__
        code = 1
    (report_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"MODEL_SETTINGS_ACCEPTANCE_{report['status'].upper()}: {report_dir / 'report.json'}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())

"""Human login acceptance against the dedicated local ordivant-auth-qa project only.

Uses synthetic fixture credentials, never a user's account. Reports omit all handles,
CSRF tokens, passwords, invitation codes and recovery codes.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time
import uuid

import httpx

ROOT = Path(__file__).resolve().parents[1]
QA_EMAIL = "qa-browser@example.com"
QA_PASSWORD = "Ordivant-QA-Fixture-2026!"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8092")
    parser.add_argument("--containers", action="store_true", help="Restart/fail-closed checks on owned QA containers")
    args = parser.parse_args()
    if args.base_url != "http://127.0.0.1:8092":
        parser.error("This fixture only targets its isolated QA environment on 8092")
    base = args.base_url
    checks: dict[str, bool] = {}
    run = uuid.uuid4().hex[:8]
    headers = {"Origin": base}
    admin = httpx.Client(base_url=base, headers=headers, timeout=20, trust_env=False)
    anonymous = httpx.Client(base_url=base, headers=headers, timeout=20, trust_env=False)

    def check(name: str, result: bool):
        checks[name] = result
        if not result:
            raise AssertionError(name)

    def good(client: httpx.Client, method: str, path: str, body=None, expected=200):
        response = client.request(method, path, json=body, headers={"Idempotency-Key": str(uuid.uuid4())} if method not in {"GET", "HEAD"} else None)
        if response.status_code != expected:
            # Domain error only; never print successful authentication payloads.
            raise AssertionError(f"{method} {path}: HTTP {response.status_code} {response.text[:250]}")
        return response

    def session(client: httpx.Client, response: httpx.Response):
        data = response.json()
        client.headers["X-CSRF-Token"] = data["csrf_token"]
        return data

    report_dir = ROOT / ".data" / "validation" / f"auth-{run}"
    report_dir.mkdir(parents=True, exist_ok=True)
    try:
        status = good(anonymous, "GET", "/auth-api/status")
        check("auth_responses_no_store", status.headers.get("Cache-Control") == "no-store")
        if status.json()["setup_required"]:
            result = good(admin, "POST", "/auth-api/setup", {"name": "QA 管理員", "email": QA_EMAIL, "password": QA_PASSWORD}, expected=201)
        else:
            result = good(admin, "POST", "/auth-api/login", {"email": QA_EMAIL, "password": QA_PASSWORD})
        initial = session(admin, result)
        cookie_header = result.headers.get("set-cookie", "")
        check("cookie_httponly_lax_path", all(item in cookie_header.lower() for item in ["httponly", "samesite=lax", "path=/"]))
        check("no_session_handle_in_json", "session_token" not in initial and "password" not in initial)
        check("setup_closed_after_first_admin", admin.post("/auth-api/setup", json={"name": "Second", "email": "second@example.com", "password": QA_PASSWORD}).status_code == 409)
        check("anonymous_business_unauthorized", anonymous.get("/api/projects").status_code == 401)
        check("anonymous_introspection_unauthorized", anonymous.post("/auth-api/introspect", json={"session_token": "x" * 43}).status_code == 401)
        check("invalid_bearer_does_not_fall_back", admin.get("/api/me", headers={"Authorization": "Bearer invalid"}).status_code == 401)
        prefixes = {"work": "/api", "knowledge": "/knowledge-api", "code": "/code-api"}
        for product, prefix in prefixes.items():
            check(f"{product}_cookie_principal", good(admin, "GET", prefix + "/me").json()["name"] == "QA 管理員")
            check(f"{product}_local_session_disabled", anonymous.post(prefix + "/auth/local-session", json={}).status_code == 403)
        with ThreadPoolExecutor(max_workers=6) as pool:
            responses = list(pool.map(lambda _: admin.get("/api/me"), range(12)))
        check("concurrent_identity_mapping", all(response.status_code == 200 for response in responses) and len({r.json()["id"] for r in responses}) == 1)
        resources = {}
        for product, prefix in prefixes.items():
            route = "/spaces" if product == "knowledge" else "/projects"
            body = {"key": "auth-" + run, "name": "登入驗收專案 " + run}
            bad = admin.post(prefix + route, json=body, headers={"X-CSRF-Token": "wrong"})
            check(f"{product}_csrf_rejected", bad.status_code == 403)
            bad = admin.post(prefix + route, json=body, headers={"Origin": "http://untrusted.example", "Idempotency-Key": "bad-" + run})
            check(f"{product}_origin_rejected", bad.status_code == 403)
            resources[product] = good(admin, "POST", prefix + route, body, expected=201 if product != "code" else 200).json()
        permissions = {
            "work": {"role": "manager", "scope_ids": [resources["work"]["id"]]},
            "knowledge": {"role": "reader", "scope_ids": [resources["knowledge"]["id"]]},
            "code": {"role": "reader", "scope_ids": [resources["code"]["id"]]},
        }
        invited_email = f"member-{run}@example.com"
        invitation = good(admin, "POST", "/auth-api/invitations", {"email": invited_email, "name": "QA 成員", "role": "member", "permissions": permissions}, expected=201).json()
        member = httpx.Client(base_url=base, headers=headers, timeout=20, trust_env=False)
        accepted = session(member, good(member, "POST", "/auth-api/accept-invitation", {"invitation_code": invitation["invitation_code"], "password": QA_PASSWORD}, expected=201))
        with ThreadPoolExecutor(max_workers=6) as pool:
            first_responses = list(pool.map(lambda _: member.get("/api/me"), range(12)))
        check("concurrent_first_member_mapping", all(r.status_code == 200 for r in first_responses) and len({r.json()["id"] for r in first_responses}) == 1)
        check("invitation_single_use", anonymous.post("/auth-api/accept-invitation", json={"invitation_code": invitation["invitation_code"], "password": QA_PASSWORD}).status_code == 401)
        check("member_not_identity_admin", member.get("/auth-api/users").status_code == 403)
        for product, prefix in prefixes.items():
            route = "/spaces" if product == "knowledge" else "/projects"
            listing = good(member, "GET", prefix + route).json()
            check(f"{product}_member_explicit_scope", len(listing) == 1 and listing[0]["id"] == resources[product]["id"])
            check(f"{product}_member_cannot_expand_scope", member.post(prefix + route, json={"key": "deny-" + run, "name": "Denied"}, headers={"Idempotency-Key": "deny-" + product + run}).status_code == 403)
        check("last_admin_self_disable_rejected", admin.patch("/auth-api/users/" + initial["user"]["id"], json={"active": False}).status_code == 409)
        second = httpx.Client(base_url=base, headers=headers, timeout=20, trust_env=False)
        session(second, good(second, "POST", "/auth-api/login", {"email": invited_email, "password": QA_PASSWORD}))
        sessions = good(member, "GET", "/auth-api/sessions").json()["sessions"]
        other = next(item for item in sessions if not item["current"])
        good(member, "DELETE", "/auth-api/sessions/" + other["id"])
        check("revoked_session_rejected", second.get("/api/me").status_code == 401)
        session(second, good(second, "POST", "/auth-api/login", {"email": invited_email, "password": QA_PASSWORD}))
        new_password = "Changed-QA-Fixture-2026!"
        changed = session(member, good(member, "POST", "/auth-api/change-password", {"current_password": QA_PASSWORD, "new_password": new_password}))
        check("password_change_revokes_old_sessions", second.get("/api/me").status_code == 401)
        check("old_password_rejected", anonymous.post("/auth-api/login", json={"email": invited_email, "password": QA_PASSWORD}).status_code == 401)
        recovery_code = changed["recovery_codes"][0]
        recovered = session(second, good(second, "POST", "/auth-api/recover", {"email": invited_email, "recovery_code": recovery_code, "new_password": QA_PASSWORD}))
        check("recovery_revokes_old_sessions", member.get("/api/me").status_code == 401)
        check("recovery_single_use", anonymous.post("/auth-api/recover", json={"email": invited_email, "recovery_code": recovery_code, "new_password": QA_PASSWORD}).status_code == 401)
        check("recovery_regenerates_codes", len(recovered["recovery_codes"]) == 10)
        good(admin, "PATCH", "/auth-api/users/" + accepted["user"]["id"], {"permissions": {"knowledge": permissions["knowledge"]}})
        check("permission_change_revokes_sessions", second.get("/api/me").status_code == 401)
        session(second, good(second, "POST", "/auth-api/login", {"email": invited_email, "password": QA_PASSWORD}))
        check("removed_product_permission_denied", second.get("/api/me").status_code == 403)
        good(admin, "PATCH", "/auth-api/users/" + accepted["user"]["id"], {"active": False})
        check("disabled_account_revokes_sessions", second.get("/knowledge-api/me").status_code == 401)
        check("disabled_account_cannot_login", anonymous.post("/auth-api/login", json={"email": invited_email, "password": QA_PASSWORD}).status_code == 401)
        check("logout_requires_csrf", admin.post("/auth-api/logout", json={}, headers={"X-CSRF-Token": "wrong"}).status_code == 403)
        if args.containers:
            container_names = ["ordivant-auth-qa-" + product + "-api-1" for product in ["identity", "work", "knowledge", "code"]]
            for name in container_names:
                inspection = subprocess.run(["docker", "inspect", "--format", "{{json .Config.Labels}}", name], capture_output=True, text=True, check=True, timeout=15)
                check("owned_container_" + name, json.loads(inspection.stdout).get("com.docker.compose.project") == "ordivant-auth-qa")
            subprocess.run(["docker", "restart", "-t", "3", *container_names], check=True, capture_output=True, timeout=90)

            def ready():
                deadline = time.monotonic() + 45
                while time.monotonic() < deadline:
                    try:
                        if admin.get("/auth-api/status").status_code == 200 and all(admin.get(prefix + "/health").status_code == 200 for prefix in prefixes.values()):
                            return
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.25)
                raise AssertionError("QA services did not recover")

            ready()
            check("identity_session_survives_restart", good(admin, "GET", "/auth-api/me").json()["user"]["id"] == initial["user"]["id"])
            for product, prefix in prefixes.items():
                check(product + "_cookie_survives_restart", admin.get(prefix + "/me").status_code == 200)
            bootstrap = subprocess.run(["docker", "exec", "ordivant-auth-qa-work-api-1", "python", "-c", "from pathlib import Path; print(Path('/data/bootstrap.json').read_text())"], capture_output=True, text=True, check=True, timeout=15)
            agent_token = json.loads(bootstrap.stdout)["manager_token"]
            try:
                subprocess.run(["docker", "stop", "-t", "3", container_names[0]], capture_output=True, check=True, timeout=30)
                check("identity_outage_fails_closed", admin.get("/api/me").status_code == 503)
                check("agent_bearer_independent_of_identity_outage", anonymous.get("/api/projects", headers={"Authorization": "Bearer " + agent_token}).status_code == 200)
            finally:
                subprocess.run(["docker", "start", container_names[0]], capture_output=True, check=True, timeout=30)
                ready()
            check("identity_recovers_same_session", admin.get("/api/me").status_code == 200)
        old_cookie = dict(admin.cookies)
        good(admin, "POST", "/auth-api/logout", {})
        check("logout_clears_cookie", not dict(admin.cookies))
        old = httpx.Client(base_url=base, headers=headers, cookies=old_cookie, timeout=20, trust_env=False)
        check("logout_revokes_cookie_on_server", old.get("/api/me").status_code == 401)
        throttle_status = [anonymous.post("/auth-api/login", json={"email": f"unknown-{run}@example.com", "password": QA_PASSWORD}).status_code for _ in range(6)]
        check("login_throttles_failures", throttle_status[-1] == 429)
        # Leave only the synthetic browser fixture account enabled in this isolated QA instance.
        report = {"status": "passed", "mode": good(anonymous, "GET", "/api/health").json()["mode"], "base_url": base, "checks": checks, "resource_ids": {key: value["id"] for key, value in resources.items()}}
        path = report_dir / "report.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"AUTH_ACCEPTANCE_PASSED {len(checks)} checks; {path}")
        return 0
    except Exception as error:
        (report_dir / "report.json").write_text(json.dumps({"status": "failed", "checks": checks, "error": str(error)}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"AUTH_ACCEPTANCE_FAILED {error}")
        return 1
    finally:
        admin.close()
        anonymous.close()


if __name__ == "__main__":
    raise SystemExit(main())

"""Inspect and restart only the owned, synthetic ordivant-sso-qa environment."""
from __future__ import annotations

import json
import re
import subprocess
import time

import httpx

from auth_acceptance import QA_EMAIL, QA_PASSWORD
from sso_acceptance import APP_ORIGIN, KEYCLOAK_ORIGIN, Acceptance
from sso_fixture import FIXTURE_ADMIN_CLIENT_SECRET, OIDC_CLIENT_SECRET, SAML_FIXTURE_ADMIN_CLIENT_SECRET


PROJECT = "ordivant-sso-qa"
IDENTITY = PROJECT + "-identity-api-1"
BROKER = PROJECT + "-identity-broker-1"
WEB = PROJECT + "-web-1"

INSPECT_STORAGE = r'''
import json, re, sys
from sqlalchemy import select
from sqlalchemy.orm import Session
from ordivant_identity.config import get_settings
from ordivant_identity.db import make_engine
from ordivant_identity.models import AuthSession, OIDCFlow, SSOConfiguration
from ordivant_identity.sso import _decrypt

expected = json.load(sys.stdin)["expected_secret"]
settings = get_settings()
with Session(make_engine(settings.database_url)) as db:
    config = db.scalar(select(SSOConfiguration))
    flows = list(db.scalars(select(OIDCFlow)))
    key = settings.data_dir / "sso.key"
    secret = config.client_secret_ciphertext if config else ""
    columns = {column.name for table in (SSOConfiguration, OIDCFlow, AuthSession) for column in table.__table__.columns}
    checks = {
        "postgresql_storage": settings.database_url.startswith("postgresql+psycopg://"),
        "secret_is_ciphertext": bool(secret and secret.startswith("v1.") and expected not in secret),
        "encrypted_secret_decrypts": bool(secret and _decrypt(settings, secret, b"ordivant-sso-client-secret-v1") == expected),
        "key_size_and_private_permissions": key.stat().st_size == 32 and key.stat().st_mode & 0o077 == 0,
        "real_authorization_flows_recorded": bool(flows),
        "state_binding_and_nonce_are_hashes": bool(flows) and all(all(re.fullmatch(r"[0-9a-f]{64}", value) for value in (flow.state_hash, flow.browser_binding_hash, flow.nonce_hash)) for flow in flows),
        "pkce_verifier_encrypted": bool(flows) and all(flow.pkce_verifier_ciphertext.startswith("v1.") for flow in flows),
        "no_provider_token_or_authorization_code_columns": not {"access_token", "refresh_token", "id_token", "authorization_code", "code", "client_secret", "pkce_verifier", "state", "nonce"}.intersection(columns),
    }
print(json.dumps(checks))
'''


def docker(*args: str, input_text: str | None = None) -> str:
    result = subprocess.run(["docker", *args], input=input_text, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError("qa_docker_operation_failed")
    return result.stdout + result.stderr if args and args[0] == "logs" else result.stdout


def wait_ready() -> None:
    deadline = time.monotonic() + 150
    with httpx.Client(timeout=3, trust_env=False) as client:
        while time.monotonic() < deadline:
            try:
                app = client.get(APP_ORIGIN + "/auth-api/status")
                provider = client.get(KEYCLOAK_ORIGIN + "/realms/ordivant-qa/.well-known/openid-configuration")
                if app.status_code == provider.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
    raise RuntimeError("qa_restart_readiness_timeout")


def main() -> int:
    suite = Acceptance(APP_ORIGIN, KEYCLOAK_ORIGIN)
    report: dict = {"status": "failed", "target": PROJECT, "checks": suite.checks, "diagnostics": suite.diagnostics}
    session = None
    try:
        for container in (IDENTITY, BROKER, WEB):
            label = docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container).strip()
            suite.check("owned_qa_" + container.removeprefix(PROJECT + "-"), label == PROJECT)
        login = suite.browser_login(QA_EMAIL)
        session = login["browser"]
        suite.check("real_oidc_session_before_restart", login["success"])
        me = session.get(APP_ORIGIN + "/auth-api/me")
        suite.check("oidc_admin_before_restart", me.status_code == 200 and me.json().get("authentication", {}).get("method") == "oidc" and me.json().get("user", {}).get("role") == "admin")
        csrf = me.json()["csrf_token"]
        before = session.get(APP_ORIGIN + "/auth-api/sso/settings")
        suite.check("settings_read_before_restart", before.status_code == 200)
        storage = json.loads(docker("exec", "-i", IDENTITY, "python", "-c", INSPECT_STORAGE, input_text=json.dumps({"expected_secret": OIDC_CLIENT_SECRET})))
        for name, passed in storage.items():
            suite.check(name, passed)

        docker("restart", "--time", "10", IDENTITY, BROKER)
        wait_ready()
        after_me = session.get(APP_ORIGIN + "/auth-api/me")
        suite.check("oidc_session_survives_identity_and_broker_restart", after_me.status_code == 200 and after_me.json().get("authentication", {}).get("method") == "oidc" and after_me.json().get("user", {}).get("id") == me.json()["user"]["id"])
        after = session.get(APP_ORIGIN + "/auth-api/sso/settings")
        suite.check("encrypted_configuration_survives_restart", after.status_code == 200 and after.json() == before.json())
        connection = session.post(APP_ORIGIN + "/auth-api/sso/test", headers={"Origin": APP_ORIGIN, "X-CSRF-Token": csrf})
        suite.check("broker_connection_after_restart", connection.status_code == 200 and connection.json().get("status") == "ok")

        sensitive = (OIDC_CLIENT_SECRET, FIXTURE_ADMIN_CLIENT_SECRET, SAML_FIXTURE_ADMIN_CLIENT_SECRET, QA_PASSWORD)
        for container in (IDENTITY, BROKER, WEB):
            logs = docker("logs", container).casefold()
            suite.check("no_sensitive_log_material_" + container.removeprefix(PROJECT + "-"), not any(value.casefold() in logs for value in sensitive) and not re.search(r"(?:id_token|access_token|logout_token|client_secret|code)=", logs))
        logout = session.post(APP_ORIGIN + "/auth-api/logout", headers={"Origin": APP_ORIGIN, "X-CSRF-Token": csrf})
        suite.check("oidc_logout_after_restart", logout.status_code in {200, 204} and session.get(APP_ORIGIN + "/auth-api/me").status_code == 401)
        report["status"] = "passed"
    except Exception as error:
        report.update(failed_check=suite.current_check, error_type=type(error).__name__)
    finally:
        if session:
            session.close()
        suite.close()
        path = suite.directory / "storage-report.json"
        path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f'SSO_STORAGE_{report["status"].upper()} {len(suite.checks)} checks; {path}')
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

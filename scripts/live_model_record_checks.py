"""Inspect live-model records and logs without displaying credentials or raw state."""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from configure_test_model import ConfigurationError, load_test_provider_config

_CHECK = """
import json, sys
from pathlib import Path
from sqlalchemy import select
from ordivant.db import SessionLocal
from ordivant.models import Agent, AuthToken, IdempotencyRecord, ModelProviderSetting, OutboxEvent
from ordivant.model_settings import _delivery_token
from ordivant.security import hash_secret
supplied=json.load(sys.stdin)
with SessionLocal() as session:
    event=session.get(OutboxEvent,supplied['request_id'])
    agent=session.get(Agent,event.agent_id)
    derived=_delivery_token(event.id,agent.principal_id)
    token=session.scalar(select(AuthToken).where(AuthToken.token_hash==hash_secret(derived)))
    provider=session.scalar(select(ModelProviderSetting).where(ModelProviderSetting.provider_id==supplied['provider_id']))
    files=list(Path('/data/runtime').rglob('*'))
    runtime_files=[file for file in files if file.is_file()]
    secrets=[supplied['key'].encode(),derived.encode()]
    clean=all(all(secret not in file.read_bytes() for secret in secrets) for file in runtime_files)
    cached=session.scalars(select(IdempotencyRecord)).all()
    print(json.dumps({
        'delivery_acknowledged':event.status=='delivered',
        'delivery_agent_token_revoked':token is not None and token.revoked_at is not None,
        'provider_key_encrypted_at_rest':provider is not None and supplied['key'] not in provider.api_key_ciphertext,
        'no_secret_in_pi_sqlite_or_request_files':clean,
        'runtime_files_checked':len(runtime_files),
        'no_secret_in_idempotency_responses':all(all(secret.decode() not in row.response_json for secret in secrets) for row in cached)
    }))
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="Completed live-model acceptance JSON")
    parser.add_argument("--key-file", type=Path, help="Explicit credential file override; otherwise use ORDIVANT_TEST_PROVIDER_KEY_FILE")
    args = parser.parse_args()
    try:
        config = load_test_provider_config(args.key_file)
    except ConfigurationError as exc:
        print(str(exc))
        return 2
    report = json.loads(args.report.read_text(encoding="utf-8"))
    if report.get("compose_project") != config.project or report.get("status") != "passed":
        raise SystemExit("Only the owned successful live acceptance report can be inspected")
    project = config.project
    for service in ("work-api", "runtime"):
        ownership = subprocess.run(
            ["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', project + "-" + service + "-1"],
            capture_output=True, text=True, encoding="utf-8", timeout=15,
        )
        if ownership.returncode or ownership.stdout.strip() != project:
            raise SystemExit("The configured isolated acceptance containers are unavailable")
    try:
        key = config.key_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise SystemExit("Provider credential file could not be read") from exc
    if not key:
        raise SystemExit("Provider credential is unavailable")
    process = subprocess.run(["docker", "exec", "-i", project + "-work-api-1", "python", "-c", _CHECK],
        input=json.dumps({"key": key, "request_id": report["request_id"], "provider_id": config.provider_id}),
        capture_output=True, text=True, encoding="utf-8", timeout=45)
    if process.returncode or key in process.stdout or key in process.stderr:
        raise SystemExit("Record inspection failed; credential-bearing details suppressed")
    checks = json.loads(process.stdout)
    logs_clean = True
    for service in ["work-api", "runtime"]:
        logs = subprocess.run(["docker", "logs", "--tail", "300", project + "-" + service + "-1"],
            capture_output=True, timeout=15)
        if logs.returncode:
            raise SystemExit("Owned service log inspection failed; output suppressed")
        logs_clean = logs_clean and key.encode() not in logs.stdout + logs.stderr
    checks["provider_key_absent_from_recent_api_runtime_logs"] = logs_clean
    status = all(value for name, value in checks.items() if name != "runtime_files_checked")
    result = {"status": "passed" if status else "failed", "request_id": report["request_id"], "checks": checks}
    destination = args.report.parent / "record-checks.json"
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"LIVE_MODEL_RECORD_CHECKS_{result['status'].upper()}: {destination}")
    return 0 if status else 1


if __name__ == "__main__":
    raise SystemExit(main())

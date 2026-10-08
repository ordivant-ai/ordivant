"""Inspect the owned live QA storage and logs; output only ids and booleans."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

from configure_test_model import ConfigurationError, load_test_provider_config
from execution_acceptance import OWNER, ROOT, docker
from execution_mcp_fixture import FIXTURE_TOKEN
from execution_test_credential import read_authorized_test_key


CHECK = """
import hashlib,json,sqlite3,sys
from pathlib import Path
from sqlalchemy import select
from ordivant.db import SessionLocal
from ordivant.models import Agent,AuthToken,IdempotencyRecord,ModelProviderSetting,OutboxEvent,ToolConnection
from ordivant.model_settings import _delivery_token
from ordivant.security import hash_secret
supplied=json.load(sys.stdin)
with SessionLocal() as session:
    event=session.get(OutboxEvent,supplied['run_id'])
    agent=session.get(Agent,event.agent_id)
    derived=_delivery_token(event.id,agent.principal_id)
    credential=session.scalar(select(AuthToken).where(AuthToken.token_hash==hash_secret(derived)))
    provider=session.scalar(select(ModelProviderSetting).where(ModelProviderSetting.provider_id==supplied['provider_id']))
    connections=session.scalars(select(ToolConnection).where(ToolConnection.project_id==event.project_id)).all()
    runtime_files=[f for f in Path('/data/runtime').rglob('*') if f.is_file()]
    secrets=[supplied['key'],supplied['mcp_token'],derived]
    bootstrap=json.loads(Path('/data/bootstrap.json').read_text())
    secrets += [bootstrap['runtime_token']]
    byte_secrets=[s.encode() for s in secrets]
    cached=session.scalars(select(IdempotencyRecord)).all()
    result={
        'terminal_delivery_finalized':event.status=='delivered',
        'scoped_agent_credential_revoked':credential is not None and credential.revoked_at is not None,
        'provider_key_encrypted':provider is not None and bool(provider.api_key_ciphertext) and supplied['key'] not in provider.api_key_ciphertext,
        'tool_keys_encrypted':bool(connections) and all(bool(c.auth_token_ciphertext) and supplied['mcp_token'] not in c.auth_token_ciphertext for c in connections),
        'runtime_storage_present':bool(runtime_files),
        'no_credentials_in_runtime_storage':all(all(secret not in f.read_bytes() for secret in byte_secrets) for f in runtime_files),
        'no_credentials_in_idempotency_responses':all(all(secret not in row.response_json for secret in secrets) for row in cached),
    }
    run_db=sqlite3.connect('file:/data/runtime/runs.sqlite?mode=ro',uri=True)
    run_db.row_factory=sqlite3.Row
    stored=run_db.execute('SELECT agent_id,conversation_id,submission_id FROM runs WHERE request_id=?',(event.id,)).fetchone()
    run_db.close()
    pi_name='agent-'+hashlib.sha256(stored['agent_id'].encode()).hexdigest()[:24]+'.sqlite'
    pi=sqlite3.connect('file:/data/runtime/'+pi_name+'?mode=ro',uri=True)
    submission=json.loads(pi.execute('SELECT record FROM submissions WHERE id=? AND conversation_id=?',(stored['submission_id'],stored['conversation_id'])).fetchone()[0])
    models=[m for row in pi.execute('SELECT record FROM entries WHERE conversation_id=? AND id BETWEEN ? AND ? ORDER BY id',(stored['conversation_id'],submission['entry'],submission['answer'])) for m in json.loads(row[0]).get('model',[])]
    calls={block['id'] for m in models if m.get('role')=='assistant' for block in m.get('content',[]) if block.get('type')=='toolCall' and block.get('name','').startswith('mcp_') and block.get('arguments',{}).get('a')==19 and block.get('arguments',{}).get('b')==23}
    verified=False
    for m in models:
        if m.get('role')!='toolResult' or m.get('toolCallId') not in calls or m.get('isError'):
            continue
        for block in m.get('content',[]):
            try:
                envelope=json.loads(block.get('text',''))
                if envelope.get('isError'): continue
                for item in envelope.get('content',[]):
                    value=json.loads(item.get('text',''))
                    verified=verified or value.get('sum')==42 and value.get('source')=='synthetic_local_mcp_fixture'
            except (ValueError,TypeError,AttributeError):
                pass
    pi.close()
    result['actual_pi_mcp_result_is_42']=verified
    print(json.dumps(result))
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        config = load_test_provider_config()
    except ConfigurationError as error:
        print(str(error))
        return 2
    if config.project != OWNER:
        raise SystemExit("ORDIVANT_TEST_PROVIDER_PROJECT must match this isolated execution acceptance fixture")
    report = json.loads(args.report.read_text(encoding="utf-8"))
    if (report.get("target") != OWNER or report.get("compose_project") != config.project
            or report.get("status") != "passed"):
        raise SystemExit("Only a successful owned execution live report may be inspected")
    checks: dict[str, bool] = {}
    key = ""
    runtime_was_running = False
    try:
        for service in ("work-api", "runtime", "sandbox-api"):
            checks["owned_" + service] = docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-" + service + "-1").strip() == OWNER
        if not all(checks.values()):
            raise RuntimeError("owned_target_or_credential_unavailable")
        key = read_authorized_test_key(config.key_file)
        runtime_was_running = docker("inspect", "--format", "{{.State.Running}}", OWNER + "-runtime-1").strip() == "true"
        if runtime_was_running:
            docker("stop", "--time", "3", OWNER + "-runtime-1")
        supplied = {"key": key, "mcp_token": FIXTURE_TOKEN, "run_id": report["run_id"], "provider_id": config.provider_id}
        process = subprocess.run(["docker", "exec", "-i", OWNER + "-work-api-1", "python", "-c", CHECK], input=json.dumps(supplied), capture_output=True, text=True, encoding="utf-8", timeout=45)
        if process.returncode or key in process.stdout or FIXTURE_TOKEN in process.stdout:
            raise RuntimeError("private_record_inspection_failed")
        checks.update(json.loads(process.stdout))
        for service in ("work-api", "runtime", "sandbox-api", "mcp-fixture"):
            logs = subprocess.run(["docker", "logs", "--tail", "1000", OWNER + "-" + service + "-1"], capture_output=True, timeout=15)
            checks["credentials_absent_from_" + service + "_logs"] = logs.returncode == 0 and all(secret.encode() not in logs.stdout + logs.stderr for secret in (key, FIXTURE_TOKEN))
        jobs = docker("ps", "-aq", "--filter", "label=ordivant.sandbox.owner=" + OWNER).strip()
        checks["no_owned_job_containers_remaining"] = not jobs
        result = {"status": "passed" if all(checks.values()) else "failed", "target": OWNER, "run_id": report["run_id"], "checks": checks}
    except Exception as error:
        result = {"status": "failed", "target": OWNER, "checks": checks, "error_type": type(error).__name__}
    finally:
        if runtime_was_running:
            docker("start", OWNER + "-runtime-1")
    key = ""
    destination = args.report.parent / "record-checks.json"
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"EXECUTION_RECORDS_{result['status'].upper()} {len(checks)} checks; {destination}")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

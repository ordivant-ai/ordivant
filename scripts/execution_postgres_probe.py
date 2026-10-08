"""Concurrent version/start/tick acceptance against owned PostgreSQL QA only."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import uuid

import httpx

from execution_acceptance import Acceptance, BASE, OWNER, ROOT, docker


def main():
    suite = Acceptance()
    report = {"status": "failed", "target": OWNER, "database": "postgresql", "checks": suite.checks}
    try:
        suite.check("owned_work_api", docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-work-api-1").strip() == OWNER)
        suite.login()
        resources = json.loads((ROOT / ".data/validation/execution-qa-resources.json").read_text(encoding="utf-8"))
        pid = resources["project"]["id"]
        step = {"key": "wait", "title": "Concurrent QA", "goal": "Wait for an intentionally unavailable capability", "capabilities": ["pg-concurrency-only-unavailable"], "dependency_keys": [], "acceptance_criteria": ["Synthetic only"], "priority": "medium"}
        flow = suite.good(suite.admin, "POST", "/api/workflows", {"project_id": pid, "key": "pg-" + suite.run, "name": "Concurrent QA " + suite.run, "steps": [step]})
        cookie_jar = httpx.Cookies(suite.admin.cookies)
        headers = {"Origin": BASE, "X-CSRF-Token": suite.admin.headers["X-CSRF-Token"]}

        def request(path: str, body: dict):
            with httpx.Client(base_url=BASE, headers=headers, cookies=cookie_jar, trust_env=False, timeout=25) as client:
                response = client.post(path, json=body, headers={"Idempotency-Key": str(uuid.uuid4())})
                return response.status_code, response.json() if response.headers.get("content-type", "").startswith("application/json") else {}

        with ThreadPoolExecutor(max_workers=6) as pool:
            versions = list(pool.map(lambda i: request(f"/api/workflows/{flow['id']}/versions", {"name": f"Concurrent QA v{i}", "steps": [step]}), range(6)))
        suite.check("concurrent_version_publication_succeeds", all(code == 201 for code, _ in versions))
        suite.check("concurrent_versions_are_unique_contiguous", sorted(value["version"] for _, value in versions) == list(range(2, 8)))
        with ThreadPoolExecutor(max_workers=6) as pool:
            starts = list(pool.map(lambda _: request(f"/api/workflows/{flow['id']}/start", {}), range(6)))
        suite.check("concurrent_manual_start_one_winner", sum(code == 201 for code, _ in starts) == 1 and all(code in {201, 409} for code, _ in starts))
        instance = next(value for code, value in starts if code == 201)
        suite.good(suite.admin, "POST", f"/api/workflow-runs/{instance['id']}/cancel", {})
        suite.good(suite.admin, "PATCH", f"/api/workflows/{flow['id']}/schedule", {"enabled": True, "interval_minutes": 1, "max_runs": 1})
        # Only this synthetic schedule is moved due; the actual tick uses the HTTP API.
        probe = r'''
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import httpx
from ordivant.config import data_dir
from ordivant.db import SessionLocal, engine
from ordivant.models import WorkflowSchedule
from ordivant.security import now_utc
assert engine.dialect.name == "postgresql"
workflow_id = __WORKFLOW_ID__
with SessionLocal() as session:
    schedule = session.get(WorkflowSchedule, workflow_id)
    assert schedule and schedule.enabled
    schedule.next_run_at = now_utc() - timedelta(seconds=1)
    session.commit()
token = json.loads((data_dir()/"bootstrap.json").read_text())["runtime_token"]
def tick(_):
    with httpx.Client(base_url="http://127.0.0.1:8000", headers={"Authorization":"Bearer "+token}, trust_env=False, timeout=25) as client:
        r=client.post("/api/runtime/workflows/tick",json={})
        return {"code":r.status_code,"admitted":r.json().get("admitted_schedules") if r.is_success else None}
with ThreadPoolExecutor(max_workers=8) as pool:
    results=list(pool.map(tick,range(8)))
print(json.dumps({"database":"postgresql","results":results}))
'''.replace("__WORKFLOW_ID__", repr(flow["id"]))
        ticks = json.loads(docker("exec", "-i", OWNER + "-work-api-1", "python", "-", input_text=probe))
        suite.check("eight_concurrent_runtime_ticks_succeed", all(row["code"] == 200 for row in ticks["results"]))
        suite.check("concurrent_interval_tick_admits_once", sum(row["admitted"] for row in ticks["results"]) == 1)
        instances = [item for item in suite.good(suite.admin, "GET", "/api/workflow-runs?project_id=" + pid) if item["workflow_id"] == flow["id"] and item["trigger"] == "schedule"]
        suite.check("postgres_exactly_one_scheduled_instance_and_task", len(instances) == 1 and len(instances[0]["steps"]) == 1)
        suite.good(suite.admin, "POST", f"/api/workflow-runs/{instances[0]['id']}/cancel", {})
        report["results"] = {"version_statuses": [code for code, _ in versions], "start_statuses": [code for code, _ in starts], "tick_results": ticks["results"]}
        report["status"] = "passed"
    except Exception as error:
        report.update(error_type=type(error).__name__, failed_check=suite.current_check)
    finally:
        suite.close()
        path = ROOT / ".data/validation/execution-postgres.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f'EXECUTION_POSTGRES_{report["status"].upper()} {len(suite.checks)} checks; {report.get("failed_check", "concurrent versions/start/ticks")}')
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

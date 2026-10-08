"""Final non-paid real executor cleanup regression on the owned QA only."""
from __future__ import annotations

import json

from execution_acceptance import Acceptance, OWNER, ROOT, docker


def main() -> int:
    suite = Acceptance()
    report = {"status": "failed", "target": OWNER, "checks": suite.checks}
    try:
        suite.check("owned_qa_runtime", docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-runtime-1").strip() == OWNER)
        suite.login()
        suite.check("no_paid_default_selection", suite.good(suite.admin, "GET", "/api/model-settings")["default"] is None)
        resources = json.loads((ROOT / ".data/validation/execution-qa-resources.json").read_text(encoding="utf-8"))
        project_id = resources["project"]["id"]
        agent = suite.good(suite.admin, "POST", "/api/agents", {
            "name": "DEMO sandbox cleanup QA " + suite.run, "role": "worker", "capabilities": [],
            "project_ids": [project_id], "runtime": "pi", "model_config": None,
            "execution_config": {"instructions": "Clearly label the deterministic DEMO receipt.", "tool_connection_ids": [], "sandbox_profile_id": resources["profile"]["id"], "limits": {"max_turns": 10, "timeout_seconds": 60}},
        })
        agent.pop("token", None)
        task = suite.good(suite.admin, "POST", "/api/tasks", {"project_id": project_id, "assignee_id": agent["id"], "title": "DEMO 清理驗收", "goal": "Use get_task_context to read the real task and return a labeled DEMO receipt.", "acceptance_criteria": ["DEMO 摘要與真正的隔離 workspace 清理"]})
        dispatch = suite.good(suite.admin, "POST", f"/api/tasks/{task['id']}/dispatch", {"agent_id": agent["id"]})
        report.update(run_id=dispatch["id"], task_id=task["id"])
        run = suite.wait("demo_run_really_completed", lambda: (r if (r := suite.good(suite.admin, "GET", f"/api/runs/{dispatch['id']}"))["status"] == "done" else None))
        suite.check("no_paid_model_called", run["mode"] == "demo" and run["receipt"]["mode"] == "demo")
        events = suite.good(suite.admin, "GET", f"/api/runs/{dispatch['id']}/events")
        suite.check("actual_job_created_and_cleaned", any(e["kind"] == "sandbox" and e["data"].get("status") == "ready" for e in events) and run["sandbox"]["status"] == "stopped" and not run["sandbox"]["workspace_available"])
        suite.check("no_cleanup_error_reported", not any(e["data"].get("kind") == "sandbox_cleanup_unconfirmed" for e in events))
        suite.good(suite.admin, "POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "PM 確認這是 DEMO 且真實 sandbox workspace 已完成清理。"})
        suite.check("independent_review_required_and_accepted", suite.good(suite.admin, "GET", f"/api/tasks/{task['id']}")["status"] == "done")
        suite.check("no_owned_jobs_remain", not docker("ps", "-aq", "--filter", "label=ordivant.sandbox.owner=" + OWNER).strip())
        report["status"] = "passed"
    except Exception as error:
        report.update(error_type=type(error).__name__, failed_check=suite.current_check)
    finally:
        suite.close()
    destination = ROOT / ".data/validation/execution-cleanup.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"EXECUTION_CLEANUP_{report['status'].upper()} {len(suite.checks)} checks")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

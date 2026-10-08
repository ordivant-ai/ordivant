"""Prepare owned queued Runs for actual browser stop/retry acceptance."""
from __future__ import annotations

import json
import subprocess
import sys

from execution_acceptance import Acceptance, OWNER, ROOT, docker


def main():
    suite = Acceptance()
    runtime_name = OWNER + "-runtime-1"
    restore_runtime = False
    try:
        containers = docker("ps", "-a", "--format", "{{.Names}}").splitlines()
        if runtime_name in containers:
            suite.check("owned_runtime", docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', runtime_name).strip() == OWNER)
            restore_runtime = docker("inspect", "--format", "{{.State.Running}}", runtime_name).strip() == "true"
            if restore_runtime:
                docker("stop", "--time", "3", runtime_name)
        suite.login()
        project = suite.good(suite.admin, "POST", "/api/projects", {"key": "run-ui-" + suite.run, "name": "Run control QA " + suite.run})
        agent = suite.good(suite.admin, "POST", "/api/agents", {"name": "UI Run QA " + suite.run, "role": "worker", "capabilities": ["ui-run-qa"], "project_ids": [project["id"]], "runtime": "pi"})
        agent.pop("token", None)
        task = suite.good(suite.admin, "POST", "/api/tasks", {"project_id": project["id"], "title": "瀏覽器停止／重跑 QA", "goal": "Only synthetic UI verification", "acceptance_criteria": ["保留停止及重跑歷史"], "assignee_id": agent["id"]})
        run = suite.good(suite.admin, "POST", f"/api/tasks/{task['id']}/dispatch", {"agent_id": agent["id"]})
        resources = {"project": project, "task_id": task["id"], "run_id": run["id"]}
        (ROOT / ".data/validation/execution-run-browser-resources.json").write_text(json.dumps(resources), encoding="utf-8")
        result = subprocess.run([sys.executable, str(ROOT / "scripts/execution_browser.py"), "scripts/execution_run_ui.cjs"], cwd=ROOT, timeout=120)
        return result.returncode
    finally:
        suite.close()
        if restore_runtime:
            docker("start", runtime_name)


if __name__ == "__main__":
    raise SystemExit(main())

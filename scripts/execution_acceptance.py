"""End-to-end Run, automation, tools and sandbox acceptance on owned QA only.

Synthetic login on 8092; no user account, paid model or main environment mutation.
Reports contain resource ids and checks, never credentials or authentication bodies.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import subprocess
import time
import uuid

import httpx

from auth_acceptance import QA_EMAIL, QA_PASSWORD
from execution_mcp_fixture import FIXTURE_TOKEN

logging.getLogger("httpx").setLevel(logging.WARNING)

ROOT = Path(__file__).resolve().parents[1]
OWNER = "ordivant-execution-qa"
BASE = "http://127.0.0.1:8092"


def docker(*args: str, input_text: str | None = None):
    result = subprocess.run(["docker", *args], input=input_text, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    if result.returncode:
        raise RuntimeError("owned_qa_docker_operation_failed")
    return result.stdout


class Acceptance:
    def __init__(self):
        self.run = uuid.uuid4().hex[:8]
        self.directory = ROOT / ".data/validation" / ("execution-" + self.run)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.checks: dict[str, bool] = {}
        self.resources: dict = {}
        self.current_check = "initialization"
        self.admin = httpx.Client(base_url=BASE, headers={"Origin": BASE}, timeout=25, trust_env=False)
        self.clients = [self.admin]

    def check(self, name: str, value: bool):
        self.current_check = name
        self.checks[name] = bool(value)
        if not value:
            raise AssertionError(name)

    def good(self, client: httpx.Client, method: str, path: str, body=None, key: str | None = None):
        self.current_check = f"{method} {path}"
        headers = {"Idempotency-Key": key or str(uuid.uuid4())} if method not in {"GET", "HEAD"} else None
        result = client.request(method, path, json=body, headers=headers)
        if result.status_code not in {200, 201, 204}:
            raise AssertionError(f"HTTP_{result.status_code}")
        return result.json() if result.content else None

    def bearer(self, token: str):
        client = httpx.Client(base_url=BASE, headers={"Authorization": "Bearer " + token}, timeout=25, trust_env=False)
        self.clients.append(client)
        return client

    def wait(self, name: str, callback, timeout=45):
        self.current_check = name
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = callback()
            if value:
                self.check(name, True)
                return value
            time.sleep(0.4)
        self.check(name, False)

    def login(self):
        status = self.good(self.admin, "GET", "/auth-api/status")
        path = "/auth-api/setup" if status["setup_required"] else "/auth-api/login"
        body = {"email": QA_EMAIL, "password": QA_PASSWORD}
        if status["setup_required"]:
            body["name"] = "QA 管理員"
        result = self.good(self.admin, "POST", path, body)
        self.admin.headers["X-CSRF-Token"] = result["csrf_token"]
        self.check("synthetic_qa_admin_login", result["user"]["role"] == "admin")

    def scenario(self, container_checks: bool):
        a = self.admin
        self.login()
        project = self.good(a, "POST", "/api/projects", {"key": "run-qa-" + self.run, "name": "執行控制 QA " + self.run})
        other = self.good(a, "POST", "/api/projects", {"key": "run-other-" + self.run, "name": "隔離範圍 QA"})
        pid = project["id"]
        self.resources.update(project=project, other_project=other)
        profile = self.good(a, "POST", "/api/sandbox-profiles", {
            "project_id": pid, "name": "隔離測試環境", "enabled": True,
            "limits": {"timeout_seconds": 10, "memory_mb": 128, "cpu_count": 0.5, "pids_limit": 32, "output_bytes": 4096, "workspace_mb": 8},
        })
        self.check("profile_real_limits_persisted", self.good(a, "GET", "/api/sandbox-profiles?project_id=" + pid)[0]["limits"] == profile["limits"])
        bad_profile = a.post("/api/sandbox-profiles", json={"project_id": pid, "name": "invalid", "enabled": True, "limits": {**profile["limits"], "memory_mb": 999999}})
        self.check("profile_unbounded_memory_rejected", bad_profile.status_code == 422)
        connection = self.good(a, "POST", "/api/tool-connections", {
            "project_id": pid, "name": "Synthetic MCP", "endpoint": "http://mcp-fixture:8050/mcp", "enabled": True,
            "allowed_tools": ["synthetic_add", "synthetic_wait"], "auth_token": FIXTURE_TOKEN,
        })
        self.check("tool_secret_write_only", connection["key_configured"] and FIXTURE_TOKEN not in json.dumps(connection) and "auth_token" not in connection)
        listing = self.good(a, "GET", "/api/tool-connections?project_id=" + pid)
        self.check("tool_secret_not_in_listing", FIXTURE_TOKEN not in json.dumps(listing))
        probe = self.good(a, "POST", f"/api/tool-connections/{connection['id']}/test", {})
        self.check("actual_mcp_discovery", probe["ok"] and {"synthetic_add", "synthetic_wait", "forbidden_fixture_tool"}.issubset({tool["name"] for tool in probe["tools"]}))
        preserved = self.good(a, "PATCH", f"/api/tool-connections/{connection['id']}", {"name": "Synthetic MCP renamed", "auth_token": ""})
        self.check("blank_tool_key_preserves_connection", preserved["key_configured"] and self.good(a, "POST", f"/api/tool-connections/{connection['id']}/test", {})["ok"])
        invalid = a.post("/api/tool-connections", json={"project_id": pid, "name": "invalid", "endpoint": "http://untrusted.invalid/mcp", "enabled": True, "allowed_tools": [], "auth_token": FIXTURE_TOKEN})
        self.check("untrusted_tool_host_rejected", invalid.status_code in {400, 403, 422})
        invalid = a.post("/api/tool-connections", json={"project_id": pid, "name": "invalid", "endpoint": "not a URL", "auth_token": FIXTURE_TOKEN, "extra_secret": FIXTURE_TOKEN})
        self.check("tool_validation_does_not_echo_secret", invalid.status_code == 422 and FIXTURE_TOKEN not in invalid.text)

        definition = {"role": "worker", "capabilities": ["qa-build"], "instructions": "僅處理合成 QA 任務；提供具體證據。", "model_config": None,
                      "tool_connection_ids": [], "sandbox_profile_id": None, "limits": {"max_turns": 20, "timeout_seconds": 120}}
        template = self.good(a, "POST", "/api/agent-templates", {"key": "qa-builder-" + self.run, "name": "QA Builder", "description": "合成驗收範本", "definition": definition})
        published = self.good(a, "POST", f"/api/agent-templates/{template['id']}/versions", {"name": "QA Builder v2", "definition": {**definition, "instructions": "第二版合成指令"}})
        versions = self.good(a, "GET", "/api/agent-templates")
        self.check("immutable_template_versions", published["version"] == 2 and next(t for t in versions if t["id"] == template["id"])["definition"] == definition)
        agent = self.good(a, "POST", "/api/agents", {"name": "QA Builder " + self.run, "role": "worker", "capabilities": ["qa-build"], "project_ids": [pid], "runtime": "pi", "template_id": template["id"]})
        builder_client = self.bearer(agent.pop("token"))
        self.check("exact_template_applied", agent["template_id"] == template["id"] and agent["execution_config"]["instructions"] == definition["instructions"])
        updated = self.good(a, "PATCH", f"/api/agents/{agent['id']}", {"execution_config": {**agent["execution_config"], "limits": {"max_turns": 18, "timeout_seconds": 120}}})
        self.check("agent_edit_execution_settings", updated["execution_config"]["limits"]["max_turns"] == 18)
        reviewer = self.good(a, "POST", "/api/agents", {"name": "QA Reviewer " + self.run, "role": "reviewer", "capabilities": ["qa-review"], "project_ids": [pid], "runtime": "external"})
        reviewer_client = self.bearer(reviewer.pop("token"))
        other_agent = self.good(a, "POST", "/api/agents", {"name": "QA Other " + self.run, "role": "worker", "capabilities": [], "project_ids": [other["id"]], "runtime": "external"})
        other_client = self.bearer(other_agent.pop("token"))
        self.check("cross_project_tool_denied", other_client.get("/api/tool-connections?project_id=" + pid).status_code in {403, 404})
        self.check("agent_cannot_configure_tool_secrets", builder_client.patch(f"/api/tool-connections/{connection['id']}", json={"auth_token": "rejected"}).status_code == 403)
        self.check("agent_cannot_write_profiles", builder_client.patch(f"/api/sandbox-profiles/{profile['id']}", json={"name": "rejected"}).status_code == 403)

        if container_checks:
            runtime_name = OWNER + "-runtime-1"
            docker("stop", "--time", "3", runtime_name)
            try:
                task = self.good(a, "POST", "/api/tasks", {"project_id": pid, "title": "待派工停止／重跑 QA", "goal": "Use get_task_context to read the actual scoped task, then return a clearly labeled DEMO receipt.", "acceptance_criteria": ["實際查詢任務並回傳 DEMO 摘要"], "assignee_id": agent["id"], "reviewer_id": reviewer["id"]})
                dispatch = self.good(a, "POST", f"/api/tasks/{task['id']}/dispatch", {"agent_id": agent["id"]})
                stopped = self.good(a, "POST", f"/api/runs/{dispatch['id']}/control", {"action": "stop"}, key="stop-" + self.run)
                duplicate = self.good(a, "POST", f"/api/runs/{dispatch['id']}/control", {"action": "stop"}, key="stop-" + self.run)
                self.check("queued_stop_idempotent", stopped == duplicate and stopped["status"] == "aborted")
                retry = self.good(a, "POST", f"/api/runs/{dispatch['id']}/control", {"action": "retry"}, key="retry-" + self.run)
                duplicate = self.good(a, "POST", f"/api/runs/{dispatch['id']}/control", {"action": "retry"}, key="retry-" + self.run)
                self.check("retry_new_run_preserves_history", retry["id"] != stopped["id"] and retry["retry_of"] == stopped["id"] and duplicate["id"] == retry["id"])
            finally:
                docker("start", runtime_name)
            self.wait("retry_really_submitted", lambda: self.good(a, "GET", f"/api/tasks/{task['id']}")["status"] == "in_review")
            run = self.wait("runtime_receipt_synced", lambda: (value if (value := self.good(a, "GET", f"/api/runs/{retry['id']}"))["status"] == "done" and value["receipt"] else None))
            self.check("demo_receipt_honest", run["mode"] == "demo" and run["receipt"]["mode"] == "demo" and run["receipt"]["cost_usd"] is None)
            self.check("run_execution_link_real", bool(run["execution_id"]) and any(e["id"] == run["execution_id"] for e in self.good(a, "GET", f"/api/tasks/{task['id']}/executions")))
            events = self.good(a, "GET", f"/api/runs/{retry['id']}/events")
            self.check("durable_tool_events", any(event["kind"] == "tool_start" for event in events) and all(events[i]["sequence"] < events[i + 1]["sequence"] for i in range(len(events) - 1)))
            self.check("actual_demo_tool_receipt", any(tool["name"] == "get_task_context" and tool["calls"] == 1 for tool in run["receipt"]["tools"]))
            self.check("run_project_scope_denied", other_client.get(f"/api/runs/{retry['id']}").status_code in {403, 404})
            self.check("run_event_scope_denied", other_client.get(f"/api/runs/{retry['id']}/events").status_code in {403, 404})
            self.check("worker_cannot_control_run", builder_client.post(f"/api/runs/{retry['id']}/control", json={"action": "retry"}, headers={"Idempotency-Key": "forbidden-control-" + self.run}).status_code == 403)
            self.check("submitter_cannot_self_review", builder_client.post(f"/api/tasks/{task['id']}/review", json={"decision": "accept", "comment": "forbidden"}, headers={"Idempotency-Key": "forbidden-review-" + self.run}).status_code == 403)
            self.good(reviewer_client, "POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "獨立檢視實際 Pi 合成執行與證據"})
            self.check("reviewed_task_not_reopened_by_retry", a.post(f"/api/runs/{retry['id']}/control", json={"action": "retry"}, headers={"Idempotency-Key": "completed-retry-" + self.run}).status_code == 409)

        step1 = {"key": "spec", "title": "合成規格", "goal": "產生 QA 規格摘要", "description": "", "acceptance_criteria": ["回傳證據"], "dependency_keys": [], "agent_id": None, "capabilities": ["qa-build"], "reviewer_id": reviewer["id"], "priority": "medium"}
        step2 = {**step1, "key": "build", "title": "合成實作", "goal": "以前置驗收為條件回傳摘要", "dependency_keys": ["spec"]}
        flow = self.good(a, "POST", "/api/workflows", {"project_id": pid, "key": "qa-flow-" + self.run, "name": "規格 → 實作 QA", "steps": [step1, step2], "schedule": {"enabled": False, "interval_minutes": 1, "max_runs": 2}})
        cycle = a.post("/api/workflows", json={"project_id": pid, "key": "cycle-" + self.run, "name": "invalid cycle", "steps": [{**step1, "dependency_keys": ["build"]}, step2]})
        self.check("workflow_cycles_rejected", cycle.status_code in {409, 422})
        new_version = self.good(a, "POST", f"/api/workflows/{flow['id']}/versions", {"name": "規格 → 實作 QA v2", "description": "新版本", "steps": [step1, step2]})
        self.check("workflow_immutable_version", new_version["version"] == 2 and next(w for w in self.good(a, "GET", "/api/workflows?project_id=" + pid) if w["id"] == flow["id"])["name"] == flow["name"])
        instance = self.good(a, "POST", f"/api/workflows/{flow['id']}/start", {"inputs": "合成工作流程輸入"}, key="start-" + self.run)
        duplicate = self.good(a, "POST", f"/api/workflows/{flow['id']}/start", {"inputs": "合成工作流程輸入"}, key="start-" + self.run)
        self.check("workflow_start_exactly_once", duplicate["id"] == instance["id"] and len(instance["steps"]) == 2 and len({s["task_id"] for s in instance["steps"]}) == 2)
        first_task, second_task = [s["task_id"] for s in instance["steps"]]
        self.check("workflow_task_dependencies_real", self.good(a, "GET", f"/api/tasks/{second_task}")["dependency_ids"] == [first_task])
        self.check("cross_project_workflow_instance_denied", other_client.get(f"/api/workflow-runs/{instance['id']}").status_code in {403, 404})
        self.check("agent_cannot_bypass_runtime_scheduler", builder_client.post("/api/runtime/workflows/tick", json={}).status_code == 403)
        if container_checks:
            self.wait("workflow_automatically_dispatched_first", lambda: self.good(a, "GET", f"/api/tasks/{first_task}")["status"] == "in_review")
            self.check("unreviewed_dependency_does_not_dispatch_successor", not self.good(a, "GET", "/api/runs?task_id=" + second_task))
            self.good(reviewer_client, "POST", f"/api/tasks/{first_task}/review", {"decision": "accept", "comment": "第一步獨立驗收"})
            self.wait("accepted_dependency_automatically_advances", lambda: self.good(a, "GET", f"/api/tasks/{second_task}")["status"] == "in_review")
            self.good(reviewer_client, "POST", f"/api/tasks/{second_task}/review", {"decision": "accept", "comment": "第二步獨立驗收"})
            self.wait("workflow_completion_requires_all_reviews", lambda: self.good(a, "GET", f"/api/workflow-runs/{instance['id']}")["status"] == "completed")
        missing = self.good(a, "POST", "/api/workflows", {"project_id": pid, "key": "wait-" + self.run, "name": "等待能力 QA", "steps": [{**step1, "capabilities": ["unavailable-qa-capability"]}]})
        waiting = self.good(a, "POST", f"/api/workflows/{missing['id']}/start", {})
        if container_checks:
            self.wait("unavailable_capability_is_visible_wait", lambda: self.good(a, "GET", f"/api/workflow-runs/{waiting['id']}")["status"] == "waiting")
        self.good(a, "POST", f"/api/workflow-runs/{waiting['id']}/cancel", {})
        self.check("workflow_cancel_persisted", self.good(a, "GET", f"/api/workflow-runs/{waiting['id']}")["status"] == "cancelled")
        schedule = self.good(a, "PATCH", f"/api/workflows/{new_version['id']}/schedule", {"enabled": True, "interval_minutes": 1, "max_runs": 1})
        self.check("interval_schedule_real", schedule["schedule"]["enabled"] and bool(schedule["next_run_at"]))
        if container_checks:
            scheduled = self.wait("real_interval_trigger_admitted", lambda: next((i for i in self.good(a, "GET", "/api/workflow-runs?project_id=" + pid) if i["workflow_id"] == new_version["id"] and i["trigger"] == "schedule"), None), timeout=95)
            scheduled_instances = [i for i in self.good(a, "GET", "/api/workflow-runs?project_id=" + pid) if i["workflow_id"] == new_version["id"] and i["trigger"] == "schedule"]
            self.check("schedule_single_instance_at_interval", len(scheduled_instances) == 1)
            self.good(a, "POST", f"/api/workflow-runs/{scheduled['id']}/cancel", {})

            new_project = self.good(a, "POST", "/api/projects", {"key": "fresh-flow-" + self.run, "name": "直接流程建立 QA"})
            fresh_agent = self.good(a, "POST", "/api/agents", {"name": "Fresh flow QA " + self.run, "role": "worker", "capabilities": ["fresh-flow-qa"], "project_ids": [new_project["id"]], "runtime": "pi"})
            fresh_agent.pop("token", None)
            fresh_flow = self.good(a, "POST", "/api/workflows", {"project_id": new_project["id"], "key": "fresh-" + self.run, "name": "首次自動派工 QA", "steps": [{**step1, "agent_id": fresh_agent["id"], "capabilities": [], "reviewer_id": None}]})
            fresh_instance = self.good(a, "POST", f"/api/workflows/{fresh_flow['id']}/start", {})
            self.wait("fresh_project_workflow_admits_runtime_without_manual_dispatch", lambda: self.good(a, "GET", f"/api/tasks/{fresh_instance['steps'][0]['task_id']}")["status"] == "in_review")
            self.good(a, "POST", f"/api/workflow-runs/{fresh_instance['id']}/cancel", {})

        self.resources.update(profile=profile, connection=connection, template=template, template_v2=published, agent=agent, reviewer=reviewer, workflow=flow, workflow_v2=new_version, workflow_instance=instance)
        if container_checks:
            for name in ("work-api", "runtime", "sandbox-api"):
                self.check("owned_container_" + name, docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-" + name + "-1").strip() == OWNER)
            probe_report = json.loads(docker("exec", "-i", OWNER + "-sandbox-api-1", "python", "-", input_text=(ROOT / "scripts/sandbox_probe.py").read_text(encoding="utf-8")))
            (self.directory / "sandbox-report.json").write_text(json.dumps(probe_report, ensure_ascii=False, indent=2), encoding="utf-8")
            self.check("actual_sandbox_isolation_suite", probe_report["status"] == "passed")
            before = self.good(a, "GET", "/api/runs?project_id=" + pid)
            docker("restart", "--time", "3", OWNER + "-work-api-1", OWNER + "-runtime-1")
            self.wait("services_restart_ready", lambda: self.admin.get("/api/health").status_code == 200)
            after = self.good(a, "GET", "/api/runs?project_id=" + pid)
            self.check("runs_survive_actual_restart", all(any(r["id"] == old["id"] and r["receipt"] == old["receipt"] for r in after) for old in before if old["status"] in {"done", "aborted"}))
        self.good(a, "PATCH", f"/api/workflows/{new_version['id']}/schedule", {"enabled": False, "interval_minutes": 1, "max_runs": 1})

    def close(self):
        for client in self.clients:
            client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--containers", action="store_true")
    args = parser.parse_args()
    suite = Acceptance()
    report = {"status": "failed", "target": OWNER, "checks": suite.checks}
    try:
        for service in ("web", "identity-api", "work-api"):
            suite.check("owned_qa_" + service, docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-" + service + "-1").strip() == OWNER)
        suite.scenario(args.containers)
        report["status"] = "passed"
    except Exception as error:
        report.update(error_type=type(error).__name__, failed_check=suite.current_check)
    finally:
        suite.close()
        report["project_id"] = suite.resources.get("project", {}).get("id")
        path = suite.directory / "report.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        if report["status"] == "passed":
            (ROOT / ".data/validation/execution-qa-resources.json").write_text(json.dumps(suite.resources, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f'EXECUTION_{report["status"].upper()} {len(suite.checks)} checks; {path}')
        if report["status"] != "passed":
            print("Failed check: " + suite.current_check)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

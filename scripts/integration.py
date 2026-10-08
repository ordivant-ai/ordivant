"""Isolated black-box acceptance: REST collaboration, MCP, and the real Pi worker."""

from __future__ import annotations

import argparse
import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import uuid

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]


def unused_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def ready(url: str, process: subprocess.Popen, timeout: int = 30) -> dict:
    deadline = time.monotonic() + timeout
    with httpx.Client(timeout=2, trust_env=False) as client:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise AssertionError(f"Service exited with code {process.returncode}; inspect validation logs")
            try:
                response = client.get(url)
                if response.is_success:
                    return response.json()
            except httpx.HTTPError:
                pass
            time.sleep(0.2)
    raise AssertionError(f"Service failed readiness: {url}")


def verify(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Api:
    def __init__(self, base: str, token: str):
        self.base = base
        self.token = token

    def request(self, method: str, path: str, body=None, key: str | None = None) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self.token}"}
        if key:
            headers["Idempotency-Key"] = key
        with httpx.Client(base_url=self.base, headers=headers, timeout=15, trust_env=False) as client:
            return client.request(method, path, json=body) if body is not None else client.request(method, path)

    def ok(self, method: str, path: str, body=None, key: str | None = None):
        response = self.request(method, path, body, key)
        if not response.is_success:
            raise AssertionError(f"{method} {path} returned {response.status_code}: {response.text[:800]}")
        return response.json()


async def mcp_acceptance(environment: dict[str, str], token: str, task: dict, project_id: str) -> dict:
    child_env = dict(environment, ORDIVANT_API_TOKEN=token)
    parameters = StdioServerParameters(command=sys.executable, args=["-m", "ordivant.mcp_server"], env=child_env, cwd=str(ROOT))
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = {tool.name for tool in tools.tools}
            expected = {"get_project_context", "create_task", "update_task", "find_ready_tasks", "claim_task", "renew_lease", "report_progress", "get_task_context", "block_task", "release_task", "submit_result", "review_result", "find_agents", "request_help", "send_message", "read_inbox", "delegate_task"}
            verify(expected <= names, f"Missing MCP tools: {sorted(expected - names)}")
            context = await session.call_tool("get_task_context", {"task_id": task["id"]})
            verify(not context.isError, "MCP task context failed")
            serialized = context.model_dump_json()
            verify(task["id"] in serialized and "done" in serialized, "MCP did not observe accepted REST result")
            create = {"project_id": project_id, "title": "MCP 冪等建立驗收", "goal": "Verify the MCP bridge shares REST policies", "acceptance_criteria": ["Identical request_id produces one task"], "request_id": "mcp-create-" + uuid.uuid4().hex}
            first = await session.call_tool("create_task", create)
            second = await session.call_tool("create_task", create)
            verify(not first.isError and not second.isError, "MCP create_task failed")
            verify(first.model_dump_json() == second.model_dump_json(), "MCP mutation replay changed its result")
            return {"tool_count": len(names), "context": "passed", "idempotent_create": "passed"}


def exercise(base: str, bootstrap: dict) -> dict:
    manager = Api(base, bootstrap["manager_token"])
    suffix = uuid.uuid4().hex[:6]
    project = manager.ok("POST", "/api/projects", {"key": "QA" + suffix.upper(), "name": "隔離協作驗收", "description": "Generated black-box validation data", "budget_usd": 25}, "qa-project-" + suffix)
    identities = {}
    for name, role in [("A", "worker"), ("B", "worker"), ("C", "reviewer")]:
        agent = manager.ok("POST", "/api/agents", {"name": f"QA {name} {suffix}", "role": role, "capabilities": ["testing", "collaboration"], "project_ids": [project["id"]], "runtime": "external"}, f"qa-agent-{suffix}-{name}")
        verify("token" in agent, "New agent credential must be returned once")
        identities[name] = {"id": agent["id"], "api": Api(base, agent["token"]), "token": agent["token"]}
    a, b, c = (identities[name]["api"] for name in ["A", "B", "C"])

    payload = {"project_id": project["id"], "title": "A 整合 B 成果並由 C 驗收", "goal": "Validate agent collaboration", "acceptance_criteria": ["B completes delegated work", "A integrates evidence", "C independently reviews"], "reviewer_id": identities["C"]["id"], "budget_usd": 5}
    task = manager.ok("POST", "/api/tasks", payload, "qa-task-" + suffix)
    replay = manager.ok("POST", "/api/tasks", payload, "qa-task-" + suffix)
    verify(task["id"] == replay["id"], "REST duplicate created another task")
    conflict = manager.request("POST", "/api/tasks", dict(payload, title="different payload"), "qa-task-" + suffix)
    verify(conflict.status_code == 409, "Changed idempotency payload must conflict")
    successor = manager.ok("POST", "/api/tasks", {"project_id": project["id"], "title": "Only accepted results unlock me", "goal": "Dependency gating", "acceptance_criteria": ["Parent accepted"], "dependency_ids": [task["id"]]})
    denied = b.request("POST", f"/api/tasks/{successor['id']}/claim", {})
    verify(denied.status_code == 409, "Unaccepted dependency was claimable")
    cycle = manager.request("PATCH", f"/api/tasks/{task['id']}", {"dependency_ids": [successor["id"]]})
    verify(cycle.status_code in [409, 422], "Dependency cycle was accepted")
    unauthorized = a.request("GET", f"/api/projects/{bootstrap['isolated_project_id']}")
    verify(unauthorized.status_code in [403, 404], "Agent accessed another project")

    claim = a.ok("POST", f"/api/tasks/{task['id']}/claim", {}, "qa-claim-" + suffix)
    verify(claim["execution"]["agent_id"] == identities["A"]["id"], "Claim did not preserve actor identity")
    help_payload = {"project_id": project["id"], "task_id": task["id"], "recipient_id": identities["B"]["id"], "kind": "help_request", "body": "Please verify the contract and return evidence."}
    help_msg = a.ok("POST", "/api/messages", help_payload, "qa-help-" + suffix)
    verify(a.ok("POST", "/api/messages", help_payload, "qa-help-" + suffix)["id"] == help_msg["id"], "Duplicate help message")
    inbox = b.ok("GET", "/api/messages?inbox=true")
    verify(any(message["id"] == help_msg["id"] for message in inbox), "B did not receive A's request")
    b.ok("POST", f"/api/messages/{help_msg['id']}/ack", {"status": "accepted"})
    child = a.ok("POST", f"/api/tasks/{task['id']}/delegate", {"agent_id": identities["B"]["id"], "title": "B contract verification", "goal": "Produce verification evidence", "acceptance_criteria": ["Return an explicit test report"], "budget_usd": 1}, "qa-delegate-" + suffix)
    child_claim = b.ok("POST", f"/api/tasks/{child['id']}/claim", {})
    child_submit = {"execution_id": child_claim["execution"]["id"], "lease_token": child_claim["lease_token"], "summary": "Contract verified", "artifacts": [{"kind": "test_report", "title": "B verification", "content": "All requested interface checks passed in the acceptance scenario."}], "cost_usd": 0}
    b.ok("POST", f"/api/tasks/{child['id']}/submit", child_submit, "qa-child-submit-" + suffix)
    c.ok("POST", f"/api/tasks/{child['id']}/review", {"decision": "accept", "comment": "Independently inspected B's evidence"}, "qa-child-review-" + suffix)
    b.ok("POST", "/api/messages", {"project_id": project["id"], "task_id": task["id"], "recipient_id": identities["A"]["id"], "kind": "reply", "reply_to_id": help_msg["id"], "body": f"Verification accepted. Child task: {child['key']}"})
    verify(any(message.get("reply_to_id") == help_msg["id"] for message in a.ok("GET", "/api/messages?inbox=true")), "A did not receive B's reply")

    submit = {"execution_id": claim["execution"]["id"], "lease_token": claim["lease_token"], "summary": "A integrated B's accepted result", "artifacts": [{"kind": "summary", "title": "Integrated evidence", "content": f"Child {child['key']} accepted; help request replied; contract verified."}], "cost_usd": 0}
    context = a.ok("POST", f"/api/tasks/{task['id']}/submit", submit, "qa-submit-" + suffix)
    verify(context["task"]["status"] == "in_review", "Submission skipped review")
    self_review = a.request("POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "self review"})
    verify(self_review.status_code in [403, 409], "Executing agent accepted its own work")
    result = c.ok("POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "C verified the integrated evidence"}, "qa-review-" + suffix)
    verify(result["task"]["status"] == "done", "C review did not finish task")
    verify(a.ok("POST", f"/api/tasks/{task['id']}/submit", submit, "qa-submit-" + suffix)["task"]["status"] == "in_review", "Retry must replay the original response")
    successor_claim = b.ok("POST", f"/api/tasks/{successor['id']}/claim", {})
    b.ok("POST", f"/api/tasks/{successor['id']}/release", {"execution_id": successor_claim["execution"]["id"], "lease_token": successor_claim["lease_token"], "handoff": "Dependency gating verified; release both agents before the simultaneous claim test."})

    race_task = manager.ok("POST", "/api/tasks", {"project_id": project["id"], "title": "Concurrent claim race", "goal": "Exactly one winner", "acceptance_criteria": ["one claimant"]})
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(actor.request, "POST", f"/api/tasks/{race_task['id']}/claim", {}) for actor in [a, b]]
        codes = [future.result().status_code for future in futures]
    verify(sum(200 <= code < 300 for code in codes) == 1 and 409 in codes, f"Race claim statuses unexpected: {codes}")
    event_text = json.dumps(manager.ok("GET", "/api/events?project_id=" + project["id"]))
    verify(claim["lease_token"] not in event_text and identities["A"]["token"] not in event_text, "Credential leaked in audit")
    return {"collaboration": "passed", "claim_race": codes, "dependency_gating": "passed", "cycle_rejection": "passed", "idempotency": "passed", "review_separation": "passed", "project_isolation": "passed", "credential_redaction": "passed", "mcp_actor_token": identities["A"]["token"], "accepted_task": result["task"], "project_id": project["id"]}


def runtime_acceptance(api_base: str, runtime_base: str, bootstrap: dict) -> dict:
    manager = Api(api_base, bootstrap["manager_token"])
    builder = bootstrap["agents"]["builder"]
    catalog = manager.ok("GET", "/api/model-catalog")
    agents = manager.ok("GET", "/api/agents")
    assigned = next((agent for agent in agents if agent["id"] == builder["id"]), None)
    verify(catalog.get("default") is None and assigned is not None and assigned.get("effective_model_config") is None,
           "Demo-only runtime acceptance requires an unconfigured Agent; use live_model_acceptance.py for a configured provider")
    task = manager.ok("POST", "/api/tasks", {"project_id": bootstrap["project_id"], "title": "Pi Durable 自動派送驗收", "goal": "Create durable evidence using the scoped platform tools", "acceptance_criteria": ["Runtime submits a result through an authenticated agent lease"], "assignee_id": builder["id"], "reviewer_id": bootstrap["agents"]["reviewer"]["id"]})
    key = "runtime-dispatch-" + uuid.uuid4().hex
    event = manager.ok("POST", f"/api/tasks/{task['id']}/dispatch", {"agent_id": builder["id"]}, key)
    verify(manager.ok("POST", f"/api/tasks/{task['id']}/dispatch", {"agent_id": builder["id"]}, key)["id"] == event["id"], "Duplicate outbox dispatch")
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        context = manager.ok("GET", f"/api/tasks/{task['id']}/context")
        if context["task"]["status"] == "in_review":
            break
        time.sleep(0.3)
    else:
        raise AssertionError("Pi dispatcher did not deliver evidence within 40 seconds")
    verify(len(context["executions"]) == 1 and len(context["artifacts"]) >= 1, "Runtime duplicated execution or omitted evidence")
    reviewer = Api(api_base, bootstrap["agents"]["reviewer"]["token"])
    accepted = reviewer.ok("POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "Reviewed actual Pi demo-provider output and persisted evidence"})
    verify(accepted["task"]["status"] == "done", "Runtime evidence not reviewable")
    with httpx.Client(timeout=10, trust_env=False) as client:
        run = client.get(f"{runtime_base}/runs/{event['id']}", headers={"Authorization": "Bearer " + bootstrap["runtime_token"]})
        verify(run.is_success, "Runtime request record not inspectable")
        record = run.json()
        verify(record.get("conversation_id") and record.get("submission_id"), "Run lacks actual Pi identities")
        verify(record.get("mode") == "demo" and (record.get("receipt") or {}).get("mode") == "demo",
               "Demo acceptance received a live or unknown execution receipt")
    return {"dispatch": "passed", "execution_count": 1, "mode": "demo", "engine": "@earendil-works/pi-durable", "request_id": event["id"], "conversation_id": record["conversation_id"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-runtime", action="store_true")
    args = parser.parse_args()
    work = ROOT / ".data" / "validation" / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    work.mkdir(parents=True)
    api_port, runtime_port = unused_port(), unused_port()
    api_base, runtime_base = f"http://127.0.0.1:{api_port}", f"http://127.0.0.1:{runtime_port}"
    environment = dict(os.environ, ORDIVANT_MODE="development", ORDIVANT_DATA_DIR=str(work), ORDIVANT_API_URL=api_base, ORDIVANT_RUNTIME_MODE="demo", ORDIVANT_RUNTIME_PORT=str(runtime_port), PYTHONUTF8="1")
    # A caller may explicitly select a test PostgreSQL database; credentials never enter the report.
    if not environment.get("ORDIVANT_DATABASE_URL"):
        environment["ORDIVANT_DATABASE_URL"] = "sqlite:///" + (work / "ordivant.db").as_posix()
    processes = []
    handles = []
    report = {"status": "failed", "data_directory": str(work)}
    try:
        seeded = subprocess.run([sys.executable, "-m", "ordivant.seed"], cwd=ROOT, env=environment, capture_output=True, text=True, encoding="utf-8")
        verify(seeded.returncode == 0, f"Seed failed: {seeded.stderr[-1200:]}")
        bootstrap = json.loads((work / "bootstrap.json").read_text(encoding="utf-8"))
        api_log = (work / "api.log").open("w", encoding="utf-8")
        handles.append(api_log)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        api = subprocess.Popen([sys.executable, "-m", "uvicorn", "ordivant.main:app", "--host", "127.0.0.1", "--port", str(api_port), "--no-access-log"], cwd=ROOT, env=environment, stdout=api_log, stderr=subprocess.STDOUT, creationflags=flags)
        processes.append(api)
        report["api_health"] = ready(api_base + "/api/health", api)
        outcome = exercise(api_base, bootstrap)
        actor_token = outcome.pop("mcp_actor_token")
        task = outcome.pop("accepted_task")
        project_id = outcome.pop("project_id")
        report["rest"] = outcome
        report["mcp"] = asyncio.run(mcp_acceptance(environment, actor_token, task, project_id))
        if not args.skip_runtime:
            node = shutil.which("node")
            verify(bool(node) and (ROOT / "runtime" / "dist" / "server.js").exists(), "Build runtime before integration")
            runtime_log = (work / "runtime.log").open("w", encoding="utf-8")
            handles.append(runtime_log)
            runtime = subprocess.Popen([node, str(ROOT / "runtime" / "dist" / "server.js"), "--dispatcher"], cwd=ROOT / "runtime", env=environment, stdout=runtime_log, stderr=subprocess.STDOUT, creationflags=flags)
            processes.append(runtime)
            report["runtime_health"] = ready(runtime_base + "/health", runtime)
            report["runtime"] = runtime_acceptance(api_base, runtime_base, bootstrap)
        report["status"] = "passed"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        report["error"] = str(error)
        print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
        for process in reversed(processes):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for handle in handles:
            handle.close()
        (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

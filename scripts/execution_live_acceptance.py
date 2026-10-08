"""One explicitly configured synthetic live-model/tool/sandbox run on isolated QA.

Provider secrets travel in memory to the owned QA API; reports omit credentials and endpoint.
This is separate from deterministic acceptance and is not a billing validation.
"""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
import re
import time

from configure_test_model import ConfigurationError, load_test_provider_config
from execution_acceptance import Acceptance, BASE, OWNER, ROOT, docker
from execution_test_credential import read_authorized_test_key


def main():
    try:
        config = load_test_provider_config()
    except ConfigurationError as exc:
        print(str(exc))
        return 2
    if config.project != OWNER:
        print("ORDIVANT_TEST_PROVIDER_PROJECT must match the isolated Compose owner used by this acceptance fixture")
        return 2
    suite = Acceptance()
    report = {"status": "failed", "target": OWNER, "compose_project": config.project, "provider_id": config.provider_id,
              "requested_model": config.model, "checks": suite.checks}
    key = ""
    rid = None
    try:
        web_container = OWNER + "-web-1"
        suite.check("owned_qa_web", docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', web_container).strip() == OWNER)
        suite.check("owned_qa_work", docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-work-api-1").strip() == OWNER)
        suite.check("owned_qa_runtime", docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', OWNER + "-runtime-1").strip() == OWNER)
        web_ports = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", web_container))
        suite.check("qa_web_published_on_8092", any(
            binding.get("HostIp") == "127.0.0.1" and binding.get("HostPort") == "8092"
            for binding in (web_ports.get("80/tcp") or [])
        ))
        runtime_ports = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", OWNER + "-runtime-1"))
        suite.check("qa_runtime_not_host_published", all(not bindings for bindings in runtime_ports.values()))
        suite.check("qa_web_api_health", suite.admin.get("/api/health").status_code == 200)
        suite.login()
        resources = json.loads((ROOT / ".data/validation/execution-qa-resources.json").read_text(encoding="utf-8"))
        key = read_authorized_test_key(config.key_file)
        if not key:
            raise RuntimeError("authorized_provider_credential_missing")
        a = suite.admin
        settings = suite.good(a, "GET", "/api/model-settings")
        providers = [{k: v for k, v in p.items() if k != "key_configured"} for p in settings["providers"] if p["id"] != config.provider_id]
        providers.append({"id": config.provider_id, "name": "Acceptance provider", "base_url": config.base_url, "enabled": True, "api_key": key,
                          "models": [{"id": config.model, "name": config.model, "context_window": 4096,
                                      "max_output_tokens": 4096, "reasoning_efforts": ["low"]}]})
        saved = suite.good(a, "PUT", "/api/model-settings", {"providers": providers, "default": None, "revision": settings["revision"]})
        suite.check("qa_connection_saved_without_key_response", key not in json.dumps(saved))
        pid = resources["project"]["id"]
        connection_id = resources["connection"]["id"]
        discovery = suite.good(a, "POST", f"/api/tool-connections/{connection_id}/test", {})
        namespace = re.sub(r"[^A-Za-z0-9]", "", connection_id)[:12] or "connection"
        mcp_names = {tool["name"]: f"mcp_{namespace}_{i}_{hashlib.sha256((connection_id + chr(0) + tool['name']).encode()).hexdigest()[:10]}"[:64] for i, tool in enumerate(discovery["tools"])}
        wait_name, add_name = mcp_names["synthetic_wait"], mcp_names["synthetic_add"]
        agent = suite.good(a, "POST", "/api/agents", {
            "name": "Live tool/sandbox QA " + suite.run, "role": "worker", "capabilities": ["synthetic-live-qa"], "project_ids": [pid], "runtime": "pi", "model_config": config.selection,
            "execution_config": {"instructions": "Only perform the synthetic acceptance task. Call registered tools to obtain real evidence, do not invent command output. An intentional exit code 7 is a negative test, not a passing command. Never call forbidden_fixture_tool.",
                                 "tool_connection_ids": [resources["connection"]["id"]], "sandbox_profile_id": resources["profile"]["id"], "limits": {"max_turns": 20, "timeout_seconds": 300}},
        })
        agent.pop("token", None)
        task = suite.good(a, "POST", "/api/tasks", {
            "project_id": pid, "title": "真實模型 MCP／沙箱驗收 " + suite.run,
            "goal": f"Execute these synthetic steps with actual tools, in order: 1) Your first tool-call batch must contain only the allowed external MCP synthetic_wait, registered as {wait_name}, with seconds=10; wait for its response before calling any other tool. Then call synthetic_add, registered as {add_name}, with a=19,b=23 and confirm 42. 2) sandbox_write_file path tests/test_calc.py, content assert 19 + 23 == 42 plus print('ACTUAL_SANDBOX_TEST_PASS'). 3) sandbox_execute command ['python3','tests/test_calc.py']; observe exit 0. 4) execute ['python3','-c','raise SystemExit(7)'] as an intentional negative test; report exit 7 truthfully. Summarize actual results and submit evidence. Do not request network access or more tools.",
            "acceptance_criteria": ["外部 MCP 計算實際回傳 42", "隔離沙箱實際測試 exit 0", "負面測試保留 exit 7", "不使用未允許的工具"], "assignee_id": agent["id"],
        })
        event = suite.good(a, "POST", f"/api/tasks/{task['id']}/dispatch", {"agent_id": agent["id"]})
        rid = event["id"]
        report.update(run_id=rid, task_id=task["id"], project_id=pid, mcp_tools=mcp_names)

        def wait_started():
            events = suite.good(a, "GET", f"/api/runs/{rid}/events")
            if any(e["kind"] == "tool_start" and e["data"].get("tool_name") == wait_name for e in events):
                return True
            run = suite.good(a, "GET", f"/api/runs/{rid}")
            if run["status"] in {"failed", "aborted", "done"}:
                raise AssertionError("synthetic_wait_was_not_observed")
            return False

        suite.wait("actual_external_wait_tool_started", wait_started, timeout=90)
        requested = suite.good(a, "POST", f"/api/runs/{rid}/control", {"action": "pause"})
        suite.check("cooperative_pause_requested", requested["desired_action"] == "pause")
        paused = suite.wait("actual_tool_boundary_paused", lambda: (r if (r := suite.good(a, "GET", f"/api/runs/{rid}"))["status"] == "paused" else None), timeout=40)
        execution_id = paused["execution_id"]
        suite.good(a, "POST", f"/api/runs/{rid}/control", {"action": "resume"})
        final = suite.wait("live_run_completed", lambda: (r if (r := suite.good(a, "GET", f"/api/runs/{rid}"))["status"] == "done" else None), timeout=150)
        suite.check("resume_preserved_same_execution", final["execution_id"] == execution_id)
        receipt = final["receipt"]
        suite.check("actual_live_returned_model", final["mode"] == "live" and receipt["returned"]["model_id"] == config.model and receipt["usage"]["total_tokens"] > 0)
        tool_names = [t["name"] for t in receipt["tools"]]
        suite.check("actual_mcp_tool_call_receipt", add_name in tool_names and wait_name in tool_names)
        suite.check("forbidden_tool_never_called", mcp_names["forbidden_fixture_tool"] not in tool_names and {name for name in tool_names if name.startswith("mcp_")}.issubset({wait_name, add_name}))
        suite.check("actual_sandbox_tool_receipt", {"sandbox_write_file", "sandbox_execute"}.issubset(tool_names))
        events = suite.good(a, "GET", f"/api/runs/{rid}/events")
        event_text = json.dumps(events, ensure_ascii=False)
        suite.check("safe_actual_tool_result_evidence", "ACTUAL_SANDBOX_TEST_PASS" in event_text and "exit_code" in event_text and key not in event_text)
        sandbox_results = [e["data"] for e in events if e["kind"] == "sandbox" and e["data"].get("operation") == "execute"]
        suite.check("actual_sandbox_success_and_negative_exit", any(r.get("exit_code") == 0 and "ACTUAL_SANDBOX_TEST_PASS" in r.get("observed", "") for r in sandbox_results) and any(r.get("exit_code") == 7 for r in sandbox_results))
        suite.check("currency_not_fabricated", receipt["cost_usd"] is None)
        context = suite.good(a, "GET", f"/api/tasks/{task['id']}/context")
        suite.check("actual_result_requires_independent_review", context["task"]["status"] == "in_review" and bool(context["artifacts"]))
        suite.good(a, "POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "PM 合成驗收：檢視 MCP 真實計算、沙箱 exit0／exit7 與模型 receipt。"})
        suite.check("independent_pm_review_accepted", suite.good(a, "GET", f"/api/tasks/{task['id']}")["status"] == "done")
        suite.check("sandbox_cleanup_reported", (final.get("sandbox") or {}).get("status") in {"stopped", "cleaned", "cleaned_up"})
        docker("restart", "--time", "3", OWNER + "-work-api-1", OWNER + "-runtime-1")
        suite.wait("live_services_restart_ready", lambda: suite.admin.get("/api/health").status_code == 200)
        recovered = suite.good(a, "GET", f"/api/runs/{rid}")
        suite.check("live_receipt_and_execution_survive_restart", recovered["status"] == "done" and recovered["receipt"] == receipt and recovered["execution_id"] == execution_id)
        report["receipt"] = receipt
        report["status"] = "passed"
    except Exception as error:
        report.update(error_type=type(error).__name__, failed_check=suite.current_check)
    finally:
        if report["status"] != "passed" and rid:
            try:
                run = suite.admin.get(f"/api/runs/{rid}").json()
                if run.get("status") in {"queued", "running", "paused"}:
                    suite.admin.post(f"/api/runs/{rid}/control", json={"action": "stop"}, headers={"Idempotency-Key": "failed-live-cleanup-" + rid})
            except Exception:
                pass
        key = ""
        suite.close()
        path = suite.directory / "live-report.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f'EXECUTION_LIVE_{report["status"].upper()} {len(suite.checks)} checks; {path}')
        if report["status"] != "passed":
            print("Failed check: " + suite.current_check)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

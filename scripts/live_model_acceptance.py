"""Live-model Work acceptance using synthetic data in an isolated local QA project.

Configure the authorized connection server-side, create a new scoped Pi Agent, dispatch
through the real outbox/lease/tool engine, review independently and check persistence.
Credentials are captured into process memory only and omitted from reports and errors.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import time
import uuid
from pathlib import Path

import httpx

from configure_test_model import ConfigurationError, configure, load_test_provider_config
from execution_test_credential import read_authorized_test_key

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8092"

_RUNTIME_GET = """
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", async () => {
  try {
    const request = JSON.parse(input);
    const response = await fetch("http://127.0.0.1:8090" + request.path, {
      headers: request.token ? {Authorization: "Bearer " + request.token} : {},
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    if (response.status !== 200) {
      process.stdout.write(JSON.stringify({status: response.status}));
      return;
    }
    process.stdout.write(JSON.stringify({status: 200, body: await response.json()}));
  } catch (_) {
    process.stdout.write(JSON.stringify({status: 0}));
  }
});
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, help="Explicit credential file override; otherwise use ORDIVANT_TEST_PROVIDER_KEY_FILE")
    parser.add_argument("--restart", action="store_true", help="Check the same run after an owned runtime restart")
    args = parser.parse_args()
    try:
        config = load_test_provider_config(args.key_file)
    except (ConfigurationError, RuntimeError) as exc:
        print(str(exc))
        return 2
    key = ""
    report_dir = ROOT / ".data/validation" / ("live-work-" + uuid.uuid4().hex[:8])
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {"status": "running", "compose_project": config.project, "base_url": BASE,
              "provider_id": config.provider_id, "requested_model": config.model, "checks": {}}

    def docker(*arguments, input_text=None):
        result = subprocess.run(["docker", *arguments], input=input_text, text=True, encoding="utf-8", capture_output=True, timeout=90)
        if result.returncode:
            raise RuntimeError("Owned Docker operation failed; credential-bearing output suppressed")
        return result.stdout

    def runtime_get(container: str, path: str, token: str | None = None):
        response = subprocess.run(
            ["docker", "exec", "-i", container, "node", "-e", _RUNTIME_GET],
            input=json.dumps({"path": path, "token": token}), text=True, encoding="utf-8",
            capture_output=True, timeout=25,
        )
        if response.returncode or (token and (token in response.stdout or token in response.stderr)):
            raise RuntimeError("Owned runtime request failed; credential-bearing output suppressed")
        try:
            return json.loads(response.stdout)
        except (ValueError, TypeError) as exc:
            raise RuntimeError("Owned runtime returned an invalid response") from exc

    def check(name: str, passed: bool):
        report["checks"][name] = passed
        if not passed:
            raise RuntimeError(name)

    def request(client: httpx.Client, method: str, path: str, body=None, expected=200, request_key=None):
        headers = {"Idempotency-Key": request_key or uuid.uuid4().hex} if method not in {"GET", "HEAD"} else {}
        response = client.request(method, path, json=body, headers=headers)
        if response.status_code != expected:
            raise RuntimeError(f"{method} {path}: HTTP {response.status_code}; response body suppressed")
        return response.json()

    try:
        api_container = config.project + "-work-api-1"
        web_container = config.project + "-web-1"
        runtime_container = config.project + "-runtime-1"
        for name in [web_container, api_container, runtime_container]:
            label = docker("inspect", "--format", '{{ index .Config.Labels "com.docker.compose.project" }}', name).strip()
            check("owned_" + name, label == config.project)
        web_ports = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", web_container))
        check("owned_web_port_8092", any(
            binding.get("HostIp") == "127.0.0.1" and binding.get("HostPort") == "8092"
            for binding in (web_ports.get("80/tcp") or [])
        ))
        runtime_ports = json.loads(docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", runtime_container))
        check("runtime_has_no_host_published_ports", all(not bindings for bindings in runtime_ports.values()))
        with httpx.Client(base_url=BASE, timeout=10, trust_env=False, follow_redirects=False) as web:
            check("owned_web_api_health", web.get("/api/health").status_code == 200)
        check("owned_runtime_health", runtime_get(runtime_container, "/health").get("status") == 200)
        bootstrap = json.loads(docker("exec", api_container, "python", "-c",
                                     "import json;from pathlib import Path;print(Path('/data/bootstrap.json').read_text())"))
        key = read_authorized_test_key(args.key_file)
        with httpx.Client(base_url=BASE, headers={"Authorization": "Bearer " + bootstrap["manager_token"]},
                          timeout=30, trust_env=False, follow_redirects=False) as manager:
            check("legacy_manager_cannot_manage_global_connections", manager.get("/api/model-settings").status_code == 403)
            configured = configure(args.key_file)
            report["configuration_source"] = "Trusted local server operator import; no Identity account changes"
            selection = config.selection
            check("provider_key_never_returned", key not in json.dumps(configured))
            check("default_model_selected", configured["default"] == selection)
            catalog = request(manager, "GET", "/api/model-catalog")
            check("catalog_has_configured_model", any(p["id"] == config.provider_id and p["key_configured"]
                  and any(m["id"] == config.model for m in p["models"]) for p in catalog["providers"]))

            tag = uuid.uuid4().hex[:8]
            project = request(manager, "POST", "/api/projects", {
                "key": "LIVE-" + tag, "name": "真實模型驗收 " + tag,
                "description": "Synthetic local acceptance data only; not a user project."}, expected=201)
            agent = request(manager, "POST", "/api/agents", {
                "name": "Live acceptance Agent " + tag, "role": "worker", "runtime": "pi",
                "project_ids": [project["id"]], "capabilities": ["acceptance"], "model_config": None}, expected=201)
            check("new_agent_inherits_global_model", agent["model_config"] is None and agent["effective_model_config"] == selection)
            override = {**selection, "max_output_tokens": max(16, selection["max_output_tokens"] // 2)}
            edited = request(manager, "PATCH", "/api/agents/" + agent["id"], {"model_config": override})
            check("agent_override_persists", edited["model_config"] == override and edited["effective_model_config"] == override)
            edited = request(manager, "PATCH", "/api/agents/" + agent["id"], {"model_config": None})
            check("agent_null_clears_override", edited["model_config"] is None and edited["effective_model_config"] == selection)
            reviewer = request(manager, "POST", "/api/agents", {
                "name": "獨立驗收 Reviewer " + tag, "role": "reviewer", "runtime": "external",
                "project_ids": [project["id"]], "capabilities": ["review"]}, expected=201)
            task = request(manager, "POST", "/api/tasks", {
                "project_id": project["id"], "title": "真實模型與平台工具驗收 " + tag,
                "goal": "Verify the real model reads the leased task using get_task_context and reports progress using report_progress.",
                "inputs": "Synthetic operands: 19 and 23. Required final literal: SYNTHETIC_RESULT=42",
                "scope": "Only this synthetic task; no repository, file, external messages or other tasks.",
                "constraints": "First call get_task_context. Then call report_progress with progress 40 and a factual short summary. Finally answer SYNTHETIC_RESULT=42. Do not use send_message or delegate_task. Do not approve the task.",
                "acceptance_criteria": ["Real get_task_context tool call", "Real report_progress tool call", "Final SYNTHETIC_RESULT=42"],
                "assignee_id": agent["id"], "reviewer_id": reviewer["id"]}, expected=201)
            request_key = "live-acceptance-dispatch-" + tag
            event = request(manager, "POST", "/api/tasks/" + task["id"] + "/dispatch", {"agent_id": agent["id"]}, 201, request_key)
            replay = request(manager, "POST", "/api/tasks/" + task["id"] + "/dispatch", {"agent_id": agent["id"]}, 201, request_key)
            check("dispatch_replay_same_event", replay["id"] == event["id"])
            check("dispatch_snapshots_model_selection", event["payload"]["model_config"] == selection)
            report.update({"project_id": project["id"], "agent_id": agent["id"], "task_id": task["id"], "request_id": event["id"]})
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                context = request(manager, "GET", "/api/tasks/" + task["id"] + "/context")
                if context["task"]["status"] == "in_review":
                    break
                run_response = runtime_get(runtime_container, "/runs/" + event["id"], bootstrap["runtime_token"])
                if run_response.get("status") == 200 and (run_response.get("body") or {}).get("status") in {"failed", "aborted"}:
                    raise RuntimeError("Pi live run failed; inspect sanitized runtime status")
                time.sleep(0.5)
            else:
                raise RuntimeError("Pi live dispatch did not submit evidence within 180 seconds")
            run_response = runtime_get(runtime_container, "/runs/" + event["id"], bootstrap["runtime_token"])
            if run_response.get("status") != 200 or not isinstance(run_response.get("body"), dict):
                raise RuntimeError("Pi live run record is unavailable")
            run = run_response["body"]
            receipt = run.get("receipt") or {}
            check("real_pi_ids_and_success", run.get("status") == "done" and bool(run.get("conversation_id")) and bool(run.get("submission_id")))
            check("receipt_is_live", receipt.get("mode") == "live")
            check("returned_model_matches_requested", receipt.get("returned", {}).get("model_id") == config.model)
            names = {entry["name"] for entry in receipt.get("tools", []) if entry.get("calls", 0) > 0}
            check("model_called_task_context_tool", any("get_task_context" in name for name in names))
            check("model_called_progress_tool", any("report_progress" in name for name in names))
            check("actual_usage_recorded", (receipt.get("usage") or {}).get("total_tokens", 0) > 0)
            usage = receipt["usage"]
            check("input_usage_includes_cached_tokens", usage["input_tokens"] == sum(
                usage[field] for field in ["uncached_input_tokens", "cached_input_tokens", "cache_write_tokens"]))
            check("reported_total_matches_input_and_output", usage["total_tokens"] == usage["input_tokens"] + usage["output_tokens"])
            check("no_fabricated_usd_charge", receipt.get("cost_usd") is None)
            check("model_answer_contains_correct_result", "SYNTHETIC_RESULT=42" in run.get("answer", ""))
            check("single_execution_with_evidence", len(context["executions"]) == 1 and bool(context["artifacts"]))
            check("live_evidence_not_demo", all("DEMO MODE" not in item.get("title", "") for item in context["artifacts"]))
            safe_public = json.dumps({"run": run, "context": context, "events": request(manager, "GET", "/api/events?project_id=" + project["id"])})
            check("credentials_absent_from_records", all(secret not in safe_public for secret in [key, agent["token"], reviewer["token"], bootstrap["runtime_token"]]))
            with httpx.Client(base_url=BASE, headers={"Authorization": "Bearer " + agent["token"]}, trust_env=False) as worker:
                rejected = worker.post("/api/tasks/" + task["id"] + "/review", json={"decision": "accept", "comment": "Self review must be rejected"})
                check("executing_agent_cannot_self_review", rejected.status_code == 403)
            with httpx.Client(base_url=BASE, headers={"Authorization": "Bearer " + reviewer["token"]}, trust_env=False) as independent:
                accepted = request(independent, "POST", "/api/tasks/" + task["id"] + "/review", {
                    "decision": "accept", "comment": "Acceptance harness independently checked model/tool receipt and correct synthetic output; this is not an AI reviewer."})
                check("independent_authorized_review_completes_task", accepted["task"]["status"] == "done")
            if args.restart:
                docker("restart", runtime_container)
                restart_deadline = time.monotonic() + 45
                while time.monotonic() < restart_deadline:
                    try:
                        restored_response = runtime_get(runtime_container, "/runs/" + event["id"], bootstrap["runtime_token"])
                        if restored_response.get("status") != 200 or not isinstance(restored_response.get("body"), dict):
                            time.sleep(0.5)
                            continue
                        restored = restored_response["body"]
                        if restored.get("status") == "done":
                            break
                    except (httpx.HTTPError, RuntimeError):
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Runtime restart did not recover the completed receipt")
                check("live_receipt_survives_restart", restored["receipt"] == receipt and restored["submission_id"] == run["submission_id"])
            report["receipt"] = receipt
            report["conversation_id"] = run["conversation_id"]
            report["submission_id"] = run["submission_id"]
        report["status"] = "passed"
        report["limitations"] = ["Only synthetic data was sent", "The upstream reported model ID is verified; underlying routing and invoice charges are not independently established", "Review was an authorized independent test harness, not an autonomous model reviewer"]
        exit_code = 0
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = str(exc).replace(key, "[redacted]")[:300] if isinstance(exc, RuntimeError) else type(exc).__name__
        exit_code = 1
    (report_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"LIVE_WORK_ACCEPTANCE_{report['status'].upper()}: {report_dir / 'report.json'}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

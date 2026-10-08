"""Black-box Suite acceptance with immutable specs, agent delegation and real Gitea."""

from __future__ import annotations

import argparse
import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from integration import Api, ready, unused_port, verify

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = {
    "work": (ROOT / "backend", "ordivant", "ORDIVANT"),
    "knowledge": (ROOT / "products/knowledge/backend", "ordivant_knowledge", "ORDIVANT_KNOWLEDGE"),
    "code": (ROOT / "products/code/backend", "ordivant_code", "ORDIVANT_CODE"),
}


def python_for(product: str) -> str:
    directory = PRODUCTS[product][0]
    return str(directory / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))


async def mcp_check(product: str, environment: dict, token: str, arguments: dict) -> dict:
    _, package, prefix = PRODUCTS[product]
    parameters = StdioServerParameters(command=python_for(product), args=["-m", package + ".mcp_server"], env=dict(environment, **{prefix + "_API_TOKEN": token}), cwd=str(ROOT))
    expected = {
        "knowledge": {"list_spaces", "search_knowledge", "create_document", "get_document_context", "get_document_version", "publish_document_version", "record_decision", "list_decisions"},
        "code": {"list_code_projects", "list_repositories", "create_repository", "create_branch", "commit_file", "create_pull_request", "get_pull_request", "report_check", "get_code_events"},
    }[product]
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            names = {tool.name for tool in (await session.list_tools()).tools}
            verify(expected <= names, f"{product} MCP tools missing: {expected - names}")
            name = "get_document_version" if product == "knowledge" else "get_pull_request"
            result = await session.call_tool(name, arguments)
            verify(not result.isError, f"{product} MCP context failed")
            serialized = result.model_dump_json()
            verify(str(arguments.get("document_id", arguments.get("repository_id"))) in serialized, f"{product} MCP lost resource identity")
            resources = await session.list_resource_templates()
            verify(bool(resources.resourceTemplates), f"{product} MCP lacks context resource templates")
            return {"tool_count": len(names), "context": "passed", "resource_templates": len(resources.resourceTemplates)}


def fixture_evidence(directory: Path) -> tuple[str, str, dict]:
    """Run tests against the exact UTF-8 source subsequently committed to Gitea."""
    source = '''def task_key(prefix: str, sequence: int) -> str:
    if not prefix.isalpha() or not prefix.isupper() or sequence < 1:
        raise ValueError("invalid task key")
    return f"{prefix}-{sequence}"
'''
    tests = '''import pytest
from task_key import task_key

@pytest.mark.parametrize("prefix,sequence,expected", [("ORD",1,"ORD-1"),("QA",42,"QA-42")])
def test_valid_keys(prefix, sequence, expected):
    assert task_key(prefix, sequence) == expected

@pytest.mark.parametrize("prefix,sequence", [("ord",1),("O/",1),("ORD",0),("ORD",-1)])
def test_invalid_keys(prefix, sequence):
    with pytest.raises(ValueError):
        task_key(prefix, sequence)
'''
    directory.mkdir()
    (directory / "task_key.py").write_text(source, encoding="utf-8", newline="\n")
    (directory / "test_task_key.py").write_text(tests, encoding="utf-8", newline="\n")
    result = subprocess.run([python_for("work"), "-m", "pytest", "-q", "test_task_key.py"], cwd=directory, capture_output=True, text=True, encoding="utf-8", env=dict(os.environ, PYTHONUTF8="1"))
    verify(result.returncode == 0, "Committed fixture failed its real local tests")
    (directory / "pytest.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
    return source, tests, {"runner": "local pytest", "exit_code": result.returncode, "output": result.stdout.strip(), "source_sha256": hashlib.sha256(source.encode()).hexdigest(), "test_sha256": hashlib.sha256(tests.encode()).hexdigest()}


async def work_vcs_mcp(environment: dict, token: str, project_id: str, repository: str, number: int) -> dict:
    parameters = StdioServerParameters(command=python_for("work"), args=["-m", "ordivant.mcp_server"], env=dict(environment, ORDIVANT_API_TOKEN=token), cwd=str(ROOT))
    async with stdio_client(parameters) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            await session.initialize()
            names = {tool.name for tool in (await session.list_tools()).tools}
            verify("get_vcs_pull_request" in names, "Work MCP lacks independent VCS reader")
            result = await session.call_tool("get_vcs_pull_request", {"project_id": project_id, "provider": "gitea", "repository": repository, "number": number})
            verify(not result.isError and "provider_api" in result.model_dump_json(), "Work MCP could not read VCS while peers stopped")
            return {"tool_count": len(names), "direct_vcs_context": "passed"}


def exercise(bases: dict, bootstrap: dict, environment: dict, directory: Path, gitea: dict) -> dict:
    suffix = uuid.uuid4().hex[:10]
    kb = bootstrap["knowledge"]
    cb = bootstrap["code"]
    wb = bootstrap["work"]
    knowledge = Api(bases["knowledge"], kb["writer_token"])
    knowledge_reader = Api(bases["knowledge"], kb["reader_token"])
    code = Api(bases["code"], cb["writer_token"])
    code_reader = Api(bases["code"], cb["reader_token"])
    manager = Api(bases["work"], wb["manager_token"])
    code_project = code.ok("GET", "/api/projects")[0]
    code_all_projects = Api(bases["code"], cb["manager_token"]).ok("GET", "/api/projects")
    code_isolated_project = next(project for project in code_all_projects if project["id"] != code_project["id"])

    document_payload = {"space_id": kb["primary_scope_id"], "title": "Suite task-key delivery " + suffix, "summary": "A versioned specification for a delegated code change", "body": "# Task key contract\n\nUse uppercase alphabetic prefix and positive sequence. Format: ORD-42. Reject invalid values.\n", "tags": ["suite-acceptance"], "change_summary": "Initial exact specification"}
    context = knowledge.ok("POST", "/api/documents", document_payload, "doc-" + suffix)
    doc, v1 = context["document"], context["version"]
    verify(v1["version"] == 1 and v1["uri"].endswith("/versions/1"), "Knowledge did not create an exact-version citation")
    verify(knowledge.ok("POST", "/api/documents", document_payload, "doc-" + suffix)["document"]["id"] == doc["id"], "Knowledge duplicated create")
    verify(knowledge_reader.request("POST", "/api/documents", document_payload).status_code == 403, "Knowledge reader wrote a document")
    verify(knowledge.request("GET", "/api/spaces/" + kb["isolated_scope_id"]).status_code in [403, 404], "Knowledge leaked isolated space")

    project = manager.ok("POST", "/api/projects", {"key": "SU" + suffix[:6].upper(), "name": "Suite 委派整合驗收", "budget_usd": 10}, "project-" + suffix)
    actors = {}
    for label, role in [("A", "worker"), ("B", "worker"), ("C", "reviewer")]:
        actor = manager.ok("POST", "/api/agents", {"name": "Suite " + label + " " + suffix, "role": role, "capabilities": ["code", "testing"], "project_ids": [project["id"]], "runtime": "external"}, "agent-" + label + suffix)
        actors[label] = {"id": actor["id"], "api": Api(bases["work"], actor["token"])}
    a, b, reviewer = [actors[label]["api"] for label in ["A", "B", "C"]]
    task = manager.ok("POST", "/api/tasks", {"project_id": project["id"], "title": "依 Knowledge v1 委派實作並驗收", "goal": "Deliver a tested code change against an immutable spec", "inputs": v1["uri"], "scope": "task_key.py and test_task_key.py", "acceptance_criteria": ["Real Gitea PR references exact specification", "Local tests run against the committed source", "Independent C accepts evidence"], "reviewer_id": actors["C"]["id"]}, "task-" + suffix)
    task_ref = {"product": "work", "kind": "task", "uri": "ordivant://work/tasks/" + task["id"], "title": task["key"]}
    spec_ref = {"product": "knowledge", "kind": "document_version", "uri": v1["uri"], "title": doc["title"] + " v1"}
    claim_a = a.ok("POST", f"/api/tasks/{task['id']}/claim", {"lease_seconds": 900})
    help_message = a.ok("POST", "/api/messages", {"project_id": project["id"], "task_id": task["id"], "recipient_id": actors["B"]["id"], "kind": "help_request", "body": "Implement the pinned Knowledge specification and return the Gitea PR with test evidence."})
    verify(any(message["id"] == help_message["id"] for message in b.ok("GET", "/api/messages?inbox=true")), "Delegated builder did not receive its brief")
    b.ok("POST", f"/api/messages/{help_message['id']}/ack", {"status": "accepted"})
    child = a.ok("POST", f"/api/tasks/{task['id']}/delegate", {"agent_id": actors["B"]["id"], "title": "B 實作 task key contract", "goal": "Implement and test the pinned specification", "inputs": v1["uri"], "acceptance_criteria": ["Actual Git commit and PR", "Six actual local pytest cases pass"]}, "delegate-" + suffix)
    claim_b = b.ok("POST", f"/api/tasks/{child['id']}/claim", {"lease_seconds": 900})

    repository_payload = {"project_id": code_project["id"], "name": "suite-acceptance-" + suffix, "description": "Owned Ordivant local acceptance fixture", "private": True}
    repo = code.ok("POST", "/api/repositories", repository_payload, "repo-" + suffix)
    verify(code.ok("POST", "/api/repositories", repository_payload, "repo-" + suffix)["id"] == repo["id"], "Code duplicated repository binding")
    verify(code_reader.request("POST", "/api/repositories", dict(repository_payload, name="denied-" + suffix)).status_code == 403, "Code reader created upstream repository")
    verify(code.request("GET", "/api/projects/" + code_isolated_project["id"]).status_code in [403, 404], "Code leaked isolated project")
    branch_payload = {"name": "feature/task-key", "from_branch": "main"}
    branch_path = f"/api/repositories/{repo['id']}/branches"
    branch = code.ok("POST", branch_path, branch_payload, "branch-" + suffix)
    verify(code.ok("POST", branch_path, branch_payload, "branch-" + suffix) == branch, "Code branch replay differs")
    source, tests, evidence = fixture_evidence(directory / "committed-fixture")
    commit = None
    for filename, content in [("task_key.py", source), ("test_task_key.py", tests)]:
        payload = {"branch": branch_payload["name"], "path": filename, "content": content, "commit_message": "Implement pinned specification: " + filename}
        path = f"/api/repositories/{repo['id']}/files"
        commit = code.ok("POST", path, payload, "commit-" + filename + suffix)
        verify(code.ok("POST", path, payload, "commit-" + filename + suffix) == commit, "Code replay created a second file commit")
    pull_payload = {"head": branch_payload["name"], "base": "main", "title": "Implement task key contract", "body": "Specification: " + v1["uri"] + "\nWork task: " + task_ref["uri"], "source_refs": [task_ref, spec_ref]}
    pull_path = f"/api/repositories/{repo['id']}/pulls"
    pull = code.ok("POST", pull_path, pull_payload, "pull-" + suffix)
    verify(code.ok("POST", pull_path, pull_payload, "pull-" + suffix)["number"] == pull["number"], "Code duplicated a PR")
    check_payload = {"commit_sha": commit["commit_sha"], "context": "ordivant/local-pytest", "state": "success", "description": "6 local pytest cases passed; agent-reported receipt"}
    check = code.ok("POST", f"/api/repositories/{repo['id']}/checks", check_payload, "check-" + suffix)
    verify(check["source"] == "agent_reported", "Agent report was mislabeled as CI")
    pull = code.ok("GET", pull_path + "/" + str(pull["number"]))
    verify(pull["source_refs"] == [task_ref, spec_ref] and bool(pull["checks"]), "PR lost source provenance or test receipt")

    # Inspect the Git provider itself; a platform receipt alone cannot prove a Git write.
    with httpx.Client(base_url=gitea["url"] + "/api/v1", headers={"Authorization": "token " + gitea["token"]}, trust_env=False, timeout=10) as upstream:
        upstream_repo = upstream.get(f"/repos/{repo['owner']}/{repo['name']}").json()
        verify(upstream_repo.get("private") is True, "Actual Gitea repository was not private")
        content = upstream.get(f"/repos/{repo['owner']}/{repo['name']}/contents/task_key.py", params={"ref": branch_payload["name"]}).json()
        verify(base64.b64decode(content["content"]).decode() == source, "Gitea source differs from tested source")
        upstream_pulls = upstream.get(f"/repos/{repo['owner']}/{repo['name']}/pulls").json()
        verify(len(upstream_pulls) == 1 and upstream_pulls[0]["number"] == pull["number"], "Actual Gitea PR count differs")
        upstream_commits = upstream.get(f"/repos/{repo['owner']}/{repo['name']}/commits", params={"sha": branch_payload["name"]}).json()
        verify(len(upstream_commits) == 3, "Idempotent calls created duplicate upstream commits")
        statuses = upstream.get(f"/repos/{repo['owner']}/{repo['name']}/statuses/{commit['commit_sha']}").json()
        verify(any(status.get("state", status.get("status")) == "success" and status["context"] == check_payload["context"] for status in statuses), "No real Gitea commit status")

    webhook_payload = {"ref": "refs/heads/" + branch_payload["name"], "after": commit["commit_sha"], "repository": {"id": upstream_repo["id"], "name": repo["name"], "full_name": repo["owner"] + "/" + repo["name"], "owner": {"login": repo["owner"], "username": repo["owner"]}}}
    raw = json.dumps(webhook_payload, separators=(",", ":")).encode()
    headers = {"Content-Type": "application/json", "X-Gitea-Event": "push", "X-Gitea-Delivery": "suite-" + suffix, "X-Gitea-Signature": "0" * 64}
    with httpx.Client(base_url=bases["code"], trust_env=False, timeout=10) as client:
        verify(client.post("/api/webhooks/gitea", content=raw, headers=headers).status_code in [401, 403], "Forged webhook accepted")
        headers["X-Gitea-Signature"] = hmac.new(gitea["webhook_secret"].encode(), raw, hashlib.sha256).hexdigest()
        first = client.post("/api/webhooks/gitea", content=raw, headers=headers)
        second = client.post("/api/webhooks/gitea", content=raw, headers=headers)
        verify(first.is_success and second.is_success, "Signed webhook or identical replay failed")
        changed = json.dumps(dict(webhook_payload, after="a" * 40), separators=(",", ":")).encode()
        headers["X-Gitea-Signature"] = hmac.new(gitea["webhook_secret"].encode(), changed, hashlib.sha256).hexdigest()
        verify(client.post("/api/webhooks/gitea", content=changed, headers=headers).status_code == 409, "Changed-body webhook replay did not conflict")

    artifacts = [{"kind": "document", "title": "Pinned Knowledge specification v1", "uri": v1["uri"]}, {"kind": "url", "title": "Actual private Gitea PR", "uri": pull["web_url"]}, {"kind": "test_report", "title": "Executed local pytest evidence", "content": json.dumps(evidence, ensure_ascii=False)}]
    b.ok("POST", f"/api/tasks/{child['id']}/submit", {"execution_id": claim_b["execution"]["id"], "lease_token": claim_b["lease_token"], "summary": "Committed tested source and opened real PR", "artifacts": artifacts})
    reviewer.ok("POST", f"/api/tasks/{child['id']}/review", {"decision": "accept", "comment": "C inspected actual Git writes, test output, source digest and exact spec"})
    b.ok("POST", "/api/messages", {"project_id": project["id"], "task_id": task["id"], "recipient_id": actors["A"]["id"], "kind": "reply", "reply_to_id": help_message["id"], "body": "Child accepted. PR: " + pull["web_url"]})
    a.ok("POST", f"/api/tasks/{task['id']}/submit", {"execution_id": claim_a["execution"]["id"], "lease_token": claim_a["lease_token"], "summary": "Integrated independently reviewed builder evidence", "artifacts": artifacts})
    verify(a.request("POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "self review"}).status_code in [403, 409], "Suite permitted self acceptance")
    accepted = reviewer.ok("POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "C verified complete cross-product delivery evidence"})
    verify(accepted["task"]["status"] == "done", "Suite parent not accepted")

    pull_ref = {"product": "code", "kind": "pull_request", "uri": pull["web_url"], "title": pull["title"]}
    publish_payload = {"expected_version": 1, "body": document_payload["body"] + "\nImplementation accepted after six local tests passed.\n", "change_summary": "Record accepted task and tested PR", "source_refs": [task_ref, pull_ref]}
    version_path = f"/api/documents/{doc['id']}/versions"
    v2 = knowledge.ok("POST", version_path, publish_payload, "publish-" + suffix)
    verify(knowledge.ok("POST", version_path, publish_payload, "publish-" + suffix) == v2, "Knowledge replay created an extra version")
    verify(knowledge.ok("GET", version_path + "/1") == v1, "Published document mutated its exact v1 snapshot")
    verify(v2["source_refs"] == [task_ref, pull_ref], "Knowledge lost accepted-task provenance")
    search = knowledge.ok("GET", "/api/documents?space_id=" + kb["primary_scope_id"] + "&q=Implementation%20accepted")
    verify(any(item["id"] == doc["id"] and item.get("uri", "").endswith("/versions/2") for item in search), "Knowledge text search lacks current exact citation")
    knowledge.ok("POST", "/api/decisions", {"space_id": kb["primary_scope_id"], "document_id": doc["id"], "title": "Accept delegated delivery", "body": "Independent reviewer checked real PR and exact-version evidence.", "source_refs": [task_ref, pull_ref]}, "decision-" + suffix)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(knowledge.request, "POST", version_path, {"expected_version": 2, "body": publish_payload["body"] + f"\nConcurrent editor {i}\n", "change_summary": "Concurrent version gate"}, f"race-{suffix}-{i}") for i in range(2)]
        statuses = [future.result().status_code for future in futures]
    verify(sum(200 <= status < 300 for status in statuses) == 1 and 409 in statuses, f"Knowledge CAS failed: {statuses}")
    for api, path in [(knowledge, "/api/events?space_id=" + kb["primary_scope_id"]), (code, "/api/events?project_id=" + code_project["id"]), (manager, "/api/events?project_id=" + project["id"])]:
        serialized = json.dumps(api.ok("GET", path))
        verify(all(secret not in serialized for secret in [gitea["token"], gitea["webhook_secret"], kb["writer_token"], cb["writer_token"], claim_a["lease_token"]]), "Credential leaked in Suite audit")
    mcp = {
        "knowledge": asyncio.run(mcp_check("knowledge", environment, kb["writer_token"], {"document_id": doc["id"], "version": 1})),
        "code": asyncio.run(mcp_check("code", environment, cb["writer_token"], {"repository_id": repo["id"], "number": pull["number"]})),
    }
    return {"flow": "passed", "knowledge": {"exact_v1_immutable": "passed", "version_race": statuses, "idempotency": "passed", "search_citation": "passed", "scope": "passed", "document_id": doc["id"]}, "work": {"delegation": "passed", "independent_acceptance": "passed", "task_id": task["id"]}, "code": {"real_private_repository": "passed", "real_commits": 3, "real_pr_count": 1, "real_status": "passed", "webhook_signature_and_replay": "passed", "scope": "passed", "repository_id": repo["id"], "repository": repo["owner"] + "/" + repo["name"], "pr_number": pull["number"], "pr_url": pull["web_url"]}, "test_evidence": evidence, "mcp": mcp}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gitea-config", type=Path, default=ROOT / ".data/gitea/connection.json")
    args = parser.parse_args()
    verify(args.gitea_config.is_file(), "Start owned local Gitea with scripts/gitea_local.py first")
    gitea = json.loads(args.gitea_config.read_text(encoding="utf-8"))
    parsed = httpx.URL(gitea["url"])
    verify(parsed.host in ["127.0.0.1", "localhost", "::1"] and parsed.scheme == "http", "Suite acceptance only writes to a local development Gitea")
    directory = ROOT / ".data/validation" / ("suite-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    directory.mkdir(parents=True)
    environment = dict(os.environ, ORDIVANT_MODE="development", PYTHONUTF8="1", ORDIVANT_CODE_GITEA_CONFIG=str(args.gitea_config.resolve()))
    bases, bootstrap, processes, handles = {}, {}, {}, []
    report = {"status": "failed", "data_directory": str(directory), "gitea_url": gitea["url"]}
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

    def start(product: str) -> subprocess.Popen:
        _, package, _ = PRODUCTS[product]
        handle = (directory / (product + ".log")).open("a", encoding="utf-8")
        handles.append(handle)
        port = httpx.URL(bases[product]).port
        process = subprocess.Popen([python_for(product), "-m", "uvicorn", package + ".main:app", "--host", "127.0.0.1", "--port", str(port), "--no-access-log"], cwd=ROOT, env=environment, stdout=handle, stderr=subprocess.STDOUT, creationflags=flags)
        processes[product] = process
        ready(bases[product] + "/api/health", process)
        return process

    try:
        for product, (_, package, prefix) in PRODUCTS.items():
            data = directory / product
            data.mkdir()
            bases[product] = "http://127.0.0.1:" + str(unused_port())
            environment[prefix + "_DATA_DIR"] = str(data)
            environment[prefix + "_API_URL"] = bases[product]
            if not environment.get(prefix + "_DATABASE_URL"):
                environment[prefix + "_DATABASE_URL"] = "sqlite:///" + (data / "business.db").as_posix()
            result = subprocess.run([python_for(product), "-m", package + ".seed"], cwd=ROOT, env=environment, capture_output=True, text=True, encoding="utf-8")
            verify(result.returncode == 0, f"{product} seed failed: {result.stderr[-1400:]}")
            bootstrap[product] = json.loads((data / "bootstrap.json").read_text(encoding="utf-8"))
        for product in PRODUCTS:
            process = start(product)
            report.setdefault("health", {})[product] = ready(bases[product] + "/api/health", process)
        report.update(exercise(bases, bootstrap, environment, directory, gitea))
        vcs_config = directory / "work/vcs.json"
        vcs_config.write_text(json.dumps({"projects": {bootstrap["work"]["project_id"]: {"gitea": {"api_url": gitea["url"] + "/api/v1", "token": gitea["token"], "repositories": [report["code"]["repository"]]}}}}), encoding="utf-8")
        environment["ORDIVANT_VCS_CONFIG"] = str(vcs_config)
        # Independent databases survive API restarts. Work then runs with both peers stopped.
        for product, process in list(processes.items()):
            process.terminate()
            process.wait(timeout=5)
            start(product)
        kb, cb, wb = (bootstrap[p] for p in ["knowledge", "code", "work"])
        verify(Api(bases["knowledge"], kb["reader_token"]).ok("GET", "/api/documents/" + report["knowledge"]["document_id"])["document"]["current_version"] == 3, "Knowledge version lost on restart")
        verify(Api(bases["code"], cb["reader_token"]).ok("GET", f"/api/repositories/{report['code']['repository_id']}/pulls/{report['code']['pr_number']}")["number"] == report["code"]["pr_number"], "Code PR binding lost on restart")
        manager = Api(bases["work"], wb["manager_token"])
        verify(manager.ok("GET", "/api/tasks/" + report["work"]["task_id"])["status"] == "done", "Work acceptance lost on restart")
        for product in ["knowledge", "code"]:
            processes[product].terminate()
            processes[product].wait(timeout=5)
        builder = Api(bases["work"], wb["agents"]["builder"]["token"])
        reviewer = Api(bases["work"], wb["agents"]["reviewer"]["token"])
        vcs = builder.ok("GET", f"/api/projects/{wb['project_id']}/vcs/pulls/gitea/{report['code']['pr_number']}?repository={report['code']['repository']}")
        verify(vcs["source"] == "provider_api" and vcs["checks_available"] and any(check["state"] == "success" for check in vcs["checks"]), "Work did not directly inspect real existing VCS while peers stopped")
        report["mcp"]["work"] = asyncio.run(work_vcs_mcp(environment, wb["agents"]["builder"]["token"], wb["project_id"], report["code"]["repository"], report["code"]["pr_number"]))
        task = manager.ok("POST", "/api/tasks", {"project_id": wb["project_id"], "title": "Existing VCS with peers stopped", "goal": "Work independently of optional Code and Knowledge", "inputs": vcs["web_url"], "acceptance_criteria": ["Work directly reads existing Git PR/checks and completes independent review with both peers stopped"], "reviewer_id": wb["agents"]["reviewer"]["id"]})
        claim = builder.ok("POST", f"/api/tasks/{task['id']}/claim", {})
        builder.ok("POST", f"/api/tasks/{task['id']}/submit", {"execution_id": claim["execution"]["id"], "lease_token": claim["lease_token"], "summary": "Independent Work lifecycle verified against directly inspected existing VCS", "artifacts": [{"kind": "url", "title": "Direct existing VCS evidence", "uri": vcs["web_url"], "content": json.dumps(vcs, ensure_ascii=False)}]})
        verify(reviewer.ok("POST", f"/api/tasks/{task['id']}/review", {"decision": "accept", "comment": "Verified Work API operates while both peers are stopped"})["task"]["status"] == "done", "Work required peers to accept a task")
        report["restart_persistence"] = "passed"
        report["work_without_peers"] = "passed (direct Gitea PR/status via Work REST and MCP, with Code and Knowledge stopped)"
        report["status"] = "passed"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        report["error"] = str(error)
        print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    finally:
        for process in reversed(list(processes.values())):
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        for handle in handles:
            handle.close()
        (directory / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

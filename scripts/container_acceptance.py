"""Black-box acceptance for an already-running Ordivant Compose project."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ("work", "knowledge", "code")
PACKAGES = {"work": "ordivant", "knowledge": "ordivant_knowledge", "code": "ordivant_code"}
API_PREFIX = {"work": "/api", "knowledge": "/knowledge-api", "code": "/code-api"}
PROJECT_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class AcceptanceError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AcceptanceError(message)


def _port(value: str | int, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise AcceptanceError(f"Invalid {label} port") from None
    require(1 <= parsed <= 65535, f"Invalid {label} port")
    return parsed


def _base_environment(project: str, development: bool, args: argparse.Namespace) -> dict[str, str]:
    environment = os.environ.copy()
    secrets_dir = ROOT / ".data" / "container-secrets" / project
    environment.update(
        {
            "ORDIVANT_SECRETS_DIR": str(secrets_dir).replace("\\", "/"),
            "ORDIVANT_IMAGE_PREFIX": project,
            "ORDIVANT_IMAGE_TAG": environment.get("ORDIVANT_IMAGE_TAG", "local"),
            "ORDIVANT_PRODUCT_MODE": "suite",
            "ORDIVANT_WEB_API_UPSTREAM": "http://work-api:8000",
            "ORDIVANT_RUNTIME_MODE": "demo",
            "ORDIVANT_AUTH_COOKIE_NAME": "ordivant_" + project.replace("-", "_") + "_session",
            "ORDIVANT_AUTH_ORIGINS": f"http://127.0.0.1:{args.web_port},http://localhost:{args.web_port}",
        }
    )
    if development:
        environment.update(
            {
                "ORDIVANT_DEV_WEB_PORT": str(args.web_port),
                "ORDIVANT_WORK_PORT": str(args.work_port),
                "ORDIVANT_KNOWLEDGE_PORT": str(args.knowledge_port),
                "ORDIVANT_CODE_PORT": str(args.code_port),
                "ORDIVANT_RUNTIME_PORT": str(args.runtime_port),
            }
        )
    else:
        environment["ORDIVANT_WEB_PORT"] = str(args.web_port)
    if args.gitea_port is not None:
        environment["ORDIVANT_GITEA_PORT"] = str(args.gitea_port)
    return environment


def _compose_prefix(project: str, development: bool) -> list[str]:
    command = [
        "docker",
        "compose",
        "--project-directory",
        str(ROOT),
        "--project-name",
        project,
        "--file",
        str(ROOT / "compose.yaml"),
    ]
    if development:
        command.extend(["--file", str(ROOT / "compose.dev.yaml")])
    return command + ["--profile", "gitea", "--profile", "runtime"]


def _compose(
    prefix: list[str],
    environment: dict[str, str],
    arguments: list[str],
    *,
    stdin: str | None = None,
    timeout: int = 120,
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            prefix + arguments,
            cwd=ROOT,
            env=environment,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AcceptanceError("Docker Compose command could not complete") from None
    if result.returncode:
        operation = arguments[0] if arguments else "command"
        raise AcceptanceError(f"Docker Compose {operation} failed; see Docker diagnostics")
    return result


def _capture_bootstrap(prefix: list[str], environment: dict[str, str], product: str) -> dict:
    code = "import json; from pathlib import Path; print(json.dumps(json.loads(Path('/data/bootstrap.json').read_text(encoding='utf-8'))))"
    result = _compose(prefix, environment, ["exec", "-T", product + "-api", "python", "-c", code])
    try:
        value = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, TypeError):
        raise AcceptanceError(f"{product} bootstrap could not be read from its data volume") from None
    require(isinstance(value, dict), f"{product} bootstrap has an invalid shape")
    token_keys = {"work": ("manager_token", "runtime_token"), "knowledge": ("writer_token", "reader_token"), "code": ("manager_token", "writer_token", "reader_token")}[product]
    require(all(isinstance(value.get(key), str) and value[key] for key in token_keys), f"{product} bootstrap is incomplete")
    return value


def _read_gitea_config(project: str, prefix: list[str], environment: dict[str, str], override_port: int | None) -> dict:
    path = ROOT / ".data" / "container-secrets" / project / "gitea.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise AcceptanceError("Project Gitea secret file is missing or invalid") from None
    require(isinstance(config, dict), "Project Gitea secret file has an invalid shape")
    internal = urlsplit(str(config.get("url", "")))
    require(
        internal.scheme == "http" and internal.hostname == "gitea" and internal.port == 3000 and not internal.path and not internal.username and not internal.password,
        "Project Gitea URL must target the Compose gitea:3000 service",
    )
    require(isinstance(config.get("token"), str) and config["token"], "Project Gitea service token is missing")
    require(isinstance(config.get("webhook_secret"), str) and config["webhook_secret"], "Project Gitea webhook secret is missing")

    if override_port is None:
        output = _compose(prefix, environment, ["port", "gitea", "3000"]).stdout.strip().splitlines()
        require(bool(output), "Compose did not publish the Gitea HTTP port")
        binding = output[-1].strip()
        match = re.search(r":(\d+)$", binding)
        require(match is not None, "Compose returned an invalid Gitea port binding")
        port = _port(match.group(1), "Gitea")
        host = binding[: match.start()].strip("[]")
        require(host in {"127.0.0.1", "localhost", "::1"}, "Gitea acceptance writes are restricted to a loopback host binding")
    else:
        port = override_port
    return {
        "url": f"http://127.0.0.1:{port}",
        "token": config["token"],
        "webhook_secret": config["webhook_secret"],
        "internal_url": config["url"].rstrip("/"),
    }


def _request(method: str, url: str, *, token: str | None = None, body: dict | None = None, timeout: float = 12) -> httpx.Response:
    headers = {"Authorization": "Bearer " + token} if token else None
    try:
        with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False) as client:
            return client.request(method, url, headers=headers, json=body)
    except httpx.HTTPError:
        raise AcceptanceError(f"HTTP request failed: {method} {urlsplit(url).path}") from None


def _json(response: httpx.Response, label: str) -> dict:
    require(response.is_success, f"{label} returned HTTP {response.status_code}")
    try:
        value = response.json()
    except ValueError:
        raise AcceptanceError(f"{label} returned invalid JSON") from None
    require(isinstance(value, dict), f"{label} returned an invalid response")
    return value


def _product_url(web_base: str, product: str, suffix: str) -> str:
    return web_base.rstrip("/") + API_PREFIX[product] + suffix


def _health_and_local_sessions(
    *,
    development: bool,
    web_base: str,
    api_bases: dict[str, str],
    report: dict,
) -> None:
    health: dict[str, dict] = {}
    sessions: dict[str, str] = {}
    for product in PRODUCTS:
        health_url = api_bases[product].rstrip("/") + "/api/health" if development else _product_url(web_base, product, "/health")
        state = _json(_request("GET", health_url), product + " health")
        require(state.get("status") == "ok", product + " health is not ready")
        require(state.get("database") == "postgresql", product + " is not using PostgreSQL")
        expected_mode = "development" if development else "production"
        require(state.get("mode") == expected_mode, product + " is in the wrong mode")
        if state.get("product"):
            require(state["product"] == product, product + " health reported a different product")
        health[product] = {"status": state["status"], "product": product, "database": state["database"], "mode": state["mode"]}

        session_url = _product_url(web_base, product, "/auth/local-session")
        session_response = _request("POST", session_url, body={})
        require(session_response.status_code == 403, product + " configured Identity allowed a local-session bypass")
        sessions[product] = "identity_configured=403"

        if development:
            direct_response = _request("POST", api_bases[product].rstrip("/") + "/api/auth/local-session", body={})
            require(direct_response.status_code == 403, product + " direct non-proxy local-session was not forbidden")
            sessions[product] += ", direct=403"
    report["health"] = health
    report["local_sessions"] = sessions


def _running_services(prefix: list[str], environment: dict[str, str]) -> set[str]:
    output = _compose(prefix, environment, ["ps", "--services", "--filter", "status=running"]).stdout
    return {line.strip() for line in output.splitlines() if line.strip()}


def _runtime_acceptance_in_work_container(prefix: list[str], environment: dict[str, str]) -> dict:
    container_ids = _compose(prefix, environment, ["ps", "-q", "work-api"]).stdout.splitlines()
    require(bool(container_ids and container_ids[-1].strip()), "Work API container is not available for runtime acceptance")
    container_id = container_ids[-1].strip()
    _compose(
        prefix,
        environment,
        ["exec", "-T", "work-api", "python", "-c", "from pathlib import Path; Path('/tmp/ordivant-validation').mkdir(parents=True, exist_ok=True)"],
    )
    try:
        copied = subprocess.run(
            ["docker", "cp", str(ROOT / "scripts" / "integration.py"), container_id + ":/tmp/ordivant-validation/integration.py"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AcceptanceError("Could not copy the runtime acceptance helper into Work API") from None
    require(copied.returncode == 0, "Could not copy the runtime acceptance helper into Work API")

    code = (
        "import json,sys; from pathlib import Path; sys.path.insert(0, '/tmp/ordivant-validation'); "
        "from integration import runtime_acceptance; "
        "bootstrap=json.loads(Path('/data/bootstrap.json').read_text(encoding='utf-8')); "
        "result=runtime_acceptance('http://work-api:8000', 'http://runtime:8090', bootstrap); "
        "print(json.dumps(result, separators=(',', ':')))"
    )
    output = _compose(prefix, environment, ["exec", "-T", "work-api", "python", "-c", code], timeout=90).stdout.strip()
    try:
        result = json.loads(output)
    except (json.JSONDecodeError, TypeError):
        raise AcceptanceError("Pi runtime acceptance returned an invalid result") from None
    require(isinstance(result, dict) and result.get("dispatch") == "passed", "Pi runtime acceptance did not pass")
    return result


def _wait_ready(urls: dict[str, str], timeout: int = 90) -> dict[str, dict]:
    deadline = time.monotonic() + timeout
    last: dict[str, int | str] = {}
    while time.monotonic() < deadline:
        ready: dict[str, dict] = {}
        for product, url in urls.items():
            try:
                response = _request("GET", url, timeout=3)
                if response.is_success:
                    ready[product] = _json(response, product + " health")
                else:
                    last[product] = response.status_code
            except AcceptanceError:
                last[product] = "unavailable"
        if len(ready) == len(urls):
            return ready
        time.sleep(1)
    raise AcceptanceError("APIs did not become healthy after restart: " + ", ".join(sorted(last)))


def _verify_seed_persistence(bases: dict[str, str], bootstrap: dict[str, dict]) -> dict[str, str]:
    result: dict[str, str] = {}
    work = bootstrap["work"]
    work_response = _request("GET", bases["work"] + "/projects/" + work["project_id"], token=work["manager_token"])
    _json(work_response, "Work seeded project after restart")
    result["work"] = "seed project readable"

    knowledge = bootstrap["knowledge"]
    space_response = _request(
        "GET",
        bases["knowledge"] + "/spaces/" + knowledge["primary_scope_id"],
        token=knowledge["writer_token"],
    )
    _json(space_response, "Knowledge seeded space after restart")
    result["knowledge"] = "seed space readable"

    code = bootstrap["code"]
    projects_response = _request("GET", bases["code"] + "/projects", token=code["writer_token"])
    require(projects_response.is_success, "Code seeded projects could not be read after restart")
    try:
        projects = projects_response.json()
    except ValueError:
        raise AcceptanceError("Code seeded projects returned invalid JSON") from None
    require(isinstance(projects, list) and bool(projects), "Code seed project was not persisted")
    result["code"] = "seed project readable"
    return result


def _work_without_peers(
    *,
    prefix: list[str],
    environment: dict[str, str],
    gitea: dict,
    bootstrap: dict[str, dict],
    suite_result: dict,
) -> dict:
    from integration import Api
    from suite_integration import work_vcs_mcp
    import asyncio

    work = bootstrap["work"]
    report_code = suite_result["code"]
    repository = report_code["repository"]
    number = report_code["pr_number"]
    vcs_config = {
        "projects": {
            work["project_id"]: {
                "gitea": {
                    "api_url": gitea["internal_url"] + "/api/v1",
                    "token": gitea["token"],
                    "repositories": [repository],
                }
            }
        }
    }
    writer = "import pathlib,sys; p=pathlib.Path('/data/vcs.json'); p.write_text(sys.stdin.read(), encoding='utf-8'); p.chmod(0o600)"
    _compose(
        prefix,
        environment,
        ["exec", "-T", "work-api", "python", "-c", writer],
        stdin=json.dumps(vcs_config, separators=(",", ":")),
    )

    _compose(prefix, environment, ["stop", "knowledge-api", "code-api"])
    builder_data = work["agents"]["builder"]
    reviewer_data = work["agents"]["reviewer"]
    work_base = environment["ORDIVANT_API_URL"]
    builder = Api(work_base, builder_data["token"])
    reviewer = Api(work_base, reviewer_data["token"])
    project_id = work["project_id"]
    vcs = builder.ok(
        "GET",
        f"/api/projects/{project_id}/vcs/pulls/gitea/{number}?repository={httpx.QueryParams({'repository': repository})['repository']}",
    )
    require(vcs.get("source") == "provider_api", "Work did not read the VCS provider directly")
    require(vcs.get("checks_available") and any(check.get("state") == "success" for check in vcs.get("checks", [])), "Work did not read the successful Gitea status")
    mcp_result = asyncio.run(work_vcs_mcp(environment, builder_data["token"], project_id, repository, number))

    manager = Api(work_base, work["manager_token"])
    task = manager.ok(
        "POST",
        "/api/tasks",
        {
            "project_id": project_id,
            "title": "Container acceptance: existing VCS while peers are stopped",
            "goal": "Prove Work can inspect and review a scoped existing Gitea reference independently",
            "inputs": vcs["web_url"],
            "acceptance_criteria": ["Direct VCS pull request and status are readable with Knowledge and Code stopped"],
            "reviewer_id": reviewer_data["id"],
        },
    )
    claim = builder.ok("POST", f"/api/tasks/{task['id']}/claim", {})
    builder.ok(
        "POST",
        f"/api/tasks/{task['id']}/submit",
        {
            "execution_id": claim["execution"]["id"],
            "lease_token": claim["lease_token"],
            "summary": "Read the existing Gitea PR and status using Work's project-scoped VCS configuration",
            "artifacts": [{"kind": "url", "title": "Existing Gitea PR", "uri": vcs["web_url"]}],
        },
    )
    accepted = reviewer.ok(
        "POST",
        f"/api/tasks/{task['id']}/review",
        {"decision": "accept", "comment": "Independent reviewer verified Work operation while optional peers were stopped"},
    )
    require(accepted["task"]["status"] == "done", "Work task did not complete while peers were stopped")
    return {"status": "passed", "rest_api": "passed", "mcp": mcp_result, "task_id": task["id"]}


def _redact(value, secrets: list[str]):
    if isinstance(value, dict):
        return {key: _redact(item, secrets) for key, item in value.items() if "token" not in str(key).lower() and "secret" not in str(key).lower()}
    if isinstance(value, list):
        return [_redact(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
    return value


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-name", required=True, help="Existing Compose project started by scripts/containers.ps1")
    parser.add_argument("--development", action="store_true", help="Validate the development proxy and published API ports")
    parser.add_argument("--full-flow", action="store_true", help="Run the complete Suite, peer-stop and Pi runtime acceptance against production")
    parser.add_argument("--web-port", type=int, help="Override the helper's web host port")
    parser.add_argument("--work-port", type=int, help="Override the development Work API host port")
    parser.add_argument("--knowledge-port", type=int, help="Override the development Knowledge API host port")
    parser.add_argument("--code-port", type=int, help="Override the development Code API host port")
    parser.add_argument("--runtime-port", type=int, help="Override the development Pi runtime host port")
    parser.add_argument("--gitea-port", type=int, help="Override the Gitea loopback host port")
    return parser


def main() -> int:
    args = _argument_parser().parse_args()
    if args.development and args.full_flow:
        _argument_parser().error("--full-flow selects production; the development mode already runs the full flow")
    project = args.project_name.strip().lower()
    require(bool(PROJECT_PATTERN.fullmatch(project)), "Project name must contain lowercase letters, digits, underscores or hyphens")
    defaults = {
        "web_port": "ORDIVANT_DEV_WEB_PORT" if args.development else "ORDIVANT_WEB_PORT",
        "work_port": "ORDIVANT_WORK_PORT",
        "knowledge_port": "ORDIVANT_KNOWLEDGE_PORT",
        "code_port": "ORDIVANT_CODE_PORT",
        "runtime_port": "ORDIVANT_RUNTIME_PORT",
    }
    fallback = {"web_port": 5173 if args.development else 8088, "work_port": 8000, "knowledge_port": 8010, "code_port": 8020, "runtime_port": 8090}
    for field, env_name in defaults.items():
        value = getattr(args, field)
        setattr(args, field, _port(value or os.getenv(env_name) or fallback[field], field.replace("_", " ")))
    if args.gitea_port is not None:
        args.gitea_port = _port(args.gitea_port, "Gitea")

    report_dir = ROOT / ".data" / "validation" / (f"containers-{project}-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    report_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"status": "failed", "project_name": project, "mode": "development" if args.development else "production", "report_directory": str(report_dir)}
    environment = _base_environment(project, args.development, args)
    prefix = _compose_prefix(project, args.development)
    secrets: list[str] = []
    peers_need_restore = False
    result_code = 1

    try:
        web_base = f"http://127.0.0.1:{args.web_port}"
        web_response = _request("GET", web_base + "/")
        require(web_response.is_success, "Web frontend is not reachable")
        if args.development:
            api_bases = {
                "work": f"http://127.0.0.1:{args.work_port}",
                "knowledge": f"http://127.0.0.1:{args.knowledge_port}",
                "code": f"http://127.0.0.1:{args.code_port}",
            }
        else:
            api_bases = {product: web_base + API_PREFIX[product] for product in PRODUCTS}
        report["origins"] = {"web": web_base, **{product: base for product, base in api_bases.items()}}

        bootstrap = {product: _capture_bootstrap(prefix, environment, product) for product in PRODUCTS}
        for product, value in bootstrap.items():
            for key, secret in value.items():
                if "token" in key.lower() and isinstance(secret, str):
                    secrets.append(secret)
                if key == "agents" and isinstance(secret, dict):
                    secrets.extend(agent["token"] for agent in secret.values() if isinstance(agent, dict) and isinstance(agent.get("token"), str))
        _health_and_local_sessions(development=args.development, web_base=web_base, api_bases=api_bases, report=report)

        if args.development or args.full_flow:
            gitea = _read_gitea_config(project, prefix, environment, args.gitea_port)
            secrets.extend([gitea["token"], gitea["webhook_secret"]])
            from suite_integration import exercise

            flow_bases = api_bases if args.development else {
                "work": web_base,
                "knowledge": web_base + API_PREFIX["knowledge"],
                "code": web_base + API_PREFIX["code"],
            }
            environment.update(
                {
                    "ORDIVANT_MODE": "development" if args.development else "production",
                    "ORDIVANT_API_URL": flow_bases["work"],
                    "ORDIVANT_KNOWLEDGE_API_URL": flow_bases["knowledge"],
                    "ORDIVANT_CODE_API_URL": flow_bases["code"],
                    "PYTHONUTF8": "1",
                }
            )
            suite_dir = report_dir / "suite"
            suite_dir.mkdir()
            report["suite"] = exercise(flow_bases, bootstrap, environment, suite_dir, gitea)

            runtime_running = "runtime" in _running_services(prefix, environment)
            if runtime_running and args.development:
                runtime_base = f"http://127.0.0.1:{args.runtime_port}"
                _json(_request("GET", runtime_base + "/health"), "Pi runtime health")
                from integration import runtime_acceptance

                report["runtime"] = runtime_acceptance(flow_bases["work"], runtime_base, bootstrap["work"])
            elif runtime_running:
                report["runtime"] = _runtime_acceptance_in_work_container(prefix, environment)
            elif args.full_flow:
                require(False, "Production full-flow requires the Pi runtime service to be running")
            else:
                report["runtime"] = {"status": "skipped", "reason": "Compose runtime profile is not running"}

            peers_need_restore = True
            report["work_without_peers"] = _work_without_peers(
                prefix=prefix,
                environment=environment,
                gitea=gitea,
                bootstrap=bootstrap,
                suite_result=report["suite"],
            )
            _compose(prefix, environment, ["start", "knowledge-api", "code-api"])
            peers_need_restore = False

            _compose(prefix, environment, ["restart", "--timeout", "30", "work-api", "knowledge-api", "code-api"], timeout=180)
            health_urls = (
                {product: base + "/api/health" for product, base in api_bases.items()}
                if args.development
                else {product: _product_url(web_base, product, "/health") for product in PRODUCTS}
            )
            restarted_health = _wait_ready(health_urls)
            report["api_restart"] = {name: "ready" for name in restarted_health}
            suite_result = report["suite"]
            work_check = _request("GET", flow_bases["work"] + "/api/tasks/" + suite_result["work"]["task_id"], token=bootstrap["work"]["manager_token"])
            require(_json(work_check, "Work task after restart").get("status") == "done", "Work task did not survive API restart")
            knowledge_check = _json(_request("GET", flow_bases["knowledge"] + "/api/documents/" + suite_result["knowledge"]["document_id"], token=bootstrap["knowledge"]["reader_token"]), "Knowledge document after restart")
            require(knowledge_check.get("document", {}).get("current_version", 0) >= 3, "Knowledge versions did not survive API restart")
            code_check = _request(
                "GET",
                flow_bases["code"] + f"/api/repositories/{suite_result['code']['repository_id']}/pulls/{suite_result['code']['pr_number']}",
                token=bootstrap["code"]["reader_token"],
            )
            _json(code_check, "Code PR binding after restart")
            report["flow_persistence"] = {"work_task": "done", "knowledge_versions": "persisted", "code_pr_binding": "persisted"}
            if args.full_flow:
                report["seed_persistence"] = _verify_seed_persistence(api_bases, bootstrap)
        else:
            _compose(prefix, environment, ["restart", "--timeout", "30", "work-api", "knowledge-api", "code-api"], timeout=180)
            report["api_restart"] = {name: "ready" for name in _wait_ready({product: _product_url(web_base, product, "/health") for product in PRODUCTS})}
            report["seed_persistence"] = _verify_seed_persistence(api_bases, bootstrap)
            report["runtime"] = {"status": "not_run", "reason": "Production runtime HTTP port is not published by default"}

        report["status"] = "passed"
        result_code = 0
    except Exception as error:
        report["error"] = str(error)
    finally:
        if peers_need_restore:
            try:
                _compose(prefix, environment, ["start", "knowledge-api", "code-api"])
                if args.development:
                    _wait_ready({product: api_bases[product] + "/api/health" for product in ("knowledge", "code")})
                else:
                    _wait_ready({product: _product_url(web_base, product, "/health") for product in ("knowledge", "code")})
                report["peer_restore"] = "passed"
            except Exception:
                report["peer_restore"] = "failed"
                report["status"] = "failed"
                report["error"] = "Knowledge and Code peers could not be restored"
        safe_report = _redact(report, secrets)
        try:
            (report_dir / "report.json").write_text(json.dumps(safe_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except OSError:
            safe_report["report_write"] = "failed"
        print(json.dumps(safe_report, ensure_ascii=False, indent=2), file=sys.stdout if safe_report.get("status") == "passed" else sys.stderr)
        if safe_report.get("status") != "passed":
            result_code = 1
    return result_code


if __name__ == "__main__":
    raise SystemExit(main())

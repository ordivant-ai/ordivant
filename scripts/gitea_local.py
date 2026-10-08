"""Start/stop an owned, loopback-only Gitea open-source development instance."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

import httpx

ROOT = Path(__file__).resolve().parents[1]
IMAGE = "docker.gitea.com/gitea:28.0.0"
OWNER = hashlib.sha256(str(ROOT.resolve()).encode("utf-8")).hexdigest()[:20]
NAME = "ordivant-gitea-" + OWNER[:10]
LABEL = "com.ordivant.workspace"
DATA = ROOT / ".data" / "gitea"
CONFIG = DATA / "connection.json"
SCOPES = ["write:repository", "write:user"]


def run(*arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(["docker", *arguments], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if check and result.returncode != 0:
        # Do not surface bootstrap command output, which can contain generated credentials.
        raise RuntimeError(f"Docker operation failed (exit {result.returncode}): {arguments[0]}")
    return result


def inspect_owned() -> dict | None:
    result = run("inspect", NAME, check=False)
    if result.returncode:
        return None
    container = json.loads(result.stdout)[0]
    if container.get("Config", {}).get("Labels", {}).get(LABEL) != OWNER:
        raise RuntimeError("Container name belongs to another workspace; refusing to manage it")
    return container


def cli(*arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    return run("exec", "--user", "git", NAME, "gitea", "--config", "/data/gitea/conf/app.ini", *arguments, check=check)


def ready(url: str) -> None:
    deadline = time.monotonic() + 45
    with httpx.Client(timeout=2, trust_env=False) as client:
        while time.monotonic() < deadline:
            try:
                response = client.get(url + "/api/healthz")
                if response.is_success and response.json().get("status") == "pass":
                    return
            except (httpx.HTTPError, ValueError):
                pass
            time.sleep(0.4)
    raise RuntimeError("Local Gitea did not become ready within 45 seconds; inspect its Docker logs")


def start(port: int) -> dict:
    DATA.mkdir(parents=True, exist_ok=True)
    container = inspect_owned()
    if container:
        bindings = container["HostConfig"]["PortBindings"]["3000/tcp"]
        port = int(bindings[0]["HostPort"])
        if not container["State"]["Running"]:
            run("start", NAME)
    else:
        (DATA / "data").mkdir(exist_ok=True)
        arguments = ["run", "--detach", "--name", NAME, "--label", f"{LABEL}={OWNER}", "--publish", f"127.0.0.1:{port}:3000", "--volume", f"{DATA / 'data'}:/data"]
        settings = {
            "GITEA__security__INSTALL_LOCK": "true",
            "GITEA__database__DB_TYPE": "sqlite3",
            "GITEA__database__PATH": "/data/gitea/gitea.db",
            "GITEA__server__DOMAIN": "127.0.0.1",
            "GITEA__server__ROOT_URL": f"http://127.0.0.1:{port}/",
            "GITEA__server__HTTP_PORT": "3000",
            "GITEA__server__DISABLE_SSH": "true",
            "GITEA__service__DISABLE_REGISTRATION": "true",
            "GITEA__service__REQUIRE_SIGNIN_VIEW": "true",
            "GITEA__mailer__ENABLED": "false",
            "GITEA__actions__ENABLED": "false",
        }
        for key, value in settings.items():
            arguments.extend(["--env", f"{key}={value}"])
        arguments.append(IMAGE)
        run(*arguments)
    url = f"http://127.0.0.1:{port}"
    ready(url)
    version_output = cli("--version").stdout
    version_match = re.search(r"Gitea version ([^\s]+)", version_output, re.IGNORECASE)
    if not version_match:
        raise RuntimeError("Could not identify the running Gitea version")
    version = version_match[1]
    if CONFIG.exists():
        connection = json.loads(CONFIG.read_text(encoding="utf-8"))
        if connection.get("url") == url and connection.get("scopes") == SCOPES:
            with httpx.Client(timeout=5, trust_env=False) as client:
                response = client.get(url + "/api/v1/user", headers={"Authorization": "token " + connection["token"]})
                if response.is_success:
                    return {"status": "ready", "url": url, "version": version, "config_path": str(CONFIG), "container": NAME}

    listed = cli("admin", "user", "list").stdout
    if not re.search(r"\bordivant-local\b", listed):
        # Gitea generates its own password; capture/discard output and never expose or store it.
        cli("admin", "user", "create", "--username", "ordivant-local", "--email", "ordivant-local@example.invalid", "--admin", "--random-password", "--random-password-length", "40", "--must-change-password=false")
    token_result = cli("admin", "user", "generate-access-token", "--username", "ordivant-local", "--token-name", "ordivant-code-" + secrets.token_hex(4), "--scopes", ",".join(SCOPES), "--raw")
    token_lines = [line.strip() for line in token_result.stdout.splitlines() if re.fullmatch(r"[a-fA-F0-9]{40,128}", line.strip())]
    if len(token_lines) != 1:
        raise RuntimeError("Could not parse generated Gitea service token; no credential output was logged")
    connection = {"url": url, "token": token_lines[0], "webhook_secret": secrets.token_hex(32), "scopes": SCOPES}
    CONFIG.write_text(json.dumps(connection, indent=2), encoding="utf-8")
    if os.name != "nt":
        CONFIG.chmod(0o600)
    with httpx.Client(timeout=5, trust_env=False) as client:
        response = client.get(url + "/api/v1/user", headers={"Authorization": "token " + connection["token"]})
        if not response.is_success:
            raise RuntimeError("Generated scoped Gitea credential failed verification")
    return {"status": "ready", "url": url, "version": version, "config_path": str(CONFIG), "container": NAME}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "status"], nargs="?", default="start")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        raise RuntimeError("Port must be between 1 and 65535")
    if args.action == "start":
        print(json.dumps(start(args.port), ensure_ascii=False, indent=2))
    else:
        container = inspect_owned()
        if args.action == "stop" and container and container["State"]["Running"]:
            run("stop", "--time", "5", NAME)
        print(json.dumps({"container": NAME, "status": "absent" if not container else ("stopped" if args.action == "stop" else container["State"]["Status"]), "data_directory": str(DATA)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

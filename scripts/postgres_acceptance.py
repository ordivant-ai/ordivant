"""Validate against a disposable local PostgreSQL 17 container and remove only it."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]


def docker(*args: str, env=None) -> subprocess.CompletedProcess:
    result = subprocess.run(["docker", *args], cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip()[-1600:])
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", action="store_true", help="Also validate separate Work/Knowledge/Code databases and real local Gitea")
    args = parser.parse_args()
    name = "ordivant-acceptance-" + uuid.uuid4().hex[:12]
    owner = uuid.uuid4().hex
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    password = secrets.token_hex(24)
    environment = dict(os.environ, POSTGRES_PASSWORD=password)
    created = False
    try:
        docker("info", "--format", "{{.ServerVersion}}")
        print("Starting disposable local PostgreSQL 17 acceptance database...", flush=True)
        docker("run", "--detach", "--rm", "--name", name, "--label", "com.ordivant.acceptance=" + owner, "--publish", f"127.0.0.1:{port}:5432", "--env", "POSTGRES_USER=ordivant", "--env", "POSTGRES_DB=ordivant", "--env", "POSTGRES_PASSWORD", "--tmpfs", "/var/lib/postgresql/data:rw", "postgres:17-alpine", env=environment)
        created = True
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            probe = subprocess.run(["docker", "exec", name, "pg_isready", "-U", "ordivant", "-d", "ordivant"], capture_output=True)
            if probe.returncode == 0:
                break
            time.sleep(0.4)
        else:
            raise RuntimeError("PostgreSQL did not become ready within 40 seconds")
        environment["ORDIVANT_DATABASE_URL"] = f"postgresql+psycopg://ordivant:{password}@127.0.0.1:{port}/ordivant"
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "integration.py")], cwd=ROOT, env=environment)
        if result.returncode == 0 and args.suite:
            for product in ("knowledge", "code"):
                docker("exec", name, "createdb", "-U", "ordivant", "ordivant_" + product)
                environment["ORDIVANT_" + product.upper() + "_DATABASE_URL"] = f"postgresql+psycopg://ordivant:{password}@127.0.0.1:{port}/ordivant_{product}"
            result = subprocess.run([sys.executable, str(ROOT / "scripts" / "suite_integration.py")], cwd=ROOT, env=environment)
        return result.returncode
    finally:
        if created:
            # Match the exact container's unique ownership label before stopping anything.
            inspected = subprocess.run(["docker", "inspect", name], capture_output=True, text=True, encoding="utf-8")
            if inspected.returncode == 0:
                entries = json.loads(inspected.stdout)
                if len(entries) == 1 and entries[0]["Config"]["Labels"].get("com.ordivant.acceptance") == owner:
                    docker("stop", "--time", "5", name)
                    print("Removed the acceptance container; no application data volume was mounted.", flush=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

"""Read-only preservation/readiness checks for the two existing local environments.

Database snapshots contain counts and database-computed configuration hashes only.
They never return account details, authentication material or provider credentials.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / ".data/validation"
TARGETS = {"development": (os.environ.get("ORDIVANT_CHECK_DEV_PROJECT", "ordivant-dev"), 5173), "production": (os.environ.get("ORDIVANT_CHECK_PROD_PROJECT", "ordivant-local"), 8088)}


def docker(*args: str) -> str:
    result = subprocess.run(["docker", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    if result.returncode:
        raise RuntimeError("local_docker_check_failed")
    return result.stdout.strip()


def sql(owner: str, service: str, query: str) -> str:
    name = owner + "-" + service + "-1"
    actual = docker("inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', name)
    if actual != owner:
        raise RuntimeError("local_container_ownership_mismatch")
    return docker("exec", name, "psql", "-X", "-U", "ordivant", "-d", "ordivant", "-At", "-c", query)


def configuration_digest(owner: str, service: str, table: str) -> str:
    # Only names hardcoded below are passed; PostgreSQL computes the digest.
    return sql(owner, service, f"SELECT md5(COALESCE(string_agg(row_to_json(s)::text, '' ORDER BY row_to_json(s)::text), '')) FROM {table} s")


def snapshot(owner: str) -> dict:
    return {
        "identity_user_count": int(sql(owner, "identity-db", "SELECT count(*) FROM identity_users")),
        "identity_setup_marker_count": int(sql(owner, "identity-db", "SELECT count(*) FROM identity_setup_marker")),
        "sso_configuration_digest": configuration_digest(owner, "identity-db", "identity_sso_configuration"),
        "model_configuration_digest": configuration_digest(owner, "work-db", "organization_model_settings"),
        "encrypted_provider_digest": configuration_digest(owner, "work-db", "model_provider_settings"),
        "project_count": int(sql(owner, "work-db", "SELECT count(*) FROM projects")),
    }


def get(port: int, path: str):
    request = urllib.request.Request(f"http://127.0.0.1:{port}" + path)
    with urllib.request.urlopen(request, timeout=15) as response:
        content = response.read()
        return response.status, json.loads(content) if response.headers.get("content-type", "").startswith("application/json") else content


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("before", "after"))
    args = parser.parse_args()
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    report = {"status": "failed", "stage": args.stage, "targets": {}, "checks": {}}
    try:
        previous = json.loads((DIRECTORY / "execution-local-before.json").read_text(encoding="utf-8")) if args.stage == "after" else None
        for mode, (owner, port) in TARGETS.items():
            values = snapshot(owner)
            report["targets"][mode] = {"owner": owner, "port": port, "snapshot": values}
            if previous:
                for field, value in values.items():
                    name = mode + "_preserved_" + field
                    report["checks"][name] = value == previous["targets"][mode]["snapshot"][field]
                    assert report["checks"][name], name
                for path in ("/api/health", "/knowledge-api/health", "/code-api/health", "/auth-api/status", "/work", "/knowledge", "/code"):
                    status, value = get(port, path)
                    name = mode + "_ready_" + path
                    report["checks"][name] = status == 200
                    assert report["checks"][name], name
                    if path == "/auth-api/status":
                        report["targets"][mode]["setup_required"] = value["setup_required"]
                for service in ("identity-api", "work-api", "knowledge-api", "code-api", "web", "runtime", "sandbox-api"):
                    health = docker("inspect", "--format", "{{.State.Health.Status}}", owner + "-" + service + "-1")
                    name = mode + "_healthy_" + service
                    report["checks"][name] = health == "healthy"
                    assert report["checks"][name], name
        report["status"] = "passed"
    except Exception as error:
        report["error_type"] = type(error).__name__
    path = DIRECTORY / ("execution-local-" + args.stage + ".json")
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f'EXECUTION_LOCAL_{args.stage.upper()}_{report["status"].upper()} {len(report["checks"])} checks')
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

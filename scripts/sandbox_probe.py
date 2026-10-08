"""Actual isolation probe, executed inside the owned QA executor on stdin.

Only synthetic UUID workspaces are created. No capability/service token is printed.
The host driver verifies the Compose owner before running this file.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import uuid
import urllib.error
import urllib.request

OWNER = "ordivant-execution-qa"
CHECKS: dict[str, bool] = {}
if os.environ.get("ORDIVANT_SANDBOX_OWNER") != OWNER:
    raise RuntimeError("Probe is restricted to the isolated execution QA owner")
SERVICE_TOKEN = Path(os.environ["ORDIVANT_SANDBOX_TOKEN_FILE"]).read_text().strip()
LIMITS = {
    "timeout_seconds": 5,
    "memory_mb": 128,
    "cpu_count": 0.5,
    "pids_limit": 32,
    "output_bytes": 4096,
    "workspace_mb": 8,
}
CAPABILITIES: dict[str, str] = {}


def call(method: str, path: str, body=None, token: str | None = None):
    headers = {"Content-Type": "application/json", "Authorization": "Bearer " + (token or SERVICE_TOKEN)}
    request = urllib.request.Request(
        "http://127.0.0.1:8040" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def check(name: str, passed: bool):
    CHECKS[name] = bool(passed)
    if not passed:
        raise AssertionError(name)


def operation(run: str, suffix: str, body: dict):
    status, result = call("POST", f"/sandboxes/{run}/{suffix}", body, CAPABILITIES[run])
    check("operation_" + suffix.replace("/", "_") + "_" + str(len(CHECKS)), status == 200)
    return result


def main():
    report: dict = {"status": "failed", "owner": OWNER, "checks": CHECKS, "run_ids": []}
    try:
        for _ in range(2):
            run = str(uuid.uuid4())
            status, result = call("POST", "/sandboxes", {"run_id": run, "profile": {"limits": LIMITS}})
            check("actual_job_created_" + str(len(CAPABILITIES)), status in {200, 201} and result["status"] == "ready")
            CAPABILITIES[run] = result["token"]
            report["run_ids"].append(run)
        first, second = CAPABILITIES
        operation(first, "files/write", {"path": "tests/check.py", "content": "assert 2 + 3 == 5\nprint('ACTUAL_TEST_PASS')\n"})
        content = operation(first, "files/read", {"path": "tests/check.py"})
        check("written_file_read_back", "ACTUAL_TEST_PASS" in content["content"])
        listing = operation(first, "files/list", {"path": "."})
        check("actual_workspace_listing", any(row["path"] == "tests" and row["type"] == "directory" for row in listing["files"]))
        libraries = operation(first, "execute", {"command": ["python3", "-c", "import sqlite3,ssl,bz2,lzma,ctypes; print('PYTHON_STDLIB_OK')"]})
        check("python_standard_libraries_available", libraries["exit_code"] == 0 and "PYTHON_STDLIB_OK" in libraries["stdout"])
        node = operation(first, "execute", {"command": ["node", "--version"]})
        git = operation(first, "execute", {"command": ["git", "--version"]})
        check("node_and_git_tools_available", node["exit_code"] == git["exit_code"] == 0 and node["stdout"].strip().startswith("v24.") and "git version" in git["stdout"])
        success = operation(first, "execute", {"command": ["python3", "tests/check.py"]})
        check("actual_test_command_passed", success["exit_code"] == 0 and "ACTUAL_TEST_PASS" in success["stdout"])
        failed = operation(first, "execute", {"command": ["python3", "-c", "raise SystemExit(7)"]})
        check("failing_command_not_relabelled_pass", failed["exit_code"] == 7)
        identity = operation(first, "execute", {"command": ["id", "-u"]})
        check("job_non_root", identity["exit_code"] == 0 and identity["stdout"].strip() == "10001")
        network = operation(first, "execute", {"command": ["python3", "-c", "import socket; s=socket.socket(); s.settimeout(1); assert s.connect_ex(('1.1.1.1',443)) != 0; print('NETWORK_DENIED')"]})
        check("job_network_denied", network["exit_code"] == 0 and "NETWORK_DENIED" in network["stdout"])
        read_only = operation(first, "execute", {"command": ["python3", "-c", "import pathlib; pathlib.Path('/usr/ordivant-write-probe').write_text('denied')"]})
        check("job_root_filesystem_read_only", read_only["exit_code"] != 0)
        status, _ = call("POST", f"/sandboxes/{second}/files/read", {"path": "tests/check.py"}, CAPABILITIES[second])
        check("cross_run_workspace_not_shared", status in {400, 404, 409, 422})
        status, _ = call("POST", f"/sandboxes/{second}/files/list", {"path": "."}, CAPABILITIES[first])
        check("cross_run_capability_rejected", status in {401, 403})
        for path in ("../etc/passwd", "/etc/passwd", "tests/../../escape", "..\\escape"):
            status, _ = call("POST", f"/sandboxes/{first}/files/read", {"path": path}, CAPABILITIES[first])
            check("path_escape_rejected_" + str(len(CHECKS)), status in {400, 403, 404, 422})
        operation(first, "execute", {"command": ["ln", "-s", "/etc/passwd", "escape"]})
        status, _ = call("POST", f"/sandboxes/{first}/files/read", {"path": "escape"}, CAPABILITIES[first])
        check("symlink_escape_rejected", status in {400, 403, 404, 422})
        operation(first, "execute", {"command": ["mkfifo", "blocked-file"]})
        status, _ = call("POST", f"/sandboxes/{first}/files/read", {"path": "blocked-file"}, CAPABILITIES[first])
        check("fifo_read_rejected_without_hanging", status in {400, 403, 404, 422})
        output = operation(first, "execute", {"command": ["python3", "-c", "print('X' * 100000)"]})
        check("output_bounded_and_marked", output.get("truncated") is True and len(output["stdout"].encode()) <= LIMITS["output_bytes"])
        operation(first, "execute", {"command": ["python3", "-c", "import pathlib; p=pathlib.Path('many'); p.mkdir(); [(p/('x'*100+str(i))).touch() for i in range(80)]"]})
        listing = operation(first, "files/list", {"path": "many"})
        check("file_listing_bounded_and_marked", listing.get("truncated") is True and len(json.dumps(listing["files"], separators=(",", ":")).encode()) <= LIMITS["output_bytes"])
        status, _ = call("POST", "/sandboxes", {"run_id": str(uuid.uuid4()), "profile": {"limits": LIMITS}, "image": "arbitrary", "mounts": ["/:/host"]})
        check("caller_docker_policy_fields_rejected", status == 422)

        import docker

        daemon = docker.from_env()
        jobs = daemon.containers.list(all=True, filters={"label": f"ordivant.sandbox.owner={OWNER}"})
        probe_jobs = [job for job in jobs if job.labels.get("ordivant.sandbox.run_id") in CAPABILITIES]
        check("actual_docker_jobs_owned", len(probe_jobs) == 2)
        for job in probe_jobs:
            config = job.attrs["HostConfig"]
            checks = {
                "network_none": config["NetworkMode"] == "none",
                "root_read_only": config["ReadonlyRootfs"] is True,
                "caps_dropped": "ALL" in config["CapDrop"],
                "no_new_privileges": "no-new-privileges" in " ".join(config["SecurityOpt"]),
                "non_root_user": job.attrs["Config"]["User"] == "10001:10001",
                "memory_limit": config["Memory"] == LIMITS["memory_mb"] * 1024 * 1024,
                "swap_not_exceeding_memory_limit": config["MemorySwap"] == config["Memory"],
                "cpu_limit": config.get("NanoCpus") == int(LIMITS["cpu_count"] * 1_000_000_000),
                "pids_limit": config["PidsLimit"] == LIMITS["pids_limit"],
                "workspace_tmpfs": "/workspace" in config["Tmpfs"] and any(size in config["Tmpfs"]["/workspace"].lower() for size in ("size=8m", "size=8388608")),
                "no_host_bind_or_volume_mount": not config.get("Binds") and all(mount.get("Type") == "tmpfs" for mount in config.get("Mounts", [])) and all(mount.get("Type") == "tmpfs" for mount in job.attrs.get("Mounts", [])),
                "no_credentials_in_job_env": SERVICE_TOKEN not in " ".join(job.attrs["Config"]["Env"]) and not any(entry.split("=", 1)[0] in {"OPENAI_API_KEY", "ORDIVANT_RUNTIME_TOKEN", "ORDIVANT_SANDBOX_TOKEN", "TOOL_AUTH_TOKEN", "DATABASE_URL", "AUTHORIZATION"} for entry in job.attrs["Config"]["Env"]),
            }
            for name, passed in checks.items():
                check("docker_" + name + "_" + str(len(CHECKS)), passed)
        timeout = operation(first, "execute", {"command": ["python3", "-c", "import time; time.sleep(20)"], "timeout_seconds": 1})
        check("command_timeout_visible", timeout["exit_code"] != 0 and timeout.get("timed_out") is True)
        report["status"] = "passed"
    except Exception as error:
        report["error_type"] = type(error).__name__
        report["failed_check"] = next((name for name, passed in CHECKS.items() if not passed), "operation_failed")
    finally:
        for run, token in CAPABILITIES.items():
            status, _ = call("DELETE", f"/sandboxes/{run}", token=token)
            CHECKS["job_cleanup_" + run[:8]] = status in {200, 204, 404, 410}
        if not all(CHECKS.values()):
            report["status"] = "failed"
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()

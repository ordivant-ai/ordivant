#!/usr/bin/env python3
"""Verify source bind mounts and live reloads in the Ordivant dev Compose project."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROJECT = "ordivant-dev"
REPORT_DIR = ROOT / ".data" / "validation"
DOCKER_TIMEOUT = 8
RELOAD_TIMEOUT = 40
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class AcceptanceFailure(RuntimeError):
    pass


PYTHON_PROCESS_SNAPSHOT = r'''
import glob, json, os
processes = []
for entry in glob.glob("/proc/[0-9]*"):
    try:
        pid = int(entry.rsplit("/", 1)[1])
        raw = open(entry + "/cmdline", "rb").read()
        command = raw.replace(b"\0", b" ").decode("utf-8", "replace").strip()
        status = open(entry + "/status", encoding="utf-8").read()
        parent = next(int(line.split()[1]) for line in status.splitlines() if line.startswith("PPid:"))
        if command:
            processes.append({"pid": pid, "ppid": parent, "cmd": command})
    except (OSError, ValueError, StopIteration):
        continue
supervisors = [item for item in processes if "uvicorn" in item["cmd"] and "--reload" in item["cmd"]]
supervisor_ids = {item["pid"] for item in supervisors}
workers = [item["pid"] for item in processes
           if item["ppid"] in supervisor_ids and
           ("spawn_main" in item["cmd"] or "multiprocessing-fork" in item["cmd"])]
if not workers:
    workers = [item["pid"] for item in processes
               if item["ppid"] in supervisor_ids and "python" in item["cmd"]]
print(json.dumps({"supervisor_pids": sorted(supervisor_ids), "worker_pids": sorted(workers)}))
'''

NODE_PROCESS_SNAPSHOT = r'''
const fs = require("node:fs");
const watchProcesses = [];
const serverProcesses = [];
for (const entry of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const args = fs.readFileSync(`/proc/${entry}/cmdline`).toString().split("\0").filter(Boolean);
    const name = fs.readFileSync(`/proc/${entry}/comm`, "utf8").trim();
    if (name !== "node" && !/(^|\/)node$/.test(args[0] || "")) continue;
    if (args.includes("-e") || args.includes("--eval")) continue;
    const hasServer = args.some((arg) => arg === "server.js" || arg.endsWith("/server.js"));
    if (!hasServer) continue;
    const status = fs.readFileSync(`/proc/${entry}/status`, "utf8");
    const ppid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] || 0);
    const process = { pid: Number(entry), ppid, watch: args.includes("--watch") };
    serverProcesses.push(process);
    if (process.watch) watchProcesses.push(process);
  } catch {}
}
const byPid = (a, b) => a.pid - b.pid;
watchProcesses.sort(byPid);
serverProcesses.sort(byPid);
console.log(JSON.stringify({
  watch_pids: watchProcesses.map((item) => item.pid),
  server_pids: serverProcesses.map((item) => item.pid),
  server_child_pids: serverProcesses.filter((item) => !item.watch).map((item) => item.pid),
  processes: serverProcesses,
}));
'''

NODE_FILE_STATE = r'''
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = process.argv[1];
const marker = Buffer.from(process.argv[2], "ascii");
let exists = false;
let markerPresent = false;
let digest = null;
try {
  const data = fs.readFileSync(path);
  exists = true;
  markerPresent = data.includes(marker);
  digest = crypto.createHash("sha256").update(data).digest("hex");
} catch {}
console.log(JSON.stringify({ exists, marker_present: markerPresent, sha256: digest }));
'''

FILE_STATE = r'''
import hashlib, json, pathlib, sys
path = pathlib.Path(sys.argv[1])
marker = sys.argv[2].encode("ascii")
try:
    data = path.read_bytes()
    present = marker in data
    digest = hashlib.sha256(data).hexdigest()
except OSError:
    present = False
    digest = None
print(json.dumps({"exists": path.is_file(), "marker_present": present, "sha256": digest}))
'''

PYTHON_SOURCES = [
    {
        "name": "work-api",
        "service": "work-api",
        "source": ROOT / "backend" / "src" / "ordivant" / "main.py",
        "source_suffix": "/backend/src",
        "container_source": "/app/src/ordivant/main.py",
        "container_file": "/app/src/ordivant/main.py",
        "kind": "python",
        "internal_port": "8000/tcp",
        "health_path": "/api/health",
    },
    {
        "name": "knowledge-api",
        "service": "knowledge-api",
        "source": ROOT / "products" / "knowledge" / "backend" / "src" / "ordivant_knowledge" / "main.py",
        "source_suffix": "/products/knowledge/backend/src",
        "container_source": "/app/src/ordivant_knowledge/main.py",
        "container_file": "/app/src/ordivant_knowledge/main.py",
        "kind": "python",
        "internal_port": "8010/tcp",
        "health_path": "/api/health",
    },
    {
        "name": "code-api",
        "service": "code-api",
        "source": ROOT / "products" / "code" / "backend" / "src" / "ordivant_code" / "main.py",
        "source_suffix": "/products/code/backend/src",
        "container_source": "/app/src/ordivant_code/main.py",
        "container_file": "/app/src/ordivant_code/main.py",
        "kind": "python",
        "internal_port": "8020/tcp",
        "health_path": "/api/health",
    },
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def docker(operation: str, *arguments: str, timeout: float = DOCKER_TIMEOUT) -> str:
    try:
        result = subprocess.run(
            ["docker", *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        raise AcceptanceFailure("docker_cli_missing") from None
    except subprocess.TimeoutExpired:
        raise AcceptanceFailure(operation + "_timeout") from None
    if result.returncode != 0:
        raise AcceptanceFailure(f"{operation}_failed_exit_{result.returncode}")
    return result.stdout


def container_id(project: str, service: str) -> str:
    output = docker(
        "find_" + service,
        "ps",
        "--filter",
        f"label=com.docker.compose.project={project}",
        "--filter",
        f"label=com.docker.compose.service={service}",
        "--format",
        "{{.ID}}",
    )
    ids = [line.strip() for line in output.splitlines() if line.strip()]
    if len(ids) != 1:
        raise AcceptanceFailure(f"{service}_container_count_{len(ids)}")
    return ids[0]


def inspect_source_mount(container: str, source_suffix: str) -> dict[str, Any]:
    output = docker("inspect_source_mount", "inspect", "--format", "{{json .Mounts}}", container)
    try:
        mounts = json.loads(output)
    except json.JSONDecodeError:
        raise AcceptanceFailure("mount_inspection_invalid") from None
    expected_suffix = source_suffix.replace("\\", "/").lower()
    for mount in mounts:
        source = str(mount.get("Source", "")).replace("\\", "/").rstrip("/").lower()
        if (
            mount.get("Type") == "bind"
            and mount.get("Destination") == "/app/src"
            and mount.get("RW") is False
            and source.endswith(expected_suffix)
        ):
            return {"destination": "/app/src", "read_only": True, "source_suffix": source_suffix}
    raise AcceptanceFailure("readonly_source_bind_mount_missing")


def host_port(container: str, internal_port: str, operation: str) -> int:
    output = docker(operation, "port", container, internal_port)
    for line in output.splitlines():
        match = re.search(r"(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)\s*$", line.strip())
        if match:
            return int(match.group(1))
    raise AcceptanceFailure(operation + "_not_loopback_published")


def request_status(url: str, timeout: float = 2.0) -> int | None:
    try:
        with HTTP.open(urllib.request.Request(url, headers={"Accept": "*/*"}), timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (OSError, urllib.error.URLError, TimeoutError):
        return None


def wait_health(url: str, timeout: float, operation: str) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = request_status(url)
        if status == 200:
            return status
        time.sleep(0.3)
    raise AcceptanceFailure(operation + "_health_timeout")


def exec_json(container: str, code: str, *arguments: str, operation: str) -> dict[str, Any]:
    output = docker(operation, "exec", container, "python", "-c", code, *arguments, timeout=6)
    try:
        value = json.loads(output.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        raise AcceptanceFailure(operation + "_invalid_result") from None
    if not isinstance(value, dict):
        raise AcceptanceFailure(operation + "_invalid_result")
    return value


def python_processes(container: str) -> dict[str, list[int]]:
    result = exec_json(container, PYTHON_PROCESS_SNAPSHOT, operation="inspect_uvicorn_processes")
    supervisors = result.get("supervisor_pids")
    workers = result.get("worker_pids")
    if not isinstance(supervisors, list) or not supervisors or not isinstance(workers, list) or not workers:
        raise AcceptanceFailure("uvicorn_reload_worker_not_found")
    return {"supervisor_pids": [int(pid) for pid in supervisors], "worker_pids": [int(pid) for pid in workers]}


def node_processes(container: str) -> dict[str, list[int]]:
    output = docker("inspect_node_watch_processes", "exec", container, "node", "-e", NODE_PROCESS_SNAPSHOT, timeout=6)
    try:
        result = json.loads(output.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        raise AcceptanceFailure("inspect_node_watch_processes_invalid_result") from None
    watchers = result.get("watch_pids")
    servers = result.get("server_pids")
    children = result.get("server_child_pids")
    processes = result.get("processes")
    if (
        not isinstance(watchers, list)
        or not watchers
        or not isinstance(servers, list)
        or not servers
        or not isinstance(children, list)
        or not isinstance(processes, list)
    ):
        raise AcceptanceFailure("node_watch_process_not_found")
    return {
        "watch_pids": [int(pid) for pid in watchers],
        "server_pids": [int(pid) for pid in servers],
        "server_child_pids": [int(pid) for pid in children],
        "processes": processes,
    }


def file_state(container: str, path: str, marker: str, operation: str) -> dict[str, Any]:
    return exec_json(container, FILE_STATE, path, marker, operation=operation)


def node_file_state(container: str, path: str, marker: str, operation: str) -> dict[str, Any]:
    output = docker(operation, "exec", container, "node", "-e", NODE_FILE_STATE, path, marker, timeout=6)
    try:
        value = json.loads(output.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        raise AcceptanceFailure(operation + "_invalid_result") from None
    if not isinstance(value, dict):
        raise AcceptanceFailure(operation + "_invalid_result")
    return value


def write_bytes_durable(path: Path, data: bytes) -> None:
    with path.open("wb") as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())


def capture_source(spec: dict[str, Any], marker: str) -> dict[str, Any]:
    path = spec["source"]
    original = path.read_bytes()
    if marker.encode("ascii") in original:
        raise AcceptanceFailure(spec["name"] + "_marker_already_present")
    return {
        "path": path,
        "relative_path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "original": original,
        "original_sha256": sha256(original),
        "marker": marker,
        "spec": spec,
    }


def append_probe(snapshot: dict[str, Any]) -> None:
    original = snapshot["original"]
    prefix = "#" if snapshot["spec"]["kind"] == "python" else "//"
    separator = b"" if original.endswith(b"\n") else b"\n"
    comment = f"{prefix} hot-reload-probe:{snapshot['marker']}\n".encode("ascii")
    snapshot["probe_bytes"] = original + separator + comment
    write_bytes_durable(snapshot["path"], snapshot["probe_bytes"])


def restore_source(snapshot: dict[str, Any]) -> dict[str, Any]:
    path: Path = snapshot["path"]
    try:
        current = path.read_bytes()
        if sha256(current) != snapshot["original_sha256"]:
            write_bytes_durable(path, snapshot["original"])
        restored_hash = sha256(path.read_bytes())
    except OSError:
        restored_hash = None
    return {
        "path": snapshot["relative_path"],
        "sha256_before": snapshot["original_sha256"],
        "sha256_after": restored_hash,
        "matches": restored_hash == snapshot["original_sha256"],
    }


def api_pid_after_reload(
    container: str,
    health_url: str,
    baseline: set[int],
    timeout: float = RELOAD_TIMEOUT,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    latest: dict[str, list[int]] | None = None
    while time.monotonic() < deadline:
        latest = python_processes(container)
        workers = set(latest["worker_pids"])
        if workers != baseline and request_status(health_url) == 200:
            return {"worker_pids": sorted(workers), "health_status": 200}
        time.sleep(0.35)
    raise AcceptanceFailure("uvicorn_worker_pid_or_health_did_not_recover")


def run_python_stage(
    project: str,
    spec: dict[str, Any],
    snapshots: list[dict[str, Any]],
    stage_report: dict[str, Any],
) -> None:
    name = spec["name"]
    container = container_id(project, spec["service"])
    mount = inspect_source_mount(container, spec["source_suffix"])
    port = host_port(container, spec["internal_port"], name + "_read_port")
    health_url = f"http://127.0.0.1:{port}{spec['health_path']}"
    wait_health(health_url, 8, name + "_initial")
    baseline = python_processes(container)
    marker = "ORDIVANT_HOT_RELOAD_" + uuid.uuid4().hex
    snapshot = capture_source(spec, marker)
    snapshots.append(snapshot)
    stage = {
        "status": "running",
        "container_id": container[:12],
        "source_mount": mount,
        "baseline_supervisor_pids": baseline["supervisor_pids"],
        "baseline_worker_pids": baseline["worker_pids"],
        "health_before": 200,
    }
    stage_report[name] = stage
    started = time.monotonic()
    try:
        append_probe(snapshot)
        visible = file_state(container, spec["container_file"], marker, name + "_container_source")
        if not visible.get("exists") or not visible.get("marker_present"):
            raise AcceptanceFailure(name + "_probe_not_visible_in_container")
        stage["container_source_marker"] = True
        outcome = api_pid_after_reload(container, health_url, set(baseline["worker_pids"]))
        stage["reloaded_worker_pids"] = outcome["worker_pids"]
        stage["health_after_reload"] = outcome["health_status"]
        stage["elapsed_seconds"] = round(time.monotonic() - started, 2)
        stage["status"] = "passed"
    except AcceptanceFailure as error:
        stage["status"] = "failed"
        stage["failure_code"] = str(error)
        raise
    finally:
        restored = restore_source(snapshot)
        stage["source_restored"] = restored["matches"]
        if not restored["matches"]:
            raise AcceptanceFailure(name + "_source_restore_hash_mismatch")
        try:
            clean = file_state(container, spec["container_file"], marker, name + "_restored_source")
            stage["container_source_marker_removed"] = not clean.get("marker_present", True)
            stage["health_after_restore"] = wait_health(health_url, 15, name + "_restore")
        except AcceptanceFailure as error:
            stage["restore_check_failure_code"] = str(error)
            raise


def log_event_count(container: str) -> int:
    output = docker("read_vite_logs", "logs", "--tail", "200", container)
    return len(re.findall(r"(?im)(?:hmr\s+update|page\s+reload)[^\r\n]*main\.tsx", output))


def wait_vite_event(container: str, previous_count: int, timeout: float = 25) -> int:
    deadline = time.monotonic() + timeout
    latest = previous_count
    while time.monotonic() < deadline:
        latest = log_event_count(container)
        if latest > previous_count:
            return latest
        time.sleep(0.4)
    raise AcceptanceFailure("vite_hmr_log_event_not_seen")


def run_runtime_stage(
    project: str,
    snapshots: list[dict[str, Any]],
    stage_report: dict[str, Any],
) -> None:
    spec = {
        "name": "runtime",
        "service": "runtime",
        "source": ROOT / "runtime" / "src" / "server.ts",
        "source_suffix": "/runtime/src",
        "kind": "typescript",
        "container_file": "/app/src/server.ts",
        "internal_port": "8090/tcp",
    }
    container = container_id(project, "runtime")
    mount = inspect_source_mount(container, spec["source_suffix"])
    port = host_port(container, spec["internal_port"], "runtime_read_port")
    health_url = f"http://127.0.0.1:{port}/health"
    wait_health(health_url, 8, "runtime_initial")
    baseline = node_processes(container)
    marker = "ORDIVANT_HOT_RELOAD_" + uuid.uuid4().hex
    snapshot = capture_source(spec, marker)
    snapshots.append(snapshot)
    stage = {
        "status": "running",
        "container_id": container[:12],
        "source_mount": mount,
        "baseline_watch_pids": baseline["watch_pids"],
        "baseline_server_pids": baseline["server_pids"],
        "baseline_server_child_pids": baseline["server_child_pids"],
        "baseline_server_processes": baseline["processes"],
        "health_before": 200,
    }
    stage_report["runtime"] = stage
    started = time.monotonic()
    try:
        append_probe(snapshot)
        visible = node_file_state(container, spec["container_file"], marker, "runtime_container_source")
        if not visible.get("exists") or not visible.get("marker_present"):
            raise AcceptanceFailure("runtime_probe_not_visible_in_container")
        stage["container_source_marker"] = True

        deadline = time.monotonic() + RELOAD_TIMEOUT
        compiled_marker_seen = False
        server_pid_changed = False
        health_200_seen = False
        health_status: int | None = None
        last_dist: dict[str, Any] = {"exists": False, "marker_present": False}
        latest: dict[str, Any] = baseline
        while time.monotonic() < deadline:
            last_dist = node_file_state(container, "/app/dist/server.js", marker, "runtime_compiled_output")
            latest = node_processes(container)
            compiled_marker_seen = compiled_marker_seen or bool(last_dist.get("exists") and last_dist.get("marker_present"))
            tracked_baseline = baseline["server_child_pids"] or baseline["server_pids"]
            tracked_latest = latest["server_child_pids"] or latest["server_pids"]
            server_pid_changed = server_pid_changed or set(tracked_latest) != set(tracked_baseline)
            health_status = request_status(health_url)
            health_200_seen = health_200_seen or health_status == 200
            if compiled_marker_seen and server_pid_changed and health_status == 200:
                break
            time.sleep(0.35)
        else:
            stage["runtime_observations"] = {
                "compiled_marker_seen": compiled_marker_seen,
                "compiled_output_exists_last": bool(last_dist.get("exists")),
                "compiled_output_marker_present_last": bool(last_dist.get("marker_present")),
                "server_pid_changed": server_pid_changed,
                "baseline_server_child_pids": baseline["server_child_pids"],
                "latest_server_child_pids": latest["server_child_pids"],
                "baseline_server_pids": baseline["server_pids"],
                "latest_server_pids": latest["server_pids"],
                "latest_server_processes": latest["processes"],
                "health_200_seen": health_200_seen,
                "health_status_last": health_status,
            }
            if not compiled_marker_seen:
                raise AcceptanceFailure("runtime_compiled_marker_not_observed")
            if not server_pid_changed:
                raise AcceptanceFailure("runtime_server_pid_not_changed")
            if health_status != 200:
                raise AcceptanceFailure("runtime_health_not_200_after_reload")
            raise AcceptanceFailure("runtime_compile_node_watch_pid_or_health_not_observed")

        stage["compiled_dist_marker"] = compiled_marker_seen
        stage["watch_pids"] = latest["watch_pids"]
        stage["reloaded_server_pids"] = latest["server_pids"]
        stage["reloaded_server_child_pids"] = latest["server_child_pids"]
        stage["reloaded_server_processes"] = latest["processes"]
        stage["node_server_pid_changed"] = server_pid_changed
        stage["health_after_reload"] = 200
        stage["elapsed_seconds"] = round(time.monotonic() - started, 2)
        stage["status"] = "passed"
    except AcceptanceFailure as error:
        stage["status"] = "failed"
        stage["failure_code"] = str(error)
        raise
    finally:
        restored = restore_source(snapshot)
        stage["source_restored"] = restored["matches"]
        if not restored["matches"]:
            raise AcceptanceFailure("runtime_source_restore_hash_mismatch")
        try:
            wait_health(health_url, 15, "runtime_restore")
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                dist = node_file_state(container, "/app/dist/server.js", marker, "runtime_restored_output")
                if not dist.get("marker_present"):
                    stage["compiled_marker_removed_after_restore"] = True
                    break
                time.sleep(0.35)
            else:
                raise AcceptanceFailure("runtime_compiled_marker_remained_after_restore")
        except AcceptanceFailure as error:
            stage["restore_check_failure_code"] = str(error)
            raise


def fetch_text(url: str, timeout: float = 4) -> tuple[int, str]:
    try:
        with HTTP.open(urllib.request.Request(url, headers={"Accept": "text/javascript,*/*"}), timeout=timeout) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, ""
    except (OSError, urllib.error.URLError, TimeoutError):
        return 0, ""


def run_frontend_stage(
    project: str,
    snapshots: list[dict[str, Any]],
    stage_report: dict[str, Any],
) -> None:
    spec = {
        "name": "web",
        "service": "web",
        "source": ROOT / "frontend" / "src" / "main.tsx",
        "source_suffix": "/frontend/src",
        "kind": "typescript",
        "container_file": "/app/src/main.tsx",
    }
    container = container_id(project, "web")
    mount = inspect_source_mount(container, spec["source_suffix"])
    port = host_port(container, "5173/tcp", "web_read_port")
    base_url = f"http://127.0.0.1:{port}"
    wait_health(base_url + "/", 8, "web_initial")
    baseline_hmr_count = log_event_count(container)
    marker = "ORDIVANT_HOT_RELOAD_" + uuid.uuid4().hex
    snapshot = capture_source(spec, marker)
    snapshots.append(snapshot)
    stage = {
        "status": "running",
        "container_id": container[:12],
        "source_mount": mount,
        "baseline_hmr_log_events": baseline_hmr_count,
        "health_before": 200,
    }
    stage_report["web"] = stage
    started = time.monotonic()
    try:
        append_probe(snapshot)
        visible = node_file_state(container, spec["container_file"], marker, "web_container_source")
        if not visible.get("exists") or not visible.get("marker_present"):
            raise AcceptanceFailure("web_probe_not_visible_in_container")
        stage["container_source_marker"] = True

        status = 0
        response_body = ""
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            status, response_body = fetch_text(base_url + "/src/main.tsx?raw")
            if status == 200 and marker in response_body:
                break
            time.sleep(0.35)
        if status != 200 or marker not in response_body:
            raise AcceptanceFailure("vite_http_raw_source_marker_not_returned")
        stage["http_source_status"] = status
        stage["http_source_marker"] = True

        event_count = wait_vite_event(container, baseline_hmr_count)
        stage["hmr_log_event_seen"] = True
        stage["hmr_log_event_count"] = event_count
        stage["health_after_reload"] = request_status(base_url + "/")
        if stage["health_after_reload"] != 200:
            raise AcceptanceFailure("web_health_not_ready_after_hmr")
        stage["elapsed_seconds"] = round(time.monotonic() - started, 2)
        stage["status"] = "passed"
    except AcceptanceFailure as error:
        stage["status"] = "failed"
        stage["failure_code"] = str(error)
        raise
    finally:
        restored = restore_source(snapshot)
        stage["source_restored"] = restored["matches"]
        if not restored["matches"]:
            raise AcceptanceFailure("web_source_restore_hash_mismatch")
        try:
            clean = node_file_state(container, spec["container_file"], marker, "web_restored_source")
            stage["container_source_marker_removed"] = not clean.get("marker_present", True)
            wait_health(base_url + "/", 15, "web_restore")
            status, body = fetch_text(base_url + "/src/main.tsx?raw")
            stage["http_source_marker_removed_after_restore"] = status == 200 and marker not in body
            if not stage["http_source_marker_removed_after_restore"]:
                raise AcceptanceFailure("vite_http_source_marker_remained_after_restore")
        except AcceptanceFailure as error:
            stage["restore_check_failure_code"] = str(error)
            raise


def write_report(report: dict[str, Any]) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = REPORT_DIR / f"hot-reload-acceptance-{stamp}-{uuid.uuid4().hex[:6]}.json"
    path.write_text(json.dumps(report, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    args = parser.parse_args()

    report: dict[str, Any] = {
        "status": "running",
        "project": args.project,
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "containers_stopped": False,
        "stages": {},
    }
    snapshots: list[dict[str, Any]] = []
    failure_code: str | None = None
    try:
        for spec in PYTHON_SOURCES:
            run_python_stage(args.project, spec, snapshots, report["stages"])
        run_runtime_stage(args.project, snapshots, report["stages"])
        run_frontend_stage(args.project, snapshots, report["stages"])
    except AcceptanceFailure as error:
        failure_code = str(error)
    except KeyboardInterrupt:
        failure_code = "interrupted"
    except Exception as error:
        failure_code = "unexpected_" + type(error).__name__.lower()
    finally:
        restoration = []
        for snapshot in reversed(snapshots):
            result = restore_source(snapshot)
            restoration.append(result)
            if not result["matches"] and failure_code is None:
                failure_code = "source_restore_hash_mismatch"
        restoration.reverse()
        report["source_restoration"] = restoration
        report["status"] = "failed" if failure_code else "passed"
        if failure_code:
            report["failure_code"] = failure_code
        report["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
        try:
            report_path = write_report(report)
            report["report"] = str(report_path.relative_to(ROOT)).replace("\\", "/")
        except OSError:
            report["report_write_failed"] = True
        print(json.dumps(report, ensure_ascii=True, indent=2))

    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())

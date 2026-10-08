from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import socket as socket_module
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import docker
from docker.errors import APIError, DockerException, NotFound
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_BODY_BYTES = 64 * 1024 * 1024
MAX_FILE_CHARS = 16 * 1024 * 1024
EXECUTOR_LABEL = "ordivant.sandbox.executor"
OWNER_LABEL = "ordivant.sandbox.owner"
RUN_LABEL = "ordivant.sandbox.run_id"


class Limits(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    timeout_seconds: int = Field(ge=1, le=120)
    memory_mb: int = Field(ge=64, le=1024)
    cpu_count: float = Field(ge=0.25, le=2)
    pids_limit: int = Field(ge=16, le=128)
    output_bytes: int = Field(ge=1024, le=65536)
    workspace_mb: int = Field(ge=1, le=128)


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    limits: Limits


class CreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    run_id: str
    profile: Profile

    @field_validator("run_id")
    @classmethod
    def valid_run_id(cls, value: str) -> str:
        try:
            canonical = str(UUID(value))
        except ValueError as error:
            raise ValueError("run_id must be a UUID") from error
        if canonical != value.lower():
            raise ValueError("run_id must be a canonical UUID")
        return canonical


class ExecuteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    command: list[str] = Field(min_length=1, max_length=128)
    timeout_seconds: int | None = Field(default=None, ge=1, le=120)

    @field_validator("command")
    @classmethod
    def valid_command(cls, value: list[str]) -> list[str]:
        if not value or not value[0] or any("\x00" in item or len(item) > 32768 for item in value):
            raise ValueError("command must be a bounded argv array without NUL bytes")
        if sum(len(item.encode("utf-8")) for item in value) > 256 * 1024:
            raise ValueError("command is too large")
        return value


class FilePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str

    @field_validator("path")
    @classmethod
    def valid_path(cls, value: str) -> str:
        validate_relative_path(value)
        return value


class FileWriteRequest(FilePathRequest):
    content: str = Field(max_length=MAX_FILE_CHARS)


class FileListRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str = "."

    @field_validator("path")
    @classmethod
    def valid_path(cls, value: str) -> str:
        validate_relative_path(value, allow_dot=True)
        return value


@dataclass
class Settings:
    token: str
    data_dir: Path
    owner: str
    image: str
    max_jobs: int = 4

    @classmethod
    def from_env(cls) -> "Settings":
        token_path = os.environ.get("ORDIVANT_SANDBOX_TOKEN_FILE", "")
        if not token_path:
            raise RuntimeError("ORDIVANT_SANDBOX_TOKEN_FILE is required")
        try:
            token = Path(token_path).read_text(encoding="utf-8").strip()
        except OSError as error:
            raise RuntimeError("Sandbox service token file is unavailable") from error
        if len(token) < 32:
            raise RuntimeError("Sandbox service token must contain at least 32 characters")
        data_dir = Path(os.environ.get("ORDIVANT_SANDBOX_DATA_DIR", "/data")).resolve()
        owner = os.environ.get("ORDIVANT_SANDBOX_OWNER", "").strip()
        image = os.environ.get("ORDIVANT_SANDBOX_IMAGE", "").strip()
        max_jobs = int(os.environ.get("ORDIVANT_SANDBOX_MAX_JOBS", "4"))
        if not owner or len(owner) > 128:
            raise RuntimeError("ORDIVANT_SANDBOX_OWNER must be configured")
        if not image or len(image) > 256:
            raise RuntimeError("ORDIVANT_SANDBOX_IMAGE must be configured")
        if not 1 <= max_jobs <= 32:
            raise RuntimeError("ORDIVANT_SANDBOX_MAX_JOBS must be from 1 to 32")
        return cls(token=token, data_dir=data_dir, owner=owner, image=image, max_jobs=max_jobs)


@dataclass
class RunEntry:
    run_id: str
    container: Any
    limits: Limits
    capability_hash: str
    lock: threading.RLock = field(default_factory=threading.RLock)
    stopped: threading.Event = field(default_factory=threading.Event)


def validate_relative_path(value: str, allow_dot: bool = False) -> None:
    if not value or len(value) > 4096 or "\\" in value or "\x00" in value or value.startswith("/"):
        raise ValueError("path must be a bounded relative POSIX path")
    if value == "." and allow_dot:
        return
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts) or ":" in parts[0]:
        raise ValueError("path must stay inside the run workspace")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class SandboxExecutor:
    def __init__(self, settings: Settings, client: Any):
        self.settings = settings
        self.client = client
        self.entries: dict[str, RunEntry] = {}
        self.guard = threading.RLock()
        self.capacity = threading.BoundedSemaphore(settings.max_jobs)
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)

    def recover_cleanup(self) -> None:
        filters = {"label": [f"{OWNER_LABEL}={self.settings.owner}", f"{EXECUTOR_LABEL}=1"]}
        try:
            containers = self.client.containers.list(all=True, filters=filters)
        except DockerException as error:
            raise RuntimeError("Sandbox Docker daemon is unavailable") from error
        for container in containers:
            labels = getattr(container, "labels", {}) or {}
            run_id = labels.get(RUN_LABEL, "")
            try:
                canonical = str(UUID(run_id))
            except ValueError:
                continue
            if labels.get(OWNER_LABEL) == self.settings.owner and labels.get(EXECUTOR_LABEL) == "1" and canonical == run_id:
                try:
                    container.remove(force=True, v=True)
                except NotFound:
                    pass
        for path in self.settings.data_dir.glob("*.json"):
            if not re.fullmatch(r"[0-9a-f-]{36}\.json", path.name):
                continue
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if record.get("owner") == self.settings.owner:
                path.unlink(missing_ok=True)

    def create(self, run_id: str, limits: Limits) -> tuple[RunEntry, str]:
        with self.guard:
            current = self.entries.get(run_id)
            if current:
                capability = secrets.token_urlsafe(32)
                current.capability_hash = _token_hash(capability)
                self._save(current)
                return current, capability
            if not self.capacity.acquire(blocking=False):
                raise HTTPException(status_code=503, detail="Sandbox job capacity is full")
            capability = secrets.token_urlsafe(32)
            container = None
            options = self._container_options(run_id, limits)
            try:
                container = self.client.containers.create(self.settings.image, **options)
                container.start()
                entry = RunEntry(run_id, container, limits, _token_hash(capability))
                self.entries[run_id] = entry
                self._save(entry)
                return entry, capability
            except Exception as error:
                self.entries.pop(run_id, None)
                if container is not None:
                    try:
                        container.remove(force=True, v=True)
                    except Exception:
                        pass
                self.capacity.release()
                if isinstance(error, HTTPException):
                    raise
                raise HTTPException(status_code=503, detail="Sandbox job could not be started") from error

    def authorize(self, run_id: str, token: str | None) -> RunEntry:
        if not token:
            raise HTTPException(status_code=401, detail="Sandbox capability required")
        with self.guard:
            entry = self.entries.get(run_id)
        if not entry or entry.stopped.is_set():
            raise HTTPException(status_code=404, detail="Sandbox run is unavailable")
        if not hmac.compare_digest(entry.capability_hash, _token_hash(token)):
            raise HTTPException(status_code=403, detail="Sandbox capability rejected")
        return entry

    def execute(self, entry: RunEntry, command: list[str], timeout_seconds: int | None) -> dict[str, Any]:
        timeout = min(timeout_seconds or entry.limits.timeout_seconds, entry.limits.timeout_seconds)
        request = {
            "command": command,
            "timeout_seconds": timeout,
            "output_bytes": entry.limits.output_bytes,
        }
        encoded = _encode_request(request)
        with entry.lock:
            self._assert_active(entry)
            output = entry.container.exec_run(["/usr/local/bin/ordivant-exec", encoded], demux=False)
        try:
            result = json.loads(output.output.decode("utf-8", errors="strict"))
        except (AttributeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=502, detail="Sandbox command returned an invalid result") from error
        required = {"exit_code", "stdout", "stderr", "truncated", "timed_out", "duration_seconds"}
        if not isinstance(result, dict) or not required.issubset(result):
            raise HTTPException(status_code=502, detail="Sandbox command returned an invalid result")
        return result

    def write_file(self, entry: RunEntry, path: str, content: str) -> dict[str, Any]:
        if len(content) > MAX_FILE_CHARS:
            raise HTTPException(status_code=413, detail="File content is too large")
        payload = json.dumps(
            {"path": path, "content": content, "output_bytes": entry.limits.output_bytes},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if len(payload) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="File content is too large")
        with entry.lock:
            self._assert_active(entry)
            return self._file_operation_stdin(entry, "write", payload)

    def read_file(self, entry: RunEntry, path: str) -> dict[str, Any]:
        with entry.lock:
            self._assert_active(entry)
            return self._file_operation(entry, "read", {"path": path, "output_bytes": entry.limits.output_bytes})

    def list_files(self, entry: RunEntry, path: str) -> dict[str, Any]:
        with entry.lock:
            self._assert_active(entry)
            return self._file_operation(entry, "list", {"path": path})

    def _file_operation(self, entry: RunEntry, operation: str, request: dict[str, Any]) -> dict[str, Any]:
        request["output_bytes"] = entry.limits.output_bytes
        helper_command = ["python", "/opt/ordivant/job_files.py", operation, _encode_request(request)]
        envelope = {
            "command": helper_command,
            "timeout_seconds": min(10, entry.limits.timeout_seconds),
            "output_bytes": min(1_048_576, entry.limits.output_bytes * 8 + 4096),
        }
        output = entry.container.exec_run(["/usr/local/bin/ordivant-exec", _encode_request(envelope)], demux=False)
        try:
            envelope_result = json.loads(output.output.decode("utf-8", errors="strict"))
            if envelope_result.get("timed_out"):
                raise HTTPException(status_code=408, detail="Sandbox file operation timed out")
            response = json.loads(envelope_result["stdout"])
        except (AttributeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=502, detail="Sandbox file operation returned an invalid result") from error
        if not isinstance(response, dict) or response.get("ok") is not True:
            raise HTTPException(status_code=400, detail="Sandbox file operation rejected the path")
        result = response.get("result")
        if not isinstance(result, dict):
            raise HTTPException(status_code=502, detail="Sandbox file operation returned an invalid result")
        return result

    def _file_operation_stdin(self, entry: RunEntry, operation: str, payload: bytes) -> dict[str, Any]:
        envelope = {
            "command": ["python", "/opt/ordivant/job_files.py", operation],
            "timeout_seconds": min(10, entry.limits.timeout_seconds),
            "output_bytes": min(1_048_576, entry.limits.output_bytes * 8 + 4096),
            "stdin": True,
        }
        timeout = min(10, entry.limits.timeout_seconds) + 2
        try:
            attached = entry.container.exec_run(
                ["/usr/local/bin/ordivant-exec", _encode_request(envelope)],
                stdin=True,
                socket=True,
                user="10001:10001",
                workdir="/workspace",
                demux=False,
            )
            stream = attached.output
            connection = stream
            while not all(hasattr(connection, name) for name in ("settimeout", "sendall", "shutdown", "recv")):
                nested = getattr(connection, "_sock", None)
                if nested is None or nested is connection:
                    raise OSError("Docker exec stream does not expose a duplex socket")
                connection = nested
            connection.settimeout(timeout)
            connection.sendall(payload)
            connection.shutdown(socket_module.SHUT_WR)
            output = _read_docker_stream(connection, envelope["output_bytes"])
        except (TimeoutError, socket_module.timeout) as error:
            raise HTTPException(status_code=408, detail="Sandbox file operation timed out") from error
        except (OSError, APIError, DockerException) as error:
            raise HTTPException(status_code=502, detail="Sandbox file operation failed") from error
        finally:
            if "stream" in locals():
                stream.close()
        try:
            envelope_result = json.loads(output.decode("utf-8", errors="strict"))
            if envelope_result.get("timed_out"):
                raise HTTPException(status_code=408, detail="Sandbox file operation timed out")
            response = json.loads(envelope_result["stdout"])
        except (AttributeError, KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=502, detail="Sandbox file operation returned an invalid result") from error
        if not isinstance(response, dict) or response.get("ok") is not True:
            raise HTTPException(status_code=400, detail="Sandbox file operation rejected the path")
        result = response.get("result")
        if not isinstance(result, dict):
            raise HTTPException(status_code=502, detail="Sandbox file operation returned an invalid result")
        return result

    def stop(self, entry: RunEntry) -> None:
        with self.guard:
            if entry.stopped.is_set():
                return
            entry.stopped.set()
            self.entries.pop(entry.run_id, None)
        try:
            entry.container.kill()
        except (NotFound, APIError):
            pass
        with entry.lock:
            self._remove_container(entry.container)
            self._record_path(entry.run_id).unlink(missing_ok=True)
        self.capacity.release()

    def _assert_active(self, entry: RunEntry) -> None:
        if entry.stopped.is_set():
            raise HTTPException(status_code=410, detail="Sandbox run has stopped")

    def _remove_container(self, container: Any) -> None:
        try:
            container.reload()
            labels = getattr(container, "labels", {}) or {}
            if labels.get(OWNER_LABEL) != self.settings.owner or labels.get(EXECUTOR_LABEL) != "1":
                raise HTTPException(status_code=409, detail="Sandbox ownership labels changed")
            container.remove(force=True, v=True)
        except NotFound:
            pass

    def _record_path(self, run_id: str) -> Path:
        return self.settings.data_dir / f"{run_id}.json"

    def _save(self, entry: RunEntry) -> None:
        path = self._record_path(entry.run_id)
        record = {
            "owner": self.settings.owner,
            "run_id": entry.run_id,
            "container_id": entry.container.id,
            "capability_sha256": entry.capability_hash,
            "limits": entry.limits.model_dump(mode="json"),
        }
        fd, temporary = tempfile.mkstemp(prefix=f".{entry.run_id}-", suffix=".tmp", dir=self.settings.data_dir)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(record, output, separators=(",", ":"))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def _container_options(self, run_id: str, limits: Limits) -> dict[str, Any]:
        workspace_size = limits.workspace_mb * 1024 * 1024
        tmp_size = min(max(4, limits.workspace_mb), 16) * 1024 * 1024
        return {
            "name": f"ordivant-sandbox-{run_id}",
            "command": ["sleep", "infinity"],
            "detach": True,
            "init": True,
            "user": "10001:10001",
            "environment": {
                "HOME": "/tmp",
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "PYTHONNOUSERSITE": "1",
            },
            "labels": {
                OWNER_LABEL: self.settings.owner,
                RUN_LABEL: run_id,
                EXECUTOR_LABEL: "1",
            },
            "network_mode": "none",
            "read_only": True,
            "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"],
            "pids_limit": limits.pids_limit,
            "nano_cpus": int(limits.cpu_count * 1_000_000_000),
            "mem_limit": f"{limits.memory_mb}m",
            "memswap_limit": f"{limits.memory_mb}m",
            "tmpfs": {
                "/workspace": f"rw,noexec,nosuid,nodev,size={workspace_size},uid=10001,gid=10001,mode=0700",
                "/tmp": f"rw,noexec,nosuid,nodev,size={tmp_size},uid=10001,gid=10001,mode=1777",
            },
        }


def _encode_request(value: dict[str, Any]) -> str:
    import base64

    return base64.urlsafe_b64encode(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).decode("ascii")


def _read_docker_stream(connection: Any, output_limit: int) -> bytes:
    output = bytearray()

    def read_exact(length: int) -> bytes:
        value = bytearray()
        while len(value) < length:
            chunk = connection.recv(length - len(value))
            if not chunk:
                raise OSError("Docker exec stream closed unexpectedly")
            value.extend(chunk)
        return bytes(value)

    while True:
        header = bytearray()
        while len(header) < 8:
            chunk = connection.recv(8 - len(header))
            if not chunk:
                if not header:
                    return bytes(output)
                raise OSError("Docker exec stream ended inside a frame header")
            header.extend(chunk)
        stream_type = header[0]
        frame_size = int.from_bytes(header[4:8], "big")
        if stream_type not in (1, 2) or frame_size > output_limit - len(output):
            raise OSError("Docker exec stream exceeded its output limit")
        frame = read_exact(frame_size)
        if stream_type == 1:
            output.extend(frame)


def create_app(settings: Settings | None = None, docker_client: Any | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    client = docker_client or docker.from_env(timeout=135)
    executor = SandboxExecutor(resolved, client)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        executor.recover_cleanup()
        try:
            yield
        finally:
            for entry in list(executor.entries.values()):
                executor.stop(entry)
            client.close()

    app = FastAPI(title="Ordivant Sandbox Executor", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.executor = executor

    @app.middleware("http")
    async def body_limit(request: Request, call_next):
        body = bytearray()
        receive = request.receive
        while True:
            message = await receive()
            if message["type"] != "http.request":
                continue
            body.extend(message.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request body is too large"})
            if not message.get("more_body", False):
                break

        sent = False

        async def replay():
            nonlocal sent
            if sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        request._receive = replay
        return await call_next(request)

    def require_service(authorization: str | None = Header(default=None)) -> None:
        supplied = _bearer(authorization)
        if not supplied or not hmac.compare_digest(resolved.token, supplied):
            raise HTTPException(status_code=401, detail="Sandbox service authentication required")

    def require_run(run_id: str, authorization: str | None = Header(default=None)) -> RunEntry:
        supplied = _bearer(authorization)
        return executor.authorize(run_id, supplied)

    @app.get("/health")
    def health():
        return {"status": "ok", "executor": "docker", "active_jobs": len(executor.entries), "max_jobs": resolved.max_jobs}

    @app.post("/sandboxes", dependencies=[Depends(require_service)])
    def create_sandbox(body: CreateRequest):
        entry, capability = executor.create(body.run_id, body.profile.limits)
        return {"run_id": entry.run_id, "status": "ready", "token": capability}

    @app.post("/sandboxes/{run_id}/execute")
    def execute(run_id: str, body: ExecuteRequest, entry: RunEntry = Depends(require_run)):
        if entry.run_id != run_id:
            raise HTTPException(status_code=404, detail="Sandbox run is unavailable")
        return executor.execute(entry, body.command, body.timeout_seconds)

    @app.post("/sandboxes/{run_id}/files/write")
    def write_file(run_id: str, body: FileWriteRequest, entry: RunEntry = Depends(require_run)):
        if entry.run_id != run_id:
            raise HTTPException(status_code=404, detail="Sandbox run is unavailable")
        return executor.write_file(entry, body.path, body.content)

    @app.post("/sandboxes/{run_id}/files/read")
    def read_file(run_id: str, body: FilePathRequest, entry: RunEntry = Depends(require_run)):
        if entry.run_id != run_id:
            raise HTTPException(status_code=404, detail="Sandbox run is unavailable")
        return executor.read_file(entry, body.path)

    @app.post("/sandboxes/{run_id}/files/list")
    def list_files(run_id: str, body: FileListRequest, entry: RunEntry = Depends(require_run)):
        if entry.run_id != run_id:
            raise HTTPException(status_code=404, detail="Sandbox run is unavailable")
        return executor.list_files(entry, body.path)

    @app.delete("/sandboxes/{run_id}")
    def delete_sandbox(run_id: str, entry: RunEntry = Depends(require_run)):
        executor.stop(entry)
        return {"run_id": entry.run_id, "status": "stopped"}

    return app


def _bearer(value: str | None) -> str | None:
    if not value or not value.startswith("Bearer "):
        return None
    token = value[7:]
    return token if token and len(token) <= 4096 else None


try:
    app = create_app()
except RuntimeError:
    app = FastAPI(title="Ordivant Sandbox Executor", docs_url=None, redoc_url=None)

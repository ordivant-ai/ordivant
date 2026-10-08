import base64
import json
import shutil
import struct
import uuid
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest

from sandbox.main import Limits, Settings, create_app, validate_relative_path


class FakeContainer:
    def __init__(self, image, options):
        self.image = image
        self.options = options
        self.labels = options["labels"]
        self.id = str(uuid.uuid4())
        self.started = False
        self.removed = False
        self.killed = False

    def start(self):
        self.started = True

    def exec_run(self, command, demux=False, stdin=False, socket=False, **kwargs):
        request = json.loads(base64.urlsafe_b64decode(command[1].encode()).decode())
        if socket:
            return SimpleNamespace(output=FakeSocketIO(FakeExecSocket(self, request)))
        inner_command = request["command"]
        if "/opt/ordivant/job_files.py" in inner_command:
            operation = inner_command[2]
            result = {
                "write": {"path": "hello.txt", "bytes_written": 5},
                "read": {"path": "hello.txt", "content": "hello", "truncated": False},
                "list": {"path": ".", "files": [{"path": "hello.txt", "type": "file", "size": 5}], "truncated": False},
            }[operation]
            helper_response = {"ok": True, "result": result}
            output = json.dumps(helper_response)
        else:
            output = "test output"
        value = {
                "exit_code": 0,
                "stdout": output,
                "stderr": "",
                "truncated": False,
                "timed_out": False,
                "duration_seconds": 0.01,
            }
        return SimpleNamespace(output=json.dumps(value).encode())

    def kill(self):
        self.killed = True

    def reload(self):
        return None

    def remove(self, force=False, v=False):
        self.removed = True


class FakeExecSocket:
    def __init__(self, container, envelope):
        self.container = container
        self.envelope = envelope
        self.input = bytearray()
        self.output = bytearray()
        self.closed = False

    def settimeout(self, _timeout):
        return None

    def sendall(self, payload):
        self.input.extend(payload)

    def shutdown(self, how):
        assert how == 1
        request = json.loads(self.input)
        assert self.envelope["stdin"] is True
        assert request["path"] == "hello.txt"
        assert request["content"] == "hello"
        response = json.dumps({"ok": True, "result": {"path": request["path"], "bytes_written": len(request["content"])}})
        wrapped = json.dumps({
            "exit_code": 0,
            "stdout": response,
            "stderr": "",
            "truncated": False,
            "timed_out": False,
            "duration_seconds": 0.01,
        }).encode()
        self.output.extend(bytes([1, 0, 0, 0]) + struct.pack(">I", len(wrapped)) + wrapped)

    def recv(self, size):
        if not self.output:
            return b""
        result = self.output[:size]
        del self.output[:size]
        return bytes(result)

    def close(self):
        self.closed = True


class FakeSocketIO:
    def __init__(self, raw_socket):
        self._sock = raw_socket
        self.closed = False

    def close(self):
        self.closed = True
        self._sock.close()


class FakeContainers:
    def __init__(self):
        self.created = []

    def create(self, image, **options):
        container = FakeContainer(image, options)
        self.created.append(container)
        return container

    def list(self, all=False, filters=None):
        return []


class FakeDocker:
    def __init__(self):
        self.containers = FakeContainers()
        self.closed = False

    def close(self):
        self.closed = True


def settings(tmp_path: Path) -> Settings:
    return Settings(
        token="fixture-service-token-which-is-not-a-human-secret",
        data_dir=tmp_path,
        owner="ordivant-test",
        image="project/sandbox-job:local",
        max_jobs=2,
    )


def profile():
    return {
        "limits": {
            "timeout_seconds": 30,
            "memory_mb": 128,
            "cpu_count": 0.5,
            "pids_limit": 32,
            "output_bytes": 4096,
            "workspace_mb": 8,
        }
    }


@pytest.fixture
def data_dir():
    path = Path(".cache/sandbox-tests") / str(uuid.uuid4())
    path.mkdir(parents=True, exist_ok=True)
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def test_service_and_per_run_capabilities_are_separate_and_job_flags_are_fixed(data_dir):
    docker = FakeDocker()
    app = create_app(settings(data_dir), docker)
    run_a, run_b = str(uuid.uuid4()), str(uuid.uuid4())
    with TestClient(app) as client:
        body = {"run_id": run_a, "profile": profile()}
        assert client.post("/sandboxes", json=body).status_code == 401
        created = client.post("/sandboxes", json=body, headers={"Authorization": f"Bearer {settings(data_dir).token}"})
        assert created.status_code == 200
        token_a = created.json()["token"]
        second = client.post("/sandboxes", json={"run_id": run_b, "profile": profile()}, headers={
            "Authorization": f"Bearer {settings(data_dir).token}"
        }).json()

        command = client.post(f"/sandboxes/{run_a}/execute", json={"command": ["python", "-V"]}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert command.status_code == 200
        assert command.json() == {
            "exit_code": 0,
            "stdout": "test output",
            "stderr": "",
            "truncated": False,
            "timed_out": False,
            "duration_seconds": 0.01,
        }
        write = client.post(f"/sandboxes/{run_a}/files/write", json={"path": "hello.txt", "content": "hello"}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert write.status_code == 200
        assert write.json() == {"path": "hello.txt", "bytes_written": 5}
        read = client.post(f"/sandboxes/{run_a}/files/read", json={"path": "hello.txt"}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert read.status_code == 200
        assert read.json() == {"path": "hello.txt", "content": "hello", "truncated": False}
        listing = client.post(f"/sandboxes/{run_a}/files/list", json={"path": "."}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert listing.status_code == 200
        assert listing.json()["files"][0]["path"] == "hello.txt"
        traversal = client.post(f"/sandboxes/{run_a}/files/read", json={"path": "../secret"}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert traversal.status_code == 422
        cross_run = client.post(f"/sandboxes/{run_b}/files/read", json={"path": "hello.txt"}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert cross_run.status_code == 403
        unsafe = client.post(f"/sandboxes/{run_a}/execute", json={"command": ["true"], "image": "attacker"}, headers={
            "Authorization": f"Bearer {token_a}"
        })
        assert unsafe.status_code == 422
        rejected_service_input = client.post("/sandboxes", json={
            "run_id": str(uuid.uuid4()), "profile": profile(), "image": "attacker", "network": "host"
        }, headers={"Authorization": f"Bearer {settings(data_dir).token}"})
        assert rejected_service_input.status_code == 422

        job = docker.containers.created[0]
        assert job.image == "project/sandbox-job:local"
        assert job.options["labels"]["ordivant.sandbox.owner"] == "ordivant-test"
        assert job.options["labels"]["ordivant.sandbox.run_id"] == run_a
        assert job.options["network_mode"] == "none"
        assert job.options["read_only"] is True
        assert job.options["cap_drop"] == ["ALL"]
        assert job.options["security_opt"] == ["no-new-privileges:true"]
        assert job.options["user"] == "10001:10001"
        assert job.options["pids_limit"] == 32
        assert job.options["nano_cpus"] == 500_000_000
        assert job.options["mem_limit"] == "128m"
        assert job.options["memswap_limit"] == "128m"
        assert "/workspace" in job.options["tmpfs"]
        assert "volumes" not in job.options and "mounts" not in job.options
        assert not any("token" in key.lower() for key in job.options["environment"])

        saved = json.loads((data_dir / f"{run_a}.json").read_text())
        assert "capability_sha256" in saved
        assert token_a not in json.dumps(saved)
        assert settings(data_dir).token not in json.dumps(saved)
        stopped = client.delete(f"/sandboxes/{run_a}", headers={"Authorization": f"Bearer {token_a}"})
        assert stopped.status_code == 200
        assert job.killed and job.removed


def test_paths_reject_traversal_and_symlink_components():
    for path in ("../outside", "a/../../outside", "/etc/passwd", "C:/secret", "a\\b", "a//b"):
        try:
            validate_relative_path(path)
        except ValueError:
            continue
        raise AssertionError(f"unsafe path was accepted: {path}")
    validate_relative_path(".", allow_dot=True)
    try:
        validate_relative_path(".")
    except ValueError:
        pass
    else:
        raise AssertionError("dot path must only be accepted for listing")


def test_profile_bounds_reject_unsafe_resource_values():
    valid = profile()["limits"]
    for field, value in (("memory_mb", 4096), ("workspace_mb", 1024), ("timeout_seconds", 121), ("pids_limit", 1000)):
        bad = dict(valid)
        bad[field] = value
        try:
            Limits.model_validate(bad)
        except Exception:
            continue
        raise AssertionError(f"unsafe {field} was accepted")

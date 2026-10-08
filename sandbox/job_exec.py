#!/usr/local/bin/python3
import base64
import json
import os
import selectors
import signal
import subprocess
import sys
import time


def main() -> int:
    started = time.monotonic()
    try:
        request = json.loads(base64.urlsafe_b64decode(sys.argv[1].encode("ascii")))
        command = request["command"]
        timeout = max(1, min(120, int(request["timeout_seconds"])))
        output_limit = max(1024, min(1048576, int(request["output_bytes"])))
        use_stdin = request.get("stdin", False)
        if not isinstance(use_stdin, bool):
            raise ValueError("stdin must be a boolean")
        if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
            raise ValueError("command must be a non-empty argument array")
        proc = subprocess.Popen(
            command,
            cwd="/workspace",
            env={
                "HOME": "/tmp",
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "LC_ALL": "C.UTF-8",
                "PYTHONNOUSERSITE": "1",
            },
            stdin=None if use_stdin else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            close_fds=True,
            start_new_session=True,
        )
        selector = selectors.DefaultSelector()
        assert proc.stdout is not None and proc.stderr is not None
        for name, stream in (("stdout", proc.stdout), ("stderr", proc.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        output = {"stdout": bytearray(), "stderr": bytearray()}
        total = 0
        deadline = started + timeout
        timed_out = False
        truncated = False
        killed_at: float | None = None
        while selector.get_map() or proc.poll() is None:
            now = time.monotonic()
            if now >= deadline and killed_at is None:
                timed_out = True
                killed_at = now
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            if proc.poll() is None and killed_at is not None and now - killed_at >= 1.0:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            wait = min(0.1, max(0.0, deadline - now)) if killed_at is None else 0.1
            for key, _ in selector.select(wait):
                try:
                    chunk = os.read(key.fileobj.fileno(), 8192)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(key.fileobj)
                    key.fileobj.close()
                    continue
                room = max(0, output_limit - total)
                kept = chunk[:room]
                output[key.data].extend(kept)
                total += len(kept)
                if len(kept) < len(chunk):
                    truncated = True
                    if proc.poll() is None and killed_at is None:
                        killed_at = time.monotonic()
                        try:
                            os.killpg(proc.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
            if total >= output_limit and proc.poll() is None and killed_at is None:
                truncated = True
                killed_at = time.monotonic()
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
        result = {
            "exit_code": 124 if timed_out else (proc.returncode if proc.returncode is not None else 1),
            "stdout": bytes(output["stdout"]).decode("utf-8", errors="replace"),
            "stderr": bytes(output["stderr"]).decode("utf-8", errors="replace"),
            "truncated": truncated,
            "timed_out": timed_out,
            "duration_seconds": round(time.monotonic() - started, 3),
        }
    except Exception as error:
        result = {
            "exit_code": 2,
            "stdout": "",
            "stderr": str(error)[:1000],
            "truncated": False,
            "timed_out": False,
            "duration_seconds": round(time.monotonic() - started, 3),
        }
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

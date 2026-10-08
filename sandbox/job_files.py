import json
import os
import stat
import sys

ROOT = "/workspace"
MAX_PATH = 4096
MAX_LIST_ITEMS = 1000
MAX_REQUEST_BYTES = 64 * 1024 * 1024


def parts(path: str, allow_dot: bool = False) -> list[str]:
    if not isinstance(path, str) or not path or len(path) > MAX_PATH or "\\" in path or "\x00" in path:
        raise ValueError("path must be a bounded relative POSIX path")
    if path == "." and allow_dot:
        return []
    values = path.split("/")
    if any(part in ("", ".", "..") for part in values) or path.startswith("/") or ":" in values[0]:
        raise ValueError("path must stay inside the run workspace")
    return values


def open_parent(path: str, create: bool = False) -> tuple[int, str]:
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        raise RuntimeError("filesystem does not support no-follow access")
    values = parts(path)
    descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in values[:-1]:
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | nofollow, dir_fd=descriptor)
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(part, 0o700, dir_fd=descriptor)
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | nofollow, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor, values[-1]
    except Exception:
        os.close(descriptor)
        raise


def write_file(request: dict[str, object]) -> dict[str, object]:
    target = request.get("path")
    content = request.get("content")
    if not isinstance(target, str) or not isinstance(content, str):
        raise ValueError("path and content are required")
    raw = content.encode("utf-8")
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("file content is too large")
    parent_fd, leaf = open_parent(target, create=True)
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0)
        output_fd = os.open(leaf, flags, 0o600, dir_fd=parent_fd)
        if not stat.S_ISREG(os.fstat(output_fd).st_mode):
            os.close(output_fd)
            raise ValueError("target is not a regular file")
        count = 0
        try:
            written = 0
            while written < len(raw):
                written += os.write(output_fd, raw[written:])
            count = written
        finally:
            os.close(output_fd)
        return {"path": target, "bytes_written": count}
    finally:
        os.close(parent_fd)


def read_file(request: dict[str, object]) -> dict[str, object]:
    target = request.get("path")
    limit = request.get("output_bytes")
    if not isinstance(target, str) or not isinstance(limit, int):
        raise ValueError("path and output limit are required")
    parent_fd, leaf = open_parent(target)
    try:
        fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0), dir_fd=parent_fd)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError("target is not a regular file")
            content = bytearray()
            while len(content) <= limit:
                chunk = os.read(fd, min(65536, limit + 1 - len(content)))
                if not chunk:
                    break
                content.extend(chunk)
        finally:
            os.close(fd)
    finally:
        os.close(parent_fd)
    truncated = len(content) > limit
    content = content[:limit]
    return {"path": target, "content": bytes(content).decode("utf-8", errors="replace"), "truncated": truncated}


def list_files(request: dict[str, object]) -> dict[str, object]:
    target = request.get("path", ".")
    if not isinstance(target, str):
        raise ValueError("path must be a string")
    relative = parts(target, allow_dot=True)
    current = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in relative:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = child
        entries = []
        truncated = False
        for entry in os.scandir(current):
            if len(entries) >= MAX_LIST_ITEMS:
                truncated = True
                break
            kind = "directory" if entry.is_dir(follow_symlinks=False) else "file" if entry.is_file(follow_symlinks=False) else "symlink"
            size = entry.stat(follow_symlinks=False).st_size if kind == "file" else 0
            entries.append({"path": f"{target}/{entry.name}" if target != "." else entry.name, "type": kind, "size": size})
        return {"path": target, "files": sorted(entries, key=lambda item: str(item["path"])), "truncated": truncated}
    finally:
        os.close(current)


def main() -> int:
    try:
        operation = sys.argv[1]
        if operation == "write":
            raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            if len(raw) > MAX_REQUEST_BYTES:
                raise ValueError("file request is too large")
            request = json.loads(raw)
        else:
            import base64

            request = json.loads(base64.urlsafe_b64decode(sys.argv[2].encode("ascii")))
        output_limit = int(request.get("output_bytes", 65536))
        if operation == "write":
            result = write_file(request)
        elif operation == "read":
            result = read_file(request)
        elif operation == "list":
            result = list_files(request)
        else:
            raise ValueError("unsupported file operation")
        response = {"ok": True, "result": result}
    except Exception as error:
        output_limit = 65536
        response = {"ok": False, "error": str(error)[:1000]}
    output = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
    result = response.get("result")
    while len(output.encode("utf-8")) > output_limit and isinstance(result, dict):
        if isinstance(result.get("content"), str):
            raw = result["content"].encode("utf-8")
            excess = max(1, len(output.encode("utf-8")) - output_limit)
            result["content"] = raw[:max(0, len(raw) - excess)].decode("utf-8", errors="ignore")
            result["truncated"] = True
        elif isinstance(result.get("files"), list) and result["files"]:
            result["files"].pop()
            result["truncated"] = True
        else:
            response = {"ok": False, "error": "sandbox output limit reached"}
            break
        output = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Initialize the Ordivant-local Gitea service credential."""

from __future__ import annotations

import json
import os
import re
import secrets
import stat
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


GITEA_URL = "http://gitea:3000"
GITEA_CONFIG = Path("/data/gitea/conf/app.ini")
GITEA_USER = "ordivant-local"
GITEA_EMAIL = "ordivant-local@example.invalid"
GITEA_UID = 1000
GITEA_GID = 1000
SCOPES = ["write:repository", "write:user"]
TOKEN_PATTERN = re.compile(r"^[a-fA-F0-9]{40,128}$")
HEX_64_PATTERN = re.compile(r"^[a-fA-F0-9]{64}$")


class InitializationError(Exception):
    """An error whose message never includes credential material."""


def _ensure_secrets_directory(directory: Path) -> None:
    try:
        try:
            directory.lstat()
        except FileNotFoundError:
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode):
            raise InitializationError("Secrets path must be a real directory.")
        if os.chmod in os.supports_follow_symlinks:
            os.chmod(directory, 0o700, follow_symlinks=False)
        else:
            os.chmod(directory, 0o700)
    except InitializationError:
        raise
    except OSError:
        raise InitializationError("Could not secure the secrets directory.") from None


def _read_existing_config(directory: Path) -> tuple[str | None, os.stat_result | None]:
    path = directory / "gitea.json"
    try:
        before = path.lstat()
    except FileNotFoundError:
        return None, None
    except OSError:
        raise InitializationError("Could not inspect the existing Gitea configuration.") from None
    if not stat.S_ISREG(before.st_mode):
        raise InitializationError("Existing Gitea configuration must be a regular, non-symlink file.")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        raise InitializationError("Could not safely read the existing Gitea configuration.") from None
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise InitializationError("Existing Gitea configuration changed while being checked.")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            data = stream.read()
    except OSError:
        raise InitializationError("Could not safely read the existing Gitea configuration.") from None
    finally:
        os.close(descriptor)

    try:
        return data.decode("utf-8"), before
    except UnicodeDecodeError:
        raise InitializationError("Existing Gitea configuration must be valid UTF-8 JSON.") from None


def _parse_config(raw: str | None) -> dict | None:
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeError):
        raise InitializationError("Existing Gitea configuration is invalid; refusing to rotate its credential.") from None
    if not isinstance(value, dict):
        raise InitializationError("Existing Gitea configuration is invalid; refusing to rotate its credential.")
    if value == {}:
        return None

    if set(value) != {"url", "token", "webhook_secret", "scopes"}:
        raise InitializationError("Existing Gitea configuration is foreign; refusing to rotate its credential.")
    if (
        value.get("url") != GITEA_URL
        or not isinstance(value.get("token"), str)
        or TOKEN_PATTERN.fullmatch(value["token"]) is None
        or not isinstance(value.get("webhook_secret"), str)
        or HEX_64_PATTERN.fullmatch(value["webhook_secret"]) is None
        or value.get("scopes") != SCOPES
    ):
        raise InitializationError("Existing Gitea configuration is incomplete or foreign; refusing to rotate its credential.")
    return value


def _run_gitea(*arguments: str) -> subprocess.CompletedProcess[str]:
    command = ["gitea", "--config", str(GITEA_CONFIG), *arguments]
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
            user=GITEA_UID,
            group=GITEA_GID,
        )
    except Exception:
        raise InitializationError("Gitea command failed; credential output was suppressed.") from None
    if result.returncode != 0:
        raise InitializationError("Gitea command failed; credential output was suppressed.")
    return result


def _verify_token(token: str) -> bool:
    request = urllib.request.Request(
        GITEA_URL + "/api/v1/user",
        headers={"Authorization": "token " + token, "Accept": "application/json"},
        method="GET",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=5) as response:
            if response.status != 200:
                return False
            user = json.loads(response.read())
    except Exception:
        return False
    return isinstance(user, dict) and user.get("login") == GITEA_USER


def _write_exclusive(path: Path, contents: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, 0o644)
    except OSError:
        raise InitializationError("Could not create the Gitea configuration file.") from None

    closed = False
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o644)
        offset = 0
        while offset < len(contents):
            written = os.write(descriptor, contents[offset:])
            if written <= 0:
                raise OSError("short write")
            offset += written
        os.fsync(descriptor)
    except OSError:
        try:
            os.close(descriptor)
        except OSError:
            pass
        closed = True
        try:
            path.unlink()
        except OSError:
            pass
        raise InitializationError("Could not write the Gitea configuration file.") from None
    finally:
        if not closed:
            try:
                os.close(descriptor)
            except OSError:
                pass


def _store_config(directory: Path, configuration: dict, old_stat: os.stat_result | None) -> None:
    target = directory / "gitea.json"
    payload = (json.dumps(configuration, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if old_stat is None:
        _write_exclusive(target, payload)
        return

    temporary = directory / (".gitea.json." + secrets.token_hex(8) + ".tmp")
    _write_exclusive(temporary, payload)
    try:
        current = target.lstat()
        if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (
            old_stat.st_dev,
            old_stat.st_ino,
        ):
            raise InitializationError("Existing Gitea configuration changed; refusing to replace it.")
        with target.open("rb") as stream:
            if json.loads(stream.read()) != {}:
                raise InitializationError("Existing Gitea configuration changed; refusing to replace it.")
        os.replace(temporary, target)
    except InitializationError:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise InitializationError("Could not safely store the Gitea configuration.") from None


def _existing_user() -> bool:
    result = _run_gitea("admin", "user", "list")
    return re.search(r"(?m)^\s*\d+\s+ordivant-local(?:\s|$)", result.stdout) is not None


def initialize(directory: str | Path = "/secrets") -> bool:
    secrets_dir = Path(directory)
    _ensure_secrets_directory(secrets_dir)
    raw_config, old_stat = _read_existing_config(secrets_dir)
    existing = _parse_config(raw_config)

    if existing is not None:
        if not _verify_token(existing["token"]):
            raise InitializationError("Could not verify the existing Gitea credential; refusing to rotate it.")
        path = secrets_dir / "gitea.json"
        try:
            if os.chmod in os.supports_follow_symlinks:
                os.chmod(path, 0o644, follow_symlinks=False)
            else:
                os.chmod(path, 0o644)
        except OSError:
            raise InitializationError("Could not make the verified Gitea configuration readable by its service.") from None
        return False

    if not _existing_user():
        _run_gitea(
            "admin",
            "user",
            "create",
            "--username",
            GITEA_USER,
            "--email",
            GITEA_EMAIL,
            "--admin",
            "--random-password",
            "--random-password-length",
            "40",
            "--must-change-password=false",
        )

    token_result = _run_gitea(
        "admin",
        "user",
        "generate-access-token",
        "--username",
        GITEA_USER,
        "--token-name",
        "ordivant-code-" + secrets.token_hex(4),
        "--scopes",
        ",".join(SCOPES),
        "--raw",
    )
    tokens = [line.strip() for line in token_result.stdout.splitlines() if TOKEN_PATTERN.fullmatch(line.strip())]
    if len(tokens) != 1:
        raise InitializationError("Gitea did not return exactly one service token; credential output was suppressed.")

    configuration = {
        "url": GITEA_URL,
        "token": tokens[0],
        "webhook_secret": secrets.token_hex(32),
        "scopes": SCOPES,
    }
    if not _verify_token(configuration["token"]):
        raise InitializationError("Generated Gitea credential could not be verified; credential output was suppressed.")

    _store_config(secrets_dir, configuration, old_stat)
    return True


def main() -> int:
    try:
        created = initialize()
    except InitializationError as exc:
        print(f"gitea-init: {exc}", file=sys.stderr)
        return 1
    except Exception:
        print("gitea-init: initialization failed; credential output was suppressed.", file=sys.stderr)
        return 1

    if created:
        print("Gitea service integration initialized.")
    else:
        print("Existing Gitea service integration verified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

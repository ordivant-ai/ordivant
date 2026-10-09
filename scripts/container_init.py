#!/usr/bin/env python3
"""Create Ordivant Compose service credentials without replacing existing files."""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import stat
import sys
from pathlib import Path


PRODUCTS = ("work", "knowledge", "code", "identity")
TOKEN_FILES = (
    "identity_service_token",
    "dev_proxy_token",
    "sandbox_service_token",
    "identity_broker_db_password",
)
HEX_SECRET = re.compile(r"^[a-fA-F0-9]{64}$")


class InitializationError(Exception):
    """A safe-to-display configuration or filesystem error."""


def _read_existing(directory: Path, name: str) -> str | None:
    path = directory / name
    try:
        before = path.lstat()
    except FileNotFoundError:
        return None
    except OSError:
        raise InitializationError(f"Cannot inspect '{name}'.") from None

    if not stat.S_ISREG(before.st_mode):
        raise InitializationError(f"'{name}' must be a regular, non-symlink file.")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        raise InitializationError(f"Cannot safely open '{name}'.") from None

    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (
            before.st_dev,
            before.st_ino,
        ):
            raise InitializationError(f"'{name}' changed while it was being checked.")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            contents = stream.read()
    except OSError:
        raise InitializationError(f"Cannot safely read '{name}'.") from None
    finally:
        os.close(descriptor)

    try:
        return contents.decode("utf-8")
    except UnicodeDecodeError:
        raise InitializationError(f"'{name}' must be UTF-8 text.") from None


def _database_url_password(value: str, product: str) -> str:
    prefix = "postgresql+psycopg://ordivant:"
    suffix = f"@{product}-db:5432/ordivant"
    value = value.strip()
    if not value.startswith(prefix) or not value.endswith(suffix):
        raise InitializationError(f"Stored database URL '{product}_database_url' is invalid.")
    password = value[len(prefix) : -len(suffix)]
    if not HEX_SECRET.fullmatch(password):
        raise InitializationError(f"Stored database URL '{product}_database_url' is invalid.")
    return password


def _validate_hex(value: str, name: str) -> str:
    value = value.strip()
    if not HEX_SECRET.fullmatch(value):
        raise InitializationError(f"Stored service secret '{name}' is invalid; refusing to replace it.")
    return value


def _prepare_directory(directory: Path) -> None:
    try:
        try:
            directory.lstat()
        except FileNotFoundError:
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = directory.lstat()
    except OSError:
        raise InitializationError("Cannot prepare the secrets directory.") from None
    if not stat.S_ISDIR(info.st_mode):
        raise InitializationError("The secrets path must be a real directory.")
    try:
        if os.chmod in os.supports_follow_symlinks:
            os.chmod(directory, 0o700, follow_symlinks=False)
        else:
            os.chmod(directory, 0o700)
    except OSError:
        raise InitializationError("Cannot secure the secrets directory.") from None


def _write_new(directory: Path, name: str, value: str, mode: int = 0o644) -> None:
    path = directory / name
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags, mode)
    except FileExistsError:
        raise InitializationError(f"'{name}' appeared during initialization; refusing to replace it.") from None
    except OSError:
        raise InitializationError(f"Cannot create '{name}'.") from None

    created_stat = os.fstat(descriptor)
    closed = False
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, mode)
        payload = value.encode("utf-8")
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
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
            current = path.lstat()
            if (current.st_dev, current.st_ino) == (created_stat.st_dev, created_stat.st_ino):
                path.unlink()
        except OSError:
            pass
        raise InitializationError(f"Cannot write '{name}'.") from None
    finally:
        if not closed:
            try:
                os.close(descriptor)
            except OSError:
                pass


def initialize(directory: str | Path) -> None:
    secrets_dir = Path(directory)
    _prepare_directory(secrets_dir)

    names = [
        name
        for product in PRODUCTS
        for name in (f"{product}_db_password", f"{product}_database_url")
    ]
    names.extend(TOKEN_FILES)
    names.append("gitea.json")

    # Read and validate every existing file before generating or writing anything.
    existing = {name: _read_existing(secrets_dir, name) for name in names}
    passwords: dict[str, str | None] = {}
    url_passwords: dict[str, str | None] = {}

    for product in PRODUCTS:
        password_name = f"{product}_db_password"
        url_name = f"{product}_database_url"
        stored_password = existing[password_name]
        stored_url = existing[url_name]

        password = _validate_hex(stored_password, password_name) if stored_password is not None else None
        url_password = _database_url_password(stored_url, product) if stored_url is not None else None
        if password is not None and url_password is not None and password != url_password:
            raise InitializationError(
                f"Stored database URL '{url_name}' does not match its service password; refusing to replace it."
            )
        passwords[product] = password
        url_passwords[product] = url_password

    for name in TOKEN_FILES:
        if existing[name] is not None:
            _validate_hex(existing[name], name)

    gitea_config = existing["gitea.json"]
    if gitea_config is not None:
        try:
            parsed_gitea = json.loads(gitea_config)
        except (json.JSONDecodeError, UnicodeError):
            raise InitializationError("Stored 'gitea.json' must contain valid JSON.") from None
        if not isinstance(parsed_gitea, dict):
            raise InitializationError("Stored 'gitea.json' must contain a JSON object.")

    for name, value in existing.items():
        if value is None:
            continue
        path = secrets_dir / name
        try:
            if os.chmod in os.supports_follow_symlinks:
                os.chmod(path, 0o644, follow_symlinks=False)
            else:
                os.chmod(path, 0o644)
        except OSError:
            raise InitializationError(f"Cannot make stored file '{name}' readable by its service.") from None

    planned: dict[str, str] = {}
    for product in PRODUCTS:
        password_name = f"{product}_db_password"
        url_name = f"{product}_database_url"
        password = passwords[product] or url_passwords[product] or secrets.token_hex(32)
        expected_url = f"postgresql+psycopg://ordivant:{password}@{product}-db:5432/ordivant"

        if existing[password_name] is None:
            planned[password_name] = password
        if existing[url_name] is None:
            planned[url_name] = expected_url

    for name in TOKEN_FILES:
        if existing[name] is None:
            planned[name] = secrets.token_hex(32)
    if existing["gitea.json"] is None:
        planned["gitea.json"] = "{}\n"

    for name in names:
        if name in planned:
            _write_new(secrets_dir, name, planned[name])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Initialize Ordivant Docker Compose service secrets.")
    parser.add_argument("directory", nargs="?", default="/secrets", help="writable secrets directory")
    args = parser.parse_args(argv)

    try:
        initialize(args.directory)
    except InitializationError as exc:
        print(f"container-init: {exc}", file=sys.stderr)
        return 1
    except Exception:
        print("container-init: initialization failed; no secret values were displayed.", file=sys.stderr)
        return 1

    print("Container service secrets are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

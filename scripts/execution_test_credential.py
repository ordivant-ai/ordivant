"""Read a credential only from the explicitly selected file, into memory."""

from __future__ import annotations

from pathlib import Path

from configure_test_model import load_test_provider_config


def read_authorized_test_key(key_file: Path | None = None) -> str:
    config = load_test_provider_config(key_file)
    try:
        value = config.key_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("authorized_test_credential_unavailable") from exc
    if not value:
        raise RuntimeError("authorized_test_credential_empty")
    return value

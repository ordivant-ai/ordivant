"""Import an explicitly configured acceptance connection through an isolated Work container.

This is a host administration command, not a public HTTP authorization shortcut.
It uses Docker's trusted exec boundary and preserves the user's Identity accounts.
The provider key travels on stdin, never as a process argument or in stdout.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

DEFAULT_PROVIDER_ID = "acceptance-provider"


class ConfigurationError(RuntimeError):
    pass


def _required_value(name: str, value: str | None) -> str:
    if value is None or not value.strip():
        raise ConfigurationError(f"{name} is required for live acceptance")
    return value.strip()


def _validate_project(value: str) -> str:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}-qa", value):
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_PROJECT must be a lowercase isolated Compose project ending in -qa")
    return value


def _validate_identifier(name: str, value: str, max_length: int) -> str:
    if len(value) > max_length or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]*", value):
        raise ConfigurationError(f"{name} is invalid")
    return value


def _validate_provider_base(value: str) -> str:
    if any(char.isspace() or ord(char) < 32 for char in value) or "?" in value or "#" in value:
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_BASE must be an HTTPS base URL without query or fragment")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError as exc:
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_BASE is invalid") from exc
    if (parsed.scheme != "https" or not hostname or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment):
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_BASE must be an HTTPS base URL without credentials, query, or fragment")
    host = hostname.rstrip(".").lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_BASE cannot use an IP literal")
    if (host == "localhost" or host.endswith(".localhost") or host in {"example", "example.com", "example.net", "example.org", "example.invalid"}
            or any(host.endswith(suffix) for suffix in (".example", ".example.com", ".example.net", ".example.org", ".example.invalid"))
            or any(marker in host for marker in ("your-domain", "yourdomain", "placeholder", "changeme"))):
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_BASE cannot use a placeholder or local host")
    if not re.fullmatch(r"[a-z0-9.-]+", host) or host.startswith(".") or host.endswith("."):
        raise ConfigurationError("ORDIVANT_TEST_PROVIDER_BASE host is invalid")
    return value.rstrip("/")


class TestProviderConfig:
    def __init__(self, project: str, provider_id: str, base_url: str, model: str, key_file: Path):
        self.project = project
        self.provider_id = provider_id
        self.base_url = base_url
        self.model = model
        self.key_file = key_file

    @property
    def selection(self) -> dict:
        return {"provider_id": self.provider_id, "model_id": self.model,
                "reasoning_effort": "low", "max_output_tokens": 4096}


def load_test_provider_config(key_file_override: Path | None = None) -> TestProviderConfig:
    project = _validate_project(_required_value("ORDIVANT_TEST_PROVIDER_PROJECT", os.environ.get("ORDIVANT_TEST_PROVIDER_PROJECT")))
    provider_id = os.environ.get("ORDIVANT_TEST_PROVIDER_ID", DEFAULT_PROVIDER_ID).strip() or DEFAULT_PROVIDER_ID
    provider_id = _validate_identifier("ORDIVANT_TEST_PROVIDER_ID", provider_id, 120)
    base_url = _validate_provider_base(_required_value("ORDIVANT_TEST_PROVIDER_BASE", os.environ.get("ORDIVANT_TEST_PROVIDER_BASE")))
    model = _validate_identifier("ORDIVANT_TEST_PROVIDER_MODEL",
                                 _required_value("ORDIVANT_TEST_PROVIDER_MODEL", os.environ.get("ORDIVANT_TEST_PROVIDER_MODEL")), 200)
    key_value = str(key_file_override) if key_file_override is not None else os.environ.get("ORDIVANT_TEST_PROVIDER_KEY_FILE")
    key_file = Path(_required_value("ORDIVANT_TEST_PROVIDER_KEY_FILE", key_value)).expanduser()
    return TestProviderConfig(project, provider_id, base_url, model, key_file)

_IMPORT = """
import json, sys
from pathlib import Path
from sqlalchemy import select
from ordivant.db import SessionLocal
from ordivant.models import ModelProviderSetting, OrganizationModelSetting
from ordivant.model_settings import import_model_settings
from ordivant.schemas import ModelSettingsPut
from ordivant.security import authenticate_header
try:
    supplied = json.load(sys.stdin)
    bootstrap = json.loads(Path('/data/bootstrap.json').read_text())
    with SessionLocal() as session:
        principal = authenticate_header(session, 'Bearer ' + bootstrap['manager_token'])
        setting = session.get(OrganizationModelSetting, principal.organization_id)
        providers = [{
            'id': row.provider_id, 'name': row.name, 'base_url': row.base_url,
            'enabled': row.enabled, 'models': json.loads(row.models_json)
        } for row in session.scalars(select(ModelProviderSetting).where(
            ModelProviderSetting.organization_id == principal.organization_id
        )) if row.provider_id != supplied['provider']['id']]
        providers.append(supplied['provider'])
        body = ModelSettingsPut.model_validate({
            'revision': setting.revision if setting else 0,
            'providers': providers, 'default': supplied['default']
        }).model_dump()
        result = import_model_settings(session, principal.organization_id, body)
        session.commit()
        print(json.dumps(result, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({'error': type(exc).__name__, 'message': 'Operator import failed; credential-bearing details suppressed'}))
    sys.exit(1)
"""


def configure(key_file: Path | None = None) -> dict:
    config = load_test_provider_config(key_file)
    container = config.project + "-work-api-1"
    label = subprocess.run(
        ["docker", "inspect", "--format", '{{ index .Config.Labels "com.docker.compose.project" }}', container],
        text=True, encoding="utf-8", capture_output=True, timeout=15,
    )
    if label.returncode or label.stdout.strip() != config.project:
        raise RuntimeError("The configured isolated Work container is unavailable")
    try:
        key = config.key_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Provider credential file could not be read") from exc
    if not key:
        raise RuntimeError("Provider credential is unavailable")
    payload = {"provider": {
        "id": config.provider_id, "name": "Acceptance provider", "base_url": config.base_url,
        "api_key": key, "enabled": True, "models": [{
            "id": config.model, "name": config.model, "context_window": 4096,
            "max_output_tokens": 4096, "reasoning_efforts": ["low"],
        }],
    }, "default": config.selection}
    imported = subprocess.run(
        ["docker", "exec", "-i", container, "python", "-c", _IMPORT],
        input=json.dumps(payload), text=True, encoding="utf-8", capture_output=True, timeout=30,
    )
    if imported.returncode:
        raise RuntimeError("Server operator import failed; credential-bearing output suppressed")
    if key in imported.stdout or key in imported.stderr:
        raise RuntimeError("Server operator import returned a credential; output suppressed")
    return json.loads(imported.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", type=Path, help="Explicit credential file override; otherwise use ORDIVANT_TEST_PROVIDER_KEY_FILE")
    args = parser.parse_args()
    try:
        config = load_test_provider_config(args.key_file)
        result = configure(args.key_file)
        print(f"TEST_MODEL_CONFIGURED: {config.model}; revision={result['revision']}; key_configured=true")
        return 0
    except (RuntimeError, OSError) as exc:
        print(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

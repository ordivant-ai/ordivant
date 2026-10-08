"""Paid acceptance must never inherit a maintainer's private environment."""
import importlib
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from configure_test_model import ConfigurationError, load_test_provider_config
from execution_test_credential import read_authorized_test_key


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
    import os
    for name in list(os.environ):
        if name.startswith('ORDIVANT_TEST_PROVIDER_'):
            monkeypatch.delenv(name)


def configure(monkeypatch, tmp_path):
    key = tmp_path / 'synthetic.key'
    key.write_text('synthetic-acceptance-credential', encoding='utf-8')
    for name, value in {
        'PROJECT': 'ordivant-model-qa',
        'BASE': 'https://provider.company.invalid/v1',
        'MODEL': 'synthetic-model',
        'KEY_FILE': str(key),
    }.items():
        monkeypatch.setenv('ORDIVANT_TEST_PROVIDER_' + name, value)
    return key


def test_missing_configuration_fails_closed():
    with pytest.raises(ConfigurationError):
        load_test_provider_config()


@pytest.mark.parametrize('field,value', [
    ('PROJECT', 'ordivant-prod'),
    ('PROJECT', 'ordivant-dev'),
    ('PROJECT', '../customer-qa'),
    ('BASE', 'http://provider.company.invalid/v1'),
    ('BASE', 'https://user:secret@provider.company.invalid/v1'),
    ('BASE', 'https://provider.company.invalid/v1?api_key=secret'),
    ('BASE', 'https://127.0.0.1/v1'),
    ('BASE', 'https://localhost/v1'),
    ('BASE', 'https://api.example.com/v1'),
])
def test_unsafe_or_placeholder_targets_rejected(monkeypatch, tmp_path, field, value):
    configure(monkeypatch, tmp_path)
    monkeypatch.setenv('ORDIVANT_TEST_PROVIDER_' + field, value)
    with pytest.raises(ConfigurationError):
        load_test_provider_config()


def test_key_is_read_only_from_explicit_file(monkeypatch, tmp_path):
    key = configure(monkeypatch, tmp_path)
    config = load_test_provider_config()
    assert config.project == 'ordivant-model-qa'
    assert config.key_file == key
    assert read_authorized_test_key() == 'synthetic-acceptance-credential'
    key.unlink()
    with pytest.raises(RuntimeError):
        read_authorized_test_key()


def test_importing_acceptance_does_not_read_credentials_or_run_docker(monkeypatch):
    import subprocess
    def forbidden(*args, **kwargs):
        raise AssertionError('import attempted an external operation')
    monkeypatch.setattr(subprocess, 'run', forbidden)
    for name in ('configure_test_model', 'execution_test_credential', 'live_model_acceptance',
                 'live_model_record_checks', 'model_probe', 'execution_live_acceptance', 'execution_record_checks'):
        importlib.reload(importlib.import_module(name))

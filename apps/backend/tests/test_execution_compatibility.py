"""Portable, secret-free release identity for persisted execution manifests."""

import json
import shutil
from pathlib import Path

import pytest

from formlane import durable_execution
from formlane.durable_execution import compatibility_manifest
from formlane.settings import Settings


@pytest.fixture
def installed_package(tmp_path, monkeypatch):
    source = Path(durable_execution.__file__).parent
    target = tmp_path / "relocated" / "formlane"
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    monkeypatch.setattr(durable_execution, "__file__", str(target / "durable_execution.py"))
    return target


def test_manifest_is_portable_and_ignores_credentials_and_generated_caches(
    tmp_path, monkeypatch
):
    settings = Settings(
        database_url="postgresql+psycopg://db-user:db-password@localhost/formlane_test",
        openai_api_key="provider-key-never-recorded",
        endpoint="https://url-user:url-password@provider.example/v1?token=query-secret#fragment-secret",
        model="test",
    )
    original = compatibility_manifest(settings)
    source = Path(durable_execution.__file__).parent
    target = tmp_path / "different-install-location" / "formlane"
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    cache = target / "delivery" / "__pycache__"
    cache.mkdir()
    (cache / "hooks.cpython-313.pyc").write_bytes(b"machine-specific bytecode")
    (cache / "generated.py").write_text("generated = True\n")
    (target / ".local.yaml").write_text("secret: private-machine-setting\n")
    monkeypatch.setattr(durable_execution, "__file__", str(target / "durable_execution.py"))
    relocated = compatibility_manifest(settings)
    assert relocated == original
    assert list(relocated["source"]) == sorted(relocated["source"])
    assert relocated["version"] == "flow-v3"
    assert relocated["endpoint"] == ["https", "provider.example", None, "/v1"]
    serialized = json.dumps(relocated)
    for private in (
        "db-user",
        "db-password",
        "provider-key-never-recorded",
        "url-user",
        "url-password",
        "query-secret",
        "fragment-secret",
        "private-machine-setting",
        str(source),
        str(target),
    ):
        assert private not in serialized
    rotated = settings.model_copy(
        update={
            "openai_api_key": "rotated-provider-key",
            "endpoint": "https://new-user:new-password@provider.example/v1?new=query#new",
        }
    )
    assert compatibility_manifest(rotated) == original


@pytest.mark.parametrize("resource", ["extension.py", "policy.yaml", "policy.yml", "contract.txt"])
def test_added_changed_and_removed_packaged_sources_change_release_identity(
    installed_package, resource
):
    settings = Settings(database_url="postgresql+psycopg://localhost/formlane_test")
    before = compatibility_manifest(settings)
    path = installed_package / "delivery" / "resources" / resource
    path.write_text("first packaged revision\n")
    added = compatibility_manifest(settings)
    assert added != before
    path.write_text("second packaged revision\n")
    changed = compatibility_manifest(settings)
    assert changed != added
    path.unlink()
    assert compatibility_manifest(settings) == before

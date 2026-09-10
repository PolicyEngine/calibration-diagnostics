"""Runtime identity must be observable without resolving or loading a population."""

import importlib
from pathlib import Path

import pytest


@pytest.fixture
def runtime_modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return importlib.import_module("scripts.runtime_identity")


def test_identity_reports_installed_packages_and_missing_optional_packages(
    runtime_modules, monkeypatch
):
    runtime = runtime_modules
    installed = {"policyengine-us": "1.752.2", "spm-calculator": "0.3.1"}

    def version(name):
        if name not in installed:
            raise runtime.metadata.PackageNotFoundError(name)
        return installed[name]

    monkeypatch.setattr(runtime.metadata, "version", version)
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "observed-deployment-sha")
    identity = runtime.runtime_identity()

    assert identity["packages"]["policyengine-us"] == "1.752.2"
    assert identity["packages"]["spm-calculator"] == "0.3.1"
    assert identity["packages"]["policyengine"] is None
    assert identity["source_commit"] == "observed-deployment-sha"


def test_modal_source_identity_is_the_packaged_backend_commit(
    runtime_modules, monkeypatch
):
    monkeypatch.setenv("CALIBRATION_SOURCE_COMMIT", "packaged-backend-commit")
    monkeypatch.setenv("CALIBRATION_SOURCE_TREE_SHA256", "packaged-tree-digest")
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "different-frontend-commit")
    identity = runtime_modules.runtime_identity()
    assert identity["source_commit"] == "packaged-backend-commit"
    assert identity["source_tree_sha256"] == "packaged-tree-digest"

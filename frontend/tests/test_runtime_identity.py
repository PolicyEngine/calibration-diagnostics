"""Runtime identity must be observable without resolving or loading a population."""

import importlib
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def runtime_modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return (
        importlib.import_module("scripts.runtime_identity"),
        importlib.import_module("api.microcosm_variable"),
    )


def test_identity_reports_installed_packages_and_missing_optional_packages(
    runtime_modules, monkeypatch
):
    runtime, _ = runtime_modules
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


def test_metadata_request_never_resolves_or_calculates_data(
    runtime_modules, monkeypatch
):
    _, endpoint = runtime_modules

    def forbidden(*args, **kwargs):
        pytest.fail("A metadata request must not resolve or calculate a population")

    monkeypatch.setattr(endpoint, "calculate_variables", forbidden)
    monkeypatch.setenv("POPULACE_HF_REVISION", "configured-revision")
    responses = []
    monkeypatch.setattr(
        endpoint,
        "_json_response",
        lambda handler, status, body: responses.append((status, body)),
    )

    endpoint.handler.do_GET(SimpleNamespace(path="/api/microcosm_variable?metadata=1"))

    status, body = responses[0]
    assert status == 200
    assert "policyengine-us" in body["runtime"]["packages"]
    assert body["environment_configuration"]["revision"] == "configured-revision"
    assert (
        body["data_configuration"]["hf_revision"]
        == "f09f2f3b9fa8409642dc0c7fc9c8f7516ae0e3c5"
    )
    assert "verified" not in body["data_configuration"]
    assert "release_id" not in body


def test_empty_calculation_still_returns_validation_error(runtime_modules, monkeypatch):
    _, endpoint = runtime_modules
    responses = []
    monkeypatch.setattr(
        endpoint,
        "_json_response",
        lambda handler, status, body: responses.append((status, body)),
    )

    endpoint.handler.do_GET(SimpleNamespace(path="/api/microcosm_variable"))

    assert responses == [
        (400, {"detail": "Enter at least one PolicyEngine variable name."})
    ]


@pytest.mark.parametrize(
    ("query", "status"),
    [
        ("release=", 400),
        ("period=", 400),
        ("release=latest", 409),
        ("period=2026", 409),
    ],
)
def test_invalid_selection_does_not_default_or_calculate(
    runtime_modules, monkeypatch, query, status
):
    _, endpoint = runtime_modules
    monkeypatch.delenv("POPULACE_HF_REPO", raising=False)
    monkeypatch.delenv("POPULACE_HF_REVISION", raising=False)
    monkeypatch.setattr(
        endpoint, "calculate_variables", lambda **kwargs: pytest.fail("No calculation")
    )
    responses = []
    monkeypatch.setattr(
        endpoint,
        "_json_response",
        lambda handler, code, body: responses.append((code, body)),
    )
    endpoint.handler.do_GET(
        SimpleNamespace(path=f"/api/microcosm_variable?variable=snap&{query}")
    )
    assert responses[0][0] == status

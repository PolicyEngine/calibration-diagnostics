"""The relocated HTTP boundary preserves validation before expensive execution."""

import importlib
from pathlib import Path

import pytest


@pytest.fixture
def endpoint(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]))
    module = importlib.import_module("backend.variable_endpoint")
    monkeypatch.delenv("POPULACE_HF_REPO", raising=False)
    monkeypatch.delenv("POPULACE_HF_REVISION", raising=False)
    return module


@pytest.mark.parametrize(
    ("query", "status"),
    [
        ("", 400),
        ("variable=snap&period=", 400),
        ("variable=snap&period=2026", 409),
        ("variable=snap&release=latest", 409),
        ("variable=snap&release=", 400),
        ("variable=../../snap", 400),
    ],
)
def test_invalid_request_cannot_start_population(endpoint, monkeypatch, query, status):
    monkeypatch.setattr(
        endpoint, "calculate_variables", lambda **kwargs: pytest.fail("No population")
    )
    response_status, body = endpoint.handle_query(query)
    assert response_status == status
    assert isinstance(body["detail"], str)


def test_metadata_is_configuration_not_calculation(endpoint, monkeypatch):
    monkeypatch.setattr(
        endpoint, "calculate_variables", lambda **kwargs: pytest.fail("No population")
    )
    status, body = endpoint.handle_query("metadata=1")
    assert status == 200
    assert body["data_configuration"]["packages"]["policyengine-us"] == "1.764.6"
    assert "verified" not in body["data_configuration"]
    assert "data_identity" not in body


def test_metadata_validates_the_deployment_data_configuration(endpoint, monkeypatch):
    """A stale override is visible here, so the metadata gate must refuse it."""
    monkeypatch.setattr(
        endpoint, "calculate_variables", lambda **kwargs: pytest.fail("No population")
    )
    reviewed = endpoint.reviewed_release()
    status, body = endpoint.handle_query("metadata=1")
    assert status == 200
    assert body["environment_configuration"] == {
        "repo": reviewed["repo"],
        "revision": reviewed["hf_revision"],
        "filename": reviewed["filename"],
    }
    for variable, value in (
        ("POPULACE_HF_REPO", "policyengine/unreviewed-override-fixture"),
        ("POPULACE_HF_REVISION", "main"),
    ):
        monkeypatch.setenv(variable, value)
        stale_status, stale_body = endpoint.handle_query("metadata=1")
        # Every calculation would answer 503; metadata must not report health.
        assert stale_status == 503
        assert "conflicts with the reviewed value" in stale_body["detail"]
        monkeypatch.delenv(variable)


def test_calculation_uses_immutable_revision_and_preserves_response(
    endpoint, monkeypatch
):
    seen = []
    result = {"weighted_sum": 123.5, "data_identity": {"verified": True}}

    def calculate(**kwargs):
        seen.append(kwargs)
        return result

    monkeypatch.setattr(endpoint, "calculate_variables", calculate)
    status, body = endpoint.handle_query(
        "variables=snap,snap&variable=spm_unit_spm_threshold"
    )
    assert status == 200
    assert body is result
    assert seen[0]["variables"] == ["snap", "spm_unit_spm_threshold"]
    assert seen[0]["period"] == "2024"
    assert seen[0]["hf_revision"] == "f09f2f3b9fa8409642dc0c7fc9c8f7516ae0e3c5"


def test_typed_calculation_error_survives_transport(endpoint, monkeypatch):
    def unavailable(**kwargs):
        raise endpoint.VariableCalculationError(
            "Reviewed data unavailable", status_code=503
        )

    monkeypatch.setattr(endpoint, "calculate_variables", unavailable)
    assert endpoint.handle_query("variable=snap") == (
        503,
        {"detail": "Reviewed data unavailable"},
    )


def test_parallel_http_calls_serialize_mutable_native_simulation(endpoint, monkeypatch):
    import time
    from concurrent.futures import ThreadPoolExecutor

    active = 0
    peak = 0

    def calculate(**kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        time.sleep(0.03)
        active -= 1
        return {"value": 1}

    monkeypatch.setattr(endpoint, "calculate_variables", calculate)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(endpoint.handle_query, ["variable=snap"] * 2))
    assert results == [(200, {"value": 1})] * 2
    assert peak == 1


def test_actual_asgi_transport_preserves_status_and_no_store(endpoint, monkeypatch):
    from fastapi.testclient import TestClient

    from backend.app import app

    monkeypatch.setattr(
        endpoint, "calculate_variables", lambda **kwargs: pytest.fail("No population")
    )
    with TestClient(app) as client:
        response = client.get("/api/microcosm_variable?variable=snap&period=")
        assert response.status_code == 400
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == {"detail": "Period must be a four-digit year."}

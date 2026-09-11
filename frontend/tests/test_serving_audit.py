"""Serving audit stays in the real private handler and never starts a population."""

import importlib
import logging
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def endpoint(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]))
    boundary = importlib.import_module("backend.variable_endpoint")
    monkeypatch.setattr(
        boundary, "calculate_variables", lambda **kwargs: pytest.fail("No population")
    )
    return boundary


def test_actual_handler_returns_uncached_serving_witness(endpoint, monkeypatch):
    from backend.app import app

    monkeypatch.setattr(
        endpoint, "serving_witness", lambda nonce: {"nonce": nonce, "pid": os.getpid()}
    )
    with TestClient(app) as client:
        response = client.get(
            "/api/microcosm_variable?runtime_audit=fixture-nonce-012345"
        )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "runtime_audit": {"nonce": "fixture-nonce-012345", "pid": os.getpid()}
    }


@pytest.mark.parametrize(
    ("query", "detail"),
    [
        ("runtime_audit=", "Invalid runtime audit nonce."),
        ("runtime_audit=short", "Invalid runtime audit nonce."),
        (
            "runtime_audit=fixture-nonce-012345&runtime_audit=fixture-nonce-678901",
            "Use one runtime_audit nonce without calculation parameters.",
        ),
        (
            "runtime_audit=fixture-nonce-012345&variable=snap",
            "Use one runtime_audit nonce without calculation parameters.",
        ),
        (
            "runtime_audit=fixture-nonce-012345&metadata=1",
            "Use one runtime_audit nonce without calculation parameters.",
        ),
    ],
)
def test_invalid_audit_cannot_fall_through_to_calculation(
    endpoint, monkeypatch, query, detail
):
    monkeypatch.setattr(
        endpoint,
        "serving_witness",
        lambda nonce: pytest.fail("Invalid request must not capture"),
    )
    assert endpoint.handle_query(query) == (400, {"detail": detail})


def test_audit_failure_is_controlled_and_uncached(endpoint, monkeypatch):
    from backend.app import app

    def failed(nonce):
        raise RuntimeError("private-fixture-failure-detail")

    monkeypatch.setattr(endpoint, "serving_witness", failed)
    with TestClient(app) as client:
        response = client.get(
            "/api/microcosm_variable?runtime_audit=fixture-nonce-012345"
        )
    assert response.status_code == 502
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": "Runtime audit failed."}


def test_audit_failure_is_recorded_in_the_backend_log(endpoint, monkeypatch, caplog):
    """The audit exists to diagnose serving; its own failure must leave a record."""

    def failed(nonce):
        raise RuntimeError("private-fixture-failure-detail")

    monkeypatch.setattr(endpoint, "serving_witness", failed)
    with caplog.at_level(logging.ERROR, logger=endpoint.__name__):
        status, body = endpoint.handle_query("runtime_audit=fixture-nonce-012345")
    assert (status, body) == (502, {"detail": "Runtime audit failed."})
    records = [record for record in caplog.records if record.name == endpoint.__name__]
    assert [record.levelno for record in records] == [logging.ERROR]
    assert records[0].exc_info is not None
    # The private detail belongs in the backend log, never in the public JSON.
    assert "private-fixture-failure-detail" in caplog.text
    assert "private-fixture-failure-detail" not in str(body)


def test_real_lightweight_child_and_current_process_identity(endpoint, monkeypatch):
    import modal
    from backend.runtime_audit import serving_witness

    monkeypatch.setattr(
        modal, "current_function_call_id", lambda: "fc-synthetic-context"
    )
    monkeypatch.setattr(modal, "current_input_id", lambda: "in-synthetic-context")
    result = serving_witness("fixture-nonce-012345")
    assert result["pid"] == os.getpid()
    assert result["child"]["pid"] != result["pid"]
    assert result["function_call_id"] == "fc-synthetic-context"
    for field in ("executable", "prefix", "base_prefix"):
        assert result[field] == result["child"][field]
    assert result["already_loaded_module_origins"]["backend.runtime_audit"] == str(
        Path(__file__).resolve().parents[2] / "backend/runtime_audit.py"
    )
    assert "environment" not in result
    assert "capture_container_id" not in result
    assert result["modal_context_available"] is True
    assert "captured_in_serving_handler" not in result
    assert result["child"]["sys_path"]
    assert "policyengine-core" in result["child"]["packages"]
    assert "not loaded" in result["module_origin_note"]
    with pytest.raises(ValueError, match="nonce"):
        serving_witness("invalid")

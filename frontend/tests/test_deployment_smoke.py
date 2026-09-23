"""Deployment checks reject incorrect source, model, data, and scope."""

from __future__ import annotations

import copy
import importlib
import json
from pathlib import Path

import pytest


def _module(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return importlib.import_module("scripts.deployment_smoke")


def _release():
    path = Path(__file__).resolve().parents[1] / "scripts" / "hosted_release.json"
    return json.loads(path.read_text())


def _runtime(release, source_commit="abc123"):
    return {
        "source_commit": source_commit,
        "packages": release["packages"],
    }


def _metadata_body():
    release = _release()
    return {
        "runtime": _runtime(release),
        "data_configuration": release,
        "environment_configuration": {
            "repo": release["repo"],
            "revision": release["hf_revision"],
            "filename": release["filename"],
        },
    }


def _calculation_body():
    release = _release()
    identity = {**release, "verified": True}
    return {
        "runtime": _runtime(release),
        "data_identity": identity,
        "period": str(release["data_year"]),
        "release_id": release["release_id"],
        "variables": [
            {
                "variable": "spm_unit_spm_threshold",
                "weighted_sum": 123.5,
                "state_filter": None,
            },
            {
                "variable": "ca_income_tax",
                "weighted_sum": 45.0,
                "state_filter": "CA",
            },
        ],
        "execution": {
            "simulation_cache_hits": {"national": False, "CA": False},
            "simulation_cache_evictions": ["national"],
        },
    }


def test_metadata_accepts_exact_deployment_identity(monkeypatch):
    deployment = _module(monkeypatch)
    deployment.validate_metadata(_metadata_body(), "abc123")


def test_metadata_rejects_unreviewed_environment(monkeypatch):
    deployment = _module(monkeypatch)
    body = _metadata_body()
    body["environment_configuration"]["revision"] = "main"

    with pytest.raises(ValueError, match="unreviewed dataset"):
        deployment.validate_metadata(body, "abc123")


def test_calculation_accepts_verified_national_to_state_switch(monkeypatch):
    deployment = _module(monkeypatch)
    deployment.validate_calculation(
        _calculation_body(),
        "abc123",
        ["spm_unit_spm_threshold", "ca_income_tax"],
        require_scope_switch=True,
    )


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (
            lambda body: body["runtime"].update(source_commit="wrong"),
            "source commit",
        ),
        (
            lambda body: body["data_identity"].update(verified=False),
            "verified input bytes",
        ),
        (
            lambda body: body["variables"][1].update(state_filter="NY"),
            "California input",
        ),
        (
            lambda body: body["execution"]["simulation_cache_hits"].update(
                national=True
            ),
            "construct both scopes",
        ),
    ],
)
def test_calculation_rejects_mismatched_deployment(monkeypatch, mutate, message):
    deployment = _module(monkeypatch)
    body = copy.deepcopy(_calculation_body())
    mutate(body)

    with pytest.raises(ValueError, match=message):
        deployment.validate_calculation(
            body,
            "abc123",
            ["spm_unit_spm_threshold", "ca_income_tax"],
            require_scope_switch=True,
        )


def test_validated_request_retries_a_stale_promoted_alias(monkeypatch):
    deployment = _module(monkeypatch)
    responses = iter([{"commit": "old"}, {"commit": "new"}])
    monkeypatch.setattr(
        deployment,
        "_request_json",
        lambda url, query, headers, attempts: next(responses),
    )
    monkeypatch.setattr(deployment.time, "sleep", lambda seconds: None)
    observed = []

    def validate(body):
        observed.append(body["commit"])
        if body["commit"] != "new":
            raise ValueError("stale alias")

    deployment._request_and_validate(
        "https://example.test/api",
        [("metadata", "1")],
        {},
        validate,
        attempts=2,
    )

    assert observed == ["old", "new"]

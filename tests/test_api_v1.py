"""Tests for stable /api/v1 diagnostics routes."""

from __future__ import annotations

import numpy as np
import pandas as pd
import scipy.sparse as sp
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import router as api_router_module
from backend.api.v1.router import router
from backend.services.runs import DatasetConfig, RunInfo
from backend.state import AppState


DATASET = DatasetConfig(
    id="test-root",
    label="Test Root",
    repo_id="PolicyEngine/test",
    layout="root",
    primary_h5="enhanced_cps_2024.h5",
)


class _Registry:
    def __init__(self, state: AppState | dict[tuple[str, str], AppState]):
        self.state = state

    def get(self, dataset_id: str, run_id: str) -> AppState:
        if isinstance(self.state, dict):
            state = self.state[(dataset_id, run_id)]
        else:
            state = self.state
        state.dataset_id = dataset_id
        state.run_id = run_id
        return state


def _state(
    *,
    national_estimate: float = 110.0,
    national_rel_error: float = 0.10,
) -> AppState:
    rows = [
        {
            "target_id": 1,
            "target_name": "national/medicaid/US/[]",
            "variable": "medicaid",
            "geo_level": "national",
            "geographic_id": None,
            "value": 100.0,
            "estimate": national_estimate,
            "rel_error": national_rel_error,
            "abs_rel_error": abs(national_rel_error),
            "loss_contribution": 0.01,
            "included": True,
            "source": "PolicyEngine",
            "domain_variable": None,
        },
        {
            "target_id": 2,
            "target_name": "state/agi/CA/[]",
            "variable": "agi",
            "geo_level": "state",
            "geographic_id": "6",
            "value": 200.0,
            "estimate": np.nan,
            "rel_error": np.nan,
            "abs_rel_error": np.nan,
            "loss_contribution": 0.0,
            "included": False,
            "source": "IRS SOI",
            "domain_variable": None,
        },
    ]
    df = pd.DataFrame(rows)
    return AppState(
        X_csr=sp.csr_matrix((len(df), 1)),
        X_csc=sp.csr_matrix((len(df), 1)).tocsc(),
        targets_df=df,
        target_names=df["target_name"].tolist(),
        targets_enriched=df,
        n_targets=len(df),
        n_households=1,
        dataset_id=DATASET.id,
        run_id="main",
    )


def _client(
    monkeypatch,
    state: AppState | dict[tuple[str, str], AppState] | None = None,
) -> TestClient:
    monkeypatch.setattr(
        api_router_module.runs_service,
        "DEFAULT_DATASETS",
        [DATASET],
    )
    monkeypatch.setattr(
        api_router_module.runs_service,
        "list_runs",
        lambda dataset_id: (
            RunInfo(dataset_id=dataset_id, run_id="main", label="main"),
        ),
    )
    monkeypatch.setattr(
        api_router_module,
        "published_bundles",
        lambda repo_id, run_id: frozenset({
            "enhanced_cps_2024.h5",
            "national/US.h5",
            "states/CA.h5",
        }),
    )

    def fake_evaluate_bundle(df, **kwargs):
        out = df.copy()
        out["estimate"] = 250.0
        out["rel_error"] = 0.25
        out["abs_rel_error"] = 0.25
        return out

    import backend.services.bundle_eval as bundle_eval

    monkeypatch.setattr(bundle_eval, "evaluate_bundle", fake_evaluate_bundle)

    app = FastAPI()
    app.include_router(router)
    app.state.registry = _Registry(state or _state())
    return TestClient(app)


def test_datasets_response_has_stable_shape(monkeypatch):
    client = _client(monkeypatch)
    data = client.get("/api/v1/datasets").json()
    assert data["items"] == [{
        "dataset_id": "test-root",
        "label": "Test Root",
        "repo_id": "PolicyEngine/test",
        "repo_type": "model",
        "layout": "root",
        "primary_h5": "enhanced_cps_2024.h5",
    }]


def test_runs_response(monkeypatch):
    client = _client(monkeypatch)
    data = client.get("/api/v1/datasets/test-root/runs").json()
    assert data["dataset_id"] == "test-root"
    assert data["items"][0]["run_id"] == "main"


def test_bundles_include_state_counts(monkeypatch):
    client = _client(monkeypatch)
    data = client.get(
        "/api/v1/datasets/test-root/runs/main/bundles?kind=state",
    ).json()
    assert data["items"] == [{
        "bundle": "states/CA.h5",
        "kind": "state",
        "geography_id": "6",
        "geography_name": "California",
        "target_count": 1,
        "included_target_count": 0,
        "cache_status": "not_computed",
    }]


def test_state_targets_compute_from_bundle_and_null_skipped_loss(monkeypatch):
    client = _client(monkeypatch)
    data = client.get(
        "/api/v1/datasets/test-root/runs/main/targets",
        params={
            "bundle": "states/CA.h5",
            "geo_level": "state",
            "included": "false",
        },
    ).json()
    assert data["bundle"] == "states/CA.h5"
    assert data["total"] == 1
    row = data["items"][0]
    assert row["pe_aggregate"] == 250.0
    assert row["rel_error"] == 0.25
    assert row["included_in_loss"] is False
    assert row["loss_contribution"] is None
    assert row["computed_from_bundle"] == "states/CA.h5"


def test_state_summary_reports_loss_unavailable(monkeypatch):
    client = _client(monkeypatch)
    data = client.get(
        "/api/v1/datasets/test-root/runs/main/summary",
        params={
            "bundle": "states/CA.h5",
            "geo_level": "state",
            "included": "false",
        },
    ).json()
    assert data["target_universe_count"] == 1
    assert data["included_target_count"] == 0
    assert data["computed_target_count"] == 1
    assert data["loss_contribution_available"] is False
    assert data["metrics"]["total_loss"] is None
    assert data["provenance"]["aggregate_source"] == "states/CA.h5"


def test_target_detail_uses_selected_bundle(monkeypatch):
    client = _client(monkeypatch)
    data = client.get(
        "/api/v1/datasets/test-root/runs/main/targets/2",
        params={"bundle": "states/CA.h5"},
    ).json()
    assert data["target_id"] == 2
    assert data["computed_from_bundle"] == "states/CA.h5"
    assert data["loss_contribution"] is None


def test_evaluate_endpoint_returns_items_url(monkeypatch):
    client = _client(monkeypatch)
    data = client.post(
        "/api/v1/evaluate",
        json={
            "dataset_id": "test-root",
            "run_id": "main",
            "bundle": "states/CA.h5",
            "filters": {"geo_level": ["state"], "included": False},
            "limit": 10,
        },
    ).json()
    assert data["status"] == "complete"
    assert data["result"]["target_count"] == 1
    assert data["result"]["computed_target_count"] == 1
    assert "bundle=states/CA.h5" in data["result"]["items_url"]


def test_compare_endpoint_ranks_run_improvement(monkeypatch):
    client = _client(
        monkeypatch,
        {
            ("test-root", "run-a"): _state(
                national_estimate=110.0,
                national_rel_error=0.10,
            ),
            ("test-root", "run-b"): _state(
                national_estimate=105.0,
                national_rel_error=0.05,
            ),
        },
    )
    data = client.post(
        "/api/v1/compare",
        json={
            "a": {"dataset_id": "test-root", "run_id": "run-a"},
            "b": {"dataset_id": "test-root", "run_id": "run-b"},
            "top_n": 5,
        },
    ).json()
    assert data["a"]["run_id"] == "run-a"
    assert data["b"]["run_id"] == "run-b"
    assert data["matched_target_count"] == 2
    assert data["computed_pair_count"] == 1
    assert data["improved_count"] == 1
    assert data["regressed_count"] == 0
    assert data["improved"][0]["target_id"] == 1
    assert data["improved"][0]["delta_abs_rel_error"] == -0.05
    assert data["improved"][0]["computed_from_bundle_a"] == "enhanced_cps_2024.h5"
    assert data["improved"][0]["computed_from_bundle_b"] == "enhanced_cps_2024.h5"
    assert data["by_variable"][0]["variable"] == "medicaid"


def test_compare_endpoint_rejects_incompatible_targets(monkeypatch):
    incompatible = _state()
    incompatible.targets_enriched.loc[0, "target_name"] = "national/snap/US/[]"
    incompatible.targets_enriched.loc[1, "target_name"] = "state/snap/CA/[]"
    client = _client(
        monkeypatch,
        {
            ("test-root", "run-a"): _state(),
            ("test-root", "run-b"): incompatible,
        },
    )
    response = client.post(
        "/api/v1/compare",
        json={
            "a": {"dataset_id": "test-root", "run_id": "run-a"},
            "b": {"dataset_id": "test-root", "run_id": "run-b"},
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == (
        "No compatible targets matched between comparison sides."
    )

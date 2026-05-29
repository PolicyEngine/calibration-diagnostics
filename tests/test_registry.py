"""Tests for the LRU RunRegistry (backend/services/registry.py)."""

import sys
import types

import pytest

from backend.services.registry import RunRegistry
from backend.services.runs import DatasetConfig
from backend.state import AppState

DATASET_ID = "flat-test"


def _fake_state(dataset_id: str, run_id: str) -> AppState:
    import numpy as np
    import pandas as pd
    import scipy.sparse as sp

    return AppState(
        X_csr=sp.csr_matrix((1, 1)),
        X_csc=sp.csc_matrix((1, 1)),
        targets_df=pd.DataFrame(),
        target_names=[],
        initial_weights=np.array([1.0]),
        cd_geoid=np.array([0]),
        dataset_id=dataset_id,
        run_id=run_id,
    )


@pytest.fixture
def mock_loader(monkeypatch):
    """Replace the lazy-imported load_run with an instrumented mock."""
    from backend.services import runs as runs_module

    monkeypatch.setattr(
        runs_module,
        "DEFAULT_DATASETS",
        [
            DatasetConfig(
                id=DATASET_ID,
                label="Flat test",
                repo_id="PolicyEngine/test",
                layout="flat",
            ),
        ],
    )
    fake_loader = types.ModuleType("backend.services.loader")
    calls: list[tuple[str, str, str]] = []

    def load_run(repo_id, repo_type, prefix, cache_root=".artifacts", dataset_id=""):
        calls.append((repo_id, prefix, dataset_id))
        return _fake_state(dataset_id, prefix)

    fake_loader.load_run = load_run
    monkeypatch.setitem(sys.modules, "backend.services.loader", fake_loader)
    return calls


def test_get_loads_on_miss(mock_loader):
    reg = RunRegistry(max_size=3)
    state = reg.get(DATASET_ID, "run-a")
    assert state.dataset_id == DATASET_ID
    assert state.run_id == "run-a"
    assert len(mock_loader) == 1


def test_get_hits_cache_on_second_call(mock_loader):
    reg = RunRegistry(max_size=3)
    reg.get(DATASET_ID, "run-a")
    reg.get(DATASET_ID, "run-a")
    assert len(mock_loader) == 1, "second call should hit cache"


def test_lru_eviction(mock_loader):
    reg = RunRegistry(max_size=2)
    reg.get(DATASET_ID, "a")
    reg.get(DATASET_ID, "b")
    reg.get(DATASET_ID, "c")  # evicts "a"
    keys = reg.loaded_keys()
    assert keys == [(DATASET_ID, "b"), (DATASET_ID, "c")]


def test_lru_promotes_on_access(mock_loader):
    reg = RunRegistry(max_size=2)
    reg.get(DATASET_ID, "a")
    reg.get(DATASET_ID, "b")
    reg.get(DATASET_ID, "a")  # promote a to MRU
    reg.get(DATASET_ID, "c")  # should evict b, not a
    keys = reg.loaded_keys()
    assert (DATASET_ID, "a") in keys
    assert (DATASET_ID, "b") not in keys


def test_get_unknown_dataset_raises(mock_loader):
    reg = RunRegistry()
    with pytest.raises(KeyError):
        reg.get("does-not-exist", "any")

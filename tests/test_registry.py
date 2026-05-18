"""Tests for the LRU RunRegistry (backend/services/registry.py)."""

import sys
import types
from unittest.mock import MagicMock

import pytest

from backend.services.registry import RunRegistry
from backend.state import AppState


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
    state = reg.get("us-cps", "run-a")
    assert state.dataset_id == "us-cps"
    assert state.run_id == "run-a"
    assert len(mock_loader) == 1


def test_get_hits_cache_on_second_call(mock_loader):
    reg = RunRegistry(max_size=3)
    reg.get("us-cps", "run-a")
    reg.get("us-cps", "run-a")
    assert len(mock_loader) == 1, "second call should hit cache"


def test_lru_eviction(mock_loader):
    reg = RunRegistry(max_size=2)
    reg.get("us-cps", "a")
    reg.get("us-cps", "b")
    reg.get("us-cps", "c")  # evicts "a"
    keys = reg.loaded_keys()
    assert keys == [("us-cps", "b"), ("us-cps", "c")]


def test_lru_promotes_on_access(mock_loader):
    reg = RunRegistry(max_size=2)
    reg.get("us-cps", "a")
    reg.get("us-cps", "b")
    reg.get("us-cps", "a")  # promote a to MRU
    reg.get("us-cps", "c")  # should evict b, not a
    keys = reg.loaded_keys()
    assert ("us-cps", "a") in keys
    assert ("us-cps", "b") not in keys


def test_get_unknown_dataset_raises(mock_loader):
    reg = RunRegistry()
    with pytest.raises(KeyError):
        reg.get("does-not-exist", "any")

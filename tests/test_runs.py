"""Tests for run discovery (backend/services/runs.py)."""

from unittest.mock import MagicMock, patch

import pytest

from backend.services import runs as runs_module
from backend.services.runs import (
    DatasetConfig,
    REQUIRED_ARTIFACTS,
    RunInfo,
    default_selection,
    get_dataset,
    list_datasets,
    list_runs,
)


def test_list_datasets_returns_defaults():
    datasets = list_datasets()
    assert len(datasets) >= 1
    assert all(isinstance(d, DatasetConfig) for d in datasets)
    assert any(d.id == "us-cps" for d in datasets)


def test_get_dataset_known():
    d = get_dataset("us-cps")
    assert d.id == "us-cps"
    assert "policyengine-us-data-pipeline" in d.repo_id


def test_get_dataset_unknown_raises():
    with pytest.raises(KeyError):
        get_dataset("does-not-exist")


def _fake_files(prefixes_with_files: dict[str, list[str]]) -> list[str]:
    """Build a flat HF-style file list from {prefix: [filenames]}."""
    out = []
    for prefix, names in prefixes_with_files.items():
        for n in names:
            out.append(f"{prefix}/{n}")
    return out


def test_list_runs_filters_incomplete_prefixes():
    """Prefixes missing required artifacts must not be reported as runs."""
    files = _fake_files({
        "good-run": list(REQUIRED_ARTIFACTS) + ["extra.txt"],
        "missing-weights": ["calibration_package.pkl"],
        "missing-package": ["calibration_weights.npy"],
        "empty": ["readme.md"],
    })

    list_runs.cache_clear()
    with patch.object(runs_module, "HfApi") as MockApi:
        api = MockApi.return_value
        api.list_repo_files.return_value = files
        api.repo_info.side_effect = Exception("no metadata")
        result = list_runs("us-cps")

    run_ids = [r.run_id for r in result]
    assert run_ids == ["good-run"]


def test_list_runs_handles_nested_files():
    """Files more than one level deep should not be mistaken for prefixes."""
    files = _fake_files({
        "real-run": list(REQUIRED_ARTIFACTS),
    }) + ["real-run/subdir/extra.txt"]

    list_runs.cache_clear()
    with patch.object(runs_module, "HfApi") as MockApi:
        api = MockApi.return_value
        api.list_repo_files.return_value = files
        api.repo_info.side_effect = Exception("no metadata")
        result = list_runs("us-cps")

    assert [r.run_id for r in result] == ["real-run"]


def test_list_runs_empty_on_api_failure():
    list_runs.cache_clear()
    with patch.object(runs_module, "HfApi") as MockApi:
        MockApi.return_value.list_repo_files.side_effect = RuntimeError("offline")
        result = list_runs("us-cps")
    assert result == ()


def test_list_runs_unknown_dataset_raises():
    list_runs.cache_clear()
    with pytest.raises(KeyError):
        list_runs("does-not-exist")


def test_default_selection_env(monkeypatch):
    monkeypatch.setenv("DEFAULT_DATASET", "us-cps")
    monkeypatch.setenv("DEFAULT_RUN", "test")
    assert default_selection() == ("us-cps", "test")


def test_default_selection_missing(monkeypatch):
    monkeypatch.delenv("DEFAULT_DATASET", raising=False)
    monkeypatch.delenv("DEFAULT_RUN", raising=False)
    assert default_selection() is None


def test_run_info_fields():
    """Sanity: RunInfo is a dataclass with the expected fields."""
    r = RunInfo(dataset_id="d", run_id="r", label="r", last_modified=None)
    assert r.dataset_id == "d"
    assert r.run_id == "r"

"""The hosted calculation constructs only its reviewed input year."""

from __future__ import annotations

import importlib
from pathlib import Path

import pandas as pd
import pytest
from policyengine_us.data import USMultiYearDataset, USSingleYearDataset


def _core(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    return importlib.import_module("scripts.microcosm_variable_core")


def _single_year(*, period=2024):
    return USSingleYearDataset(
        person=pd.DataFrame({"person_id": [1]}),
        household=pd.DataFrame({"household_id": [1]}),
        tax_unit=pd.DataFrame({"tax_unit_id": [1]}),
        time_period=period,
    )


def test_national_input_is_wrapped_without_creating_other_years(monkeypatch, tmp_path):
    core = _core(monkeypatch)
    path = tmp_path / "reviewed.h5"
    _single_year().save(path)

    dataset = core.single_year_simulation_dataset(str(path))

    assert isinstance(dataset, USMultiYearDataset)
    assert len(dataset.datasets) == 1
    assert list(dataset.datasets) == [2024]
    assert isinstance(dataset.datasets[2024], USSingleYearDataset)
    assert dataset.datasets[2024].time_period == "2024"


def test_state_input_is_wrapped_without_creating_other_years(monkeypatch):
    core = _core(monkeypatch)
    state_dataset = _single_year()
    calls = []

    def state_filtered_dataset(path, state):
        calls.append((path, state))
        return state_dataset

    monkeypatch.setattr(core, "state_filtered_dataset", state_filtered_dataset)

    dataset = core.single_year_simulation_dataset("reviewed.h5", "CA")

    assert isinstance(dataset, USMultiYearDataset)
    assert dataset.datasets == {2024: state_dataset}
    assert calls == [("reviewed.h5", "CA")]


def test_input_year_must_match_reviewed_year(monkeypatch):
    core = _core(monkeypatch)
    monkeypatch.setattr(
        core, "state_filtered_dataset", lambda path, state: _single_year(period=2023)
    )

    with pytest.raises(
        core.VariableCalculationError,
        match="does not match the reviewed year 2024",
    ):
        core.single_year_simulation_dataset("reviewed.h5", "CA")

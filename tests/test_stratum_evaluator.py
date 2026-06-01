"""Tests for the MVP stratum evaluator."""

import numpy as np
import pandas as pd
import pytest

from backend.services.stratum_evaluator import (
    _is_geographic_only,
    evaluate_targets,
)


class FakeSeries:
    def __init__(self, values, weights):
        self.values = np.asarray(values, dtype=float)
        self.weights = np.asarray(weights, dtype=float)


class FakeSim:
    """Minimal Microsimulation stand-in for evaluator tests."""

    def __init__(self, household_data: dict[str, list[float]], weights: list[float]):
        self._data = {k: np.asarray(v, dtype=float) for k, v in household_data.items()}
        self._weights = np.asarray(weights, dtype=float)

    def calculate(self, variable, map_to=None, period=None):
        if variable not in self._data:
            raise ValueError(f"unknown variable {variable}")
        return FakeSeries(self._data[variable], self._weights)


def test_geographic_only_recognises_no_constraints():
    assert _is_geographic_only([]) is True


def test_geographic_only_accepts_state_constraint():
    assert _is_geographic_only(["state_fips == 6"]) is True


def test_geographic_only_rejects_domain_constraint():
    assert _is_geographic_only(["tax_unit_is_filer == 1"]) is False


def test_geographic_only_rejects_mixed():
    assert _is_geographic_only(["state_fips == 6", "child_age < 6"]) is False


def _targets(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["target_idx"] = np.arange(len(df))
    return df


def test_national_target_evaluates_to_weighted_sum():
    sim = FakeSim(
        household_data={"snap": [100, 200, 300]},
        weights=[1.0, 2.0, 3.0],
    )
    targets = _targets([{
        "variable": "snap", "period": 2024, "value": 1000.0,
        "geo_level": "national", "geographic_id": None,
        "constraints": [],
    }])
    out = evaluate_targets(targets, sim)
    # 100*1 + 200*2 + 300*3 = 1400
    assert out["estimate"].iloc[0] == pytest.approx(1400.0)
    assert out["rel_error"].iloc[0] == pytest.approx((1400 - 1000) / 1000)
    assert out["eval_note"].iloc[0] == ""


def test_state_target_filters_by_state_fips():
    sim = FakeSim(
        household_data={
            "snap":       [100, 200, 300, 400],
            "state_fips": [6,   6,   48,  48],
        },
        weights=[1.0, 1.0, 1.0, 1.0],
    )
    targets = _targets([{
        "variable": "snap", "period": 2024, "value": 250.0,
        "geo_level": "state", "geographic_id": "6",
        "constraints": ["state_fips == 6"],
    }])
    out = evaluate_targets(targets, sim)
    # only state 6: 100 + 200 = 300
    assert out["estimate"].iloc[0] == pytest.approx(300.0)


def test_constrained_target_left_unevaluated_with_note():
    sim = FakeSim(
        household_data={"snap": [100, 200, 300]},
        weights=[1.0, 1.0, 1.0],
    )
    targets = _targets([{
        "variable": "snap", "period": 2024, "value": 250.0,
        "geo_level": "national", "geographic_id": None,
        "constraints": ["tax_unit_is_filer == 1"],
    }])
    out = evaluate_targets(targets, sim)
    assert pd.isna(out["estimate"].iloc[0])
    assert "constraint variable" in out["eval_note"].iloc[0]


def test_unknown_variable_gets_note():
    sim = FakeSim(household_data={"snap": [100]}, weights=[1.0])
    targets = _targets([{
        "variable": "made_up_variable", "period": 2024, "value": 1.0,
        "geo_level": "national", "geographic_id": None,
        "constraints": [],
    }])
    out = evaluate_targets(targets, sim)
    assert pd.isna(out["estimate"].iloc[0])
    assert "not available" in out["eval_note"].iloc[0]


def test_zero_target_value_yields_nan_rel_error_no_crash():
    sim = FakeSim(household_data={"snap": [50]}, weights=[1.0])
    targets = _targets([{
        "variable": "snap", "period": 2024, "value": 0.0,
        "geo_level": "national", "geographic_id": None,
        "constraints": [],
    }])
    out = evaluate_targets(targets, sim)
    assert out["estimate"].iloc[0] == pytest.approx(50.0)
    assert pd.isna(out["rel_error"].iloc[0])


def test_variable_cached_across_rows():
    """Two targets referencing the same variable should hit sim.calculate once."""
    calls: list[str] = []
    base_data = {"snap": [100, 200], "state_fips": [6, 48]}

    class Spy(FakeSim):
        def calculate(self, variable, map_to=None, period=None):
            calls.append(variable)
            return super().calculate(variable, map_to=map_to, period=period)

    sim = Spy(household_data=base_data, weights=[1.0, 1.0])
    targets = _targets([
        {"variable": "snap", "period": 2024, "value": 100.0,
         "geo_level": "national", "geographic_id": None, "constraints": []},
        {"variable": "snap", "period": 2024, "value": 50.0,
         "geo_level": "state", "geographic_id": "6",
         "constraints": ["state_fips == 6"]},
    ])
    evaluate_targets(targets, sim)
    # snap should be calculated once (cached); state_fips once for the geo lookup.
    snap_calls = [c for c in calls if c == "snap"]
    assert len(snap_calls) == 1

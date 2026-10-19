"""Hosted calculations honour the WIC take-up decision the reviewed data stores.

The reviewed H5 stores each person's WIC take-up as ``would_claim_wic``.
policyengine-us 2.2.1 renamed that input to ``takes_up_wic_if_eligible``
(default ``True``) and skips the stored column, so the hosted runtime must apply
.py's stored-input renames or every WIC-eligible person takes WIC up.
"""

import hashlib
import importlib
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

HOUSEHOLD_WEIGHT = 100.0
STORED_WIC_TAKE_UP = {
    "parent": True,
    "child_declining_wic": False,
    "child_claiming_wic": True,
}
APPLIED_RENAMES = {"would_claim_wic": "takes_up_wic_if_eligible"}


@pytest.fixture
def modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    release = importlib.import_module("scripts.hosted_release")
    core = importlib.import_module("scripts.microcosm_variable_core")
    monkeypatch.setattr(core, "_SIM_CACHE", {})
    return release, core


def write_populace_layout_fixture(path: Path) -> None:
    """One no-income California household: a parent and two WIC-eligible children.

    The tables use the reviewed release's entity-table layout and store only
    the legacy ``would_claim_wic`` column for WIC take-up.
    """
    from policyengine_us.data import USSingleYearDataset

    person_ids = [101, 102, 103]
    USSingleYearDataset(
        person=pd.DataFrame(
            {
                "person_id": person_ids,
                "person_household_id": [1, 1, 1],
                "person_tax_unit_id": [1, 1, 1],
                "person_spm_unit_id": [1, 1, 1],
                "person_family_id": [1, 1, 1],
                "person_marital_unit_id": [1, 2, 3],
                "age": [30, 2, 3],
                "is_spm_independent_minor_role": [False, False, False],
                "would_claim_wic": list(STORED_WIC_TAKE_UP.values()),
            }
        ),
        household=pd.DataFrame(
            {
                "household_id": [1],
                "state_fips": [6],
                "household_weight": [HOUSEHOLD_WEIGHT],
            }
        ),
        tax_unit=pd.DataFrame({"tax_unit_id": [1]}),
        spm_unit=pd.DataFrame({"spm_unit_id": [1]}),
        family=pd.DataFrame({"family_id": [1]}),
        marital_unit=pd.DataFrame({"marital_unit_id": [1, 2, 3]}),
        time_period=2024,
    ).save(path)


@pytest.fixture
def reviewed_fixture(modules, monkeypatch, tmp_path):
    """Serve the fixture as the reviewed H5, without any download."""
    release, core = modules
    dataset_path = tmp_path / "populace_us_2024.h5"
    write_populace_layout_fixture(dataset_path)
    reviewed = release.reviewed_release()
    reviewed["sha256"] = hashlib.sha256(dataset_path.read_bytes()).hexdigest()
    monkeypatch.setattr(release, "reviewed_release", lambda: reviewed)
    monkeypatch.setattr(core, "download_certification", lambda *args: None)
    monkeypatch.setattr(core, "_evict_other_releases", lambda *args: None)
    monkeypatch.setattr(core, "_download_dataset", lambda *args: str(dataset_path))
    return reviewed


def cached_simulation(core, reviewed, state):
    cache_key = (reviewed["repo"], reviewed["hf_revision"], reviewed["filename"], state)
    return core._SIM_CACHE[cache_key][1]


def person_take_up_and_wic(simulation) -> tuple[list[bool], np.ndarray]:
    take_up = simulation.calculate(
        "takes_up_wic_if_eligible", "2024-01", use_weights=False
    )
    yearly_wic = simulation.calculate("wic", 2024, use_weights=False)
    return np.asarray(take_up).tolist(), np.asarray(yearly_wic)


def test_stored_wic_take_up_is_honoured_in_national_calculations(
    modules, reviewed_fixture
):
    _, core = modules

    response = core.calculate_variables(variables=["wic"], period="2024")

    simulation = cached_simulation(core, reviewed_fixture, None)
    take_up, yearly_wic = person_take_up_and_wic(simulation)
    declining_child_wic, claiming_child_wic = yearly_wic[1], yearly_wic[2]
    assert declining_child_wic == 0
    assert claiming_child_wic > 0
    assert take_up == list(STORED_WIC_TAKE_UP.values())
    assert response["raw_sum"] == pytest.approx(claiming_child_wic)
    assert response["weighted_sum"] == pytest.approx(
        HOUSEHOLD_WEIGHT * claiming_child_wic
    )
    assert response["execution"]["legacy_input_renames"] == {
        "national": APPLIED_RENAMES
    }


def test_stored_wic_take_up_is_honoured_in_california_calculations(
    modules, reviewed_fixture
):
    _, core = modules

    response = core.calculate_variables(variables=["ca_income_tax"], period="2024")

    assert response["state_filter"] == "CA"
    simulation = cached_simulation(core, reviewed_fixture, "CA")
    take_up, yearly_wic = person_take_up_and_wic(simulation)
    assert yearly_wic[1] == 0
    assert yearly_wic[2] > 0
    assert take_up == list(STORED_WIC_TAKE_UP.values())
    assert response["execution"]["legacy_input_renames"] == {"CA": APPLIED_RENAMES}

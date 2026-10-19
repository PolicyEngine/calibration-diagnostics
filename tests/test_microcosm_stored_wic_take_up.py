"""The harness simulation honours the WIC take-up decision the release stores.

The pinned release stores each person's WIC take-up as ``would_claim_wic``.
policyengine-us 2.2.1 renamed that input to ``takes_up_wic_if_eligible``
(default ``True``) and skips the stored column, so the harness must apply .py's
stored-input renames, as the hosted variable runtime does.
"""

from pathlib import Path

import numpy as np
import pytest

pd = pytest.importorskip("pandas")
pytest.importorskip("policyengine_us")

from evaluation_harness.adapters.microcosm import MicrocosmPolicyEngineRunner  # noqa: E402

STORED_WIC_TAKE_UP = {
    "parent": True,
    "child_declining_wic": False,
    "child_claiming_wic": True,
}


def write_populace_layout_fixture(path: Path) -> None:
    """One no-income household: a parent and two WIC-eligible children.

    The tables use the pinned release's entity-table layout and store only the
    legacy ``would_claim_wic`` column for WIC take-up.
    """
    from policyengine_us.data import USSingleYearDataset

    USSingleYearDataset(
        person=pd.DataFrame(
            {
                "person_id": [101, 102, 103],
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
            {"household_id": [1], "state_fips": [6], "household_weight": [100.0]}
        ),
        tax_unit=pd.DataFrame({"tax_unit_id": [1]}),
        spm_unit=pd.DataFrame({"spm_unit_id": [1]}),
        family=pd.DataFrame({"family_id": [1]}),
        marital_unit=pd.DataFrame({"marital_unit_id": [1, 2, 3]}),
        time_period=2024,
    ).save(path)


def test_harness_simulation_honours_stored_wic_take_up(tmp_path: Path) -> None:
    dataset_path = tmp_path / "populace_us_2024.h5"
    write_populace_layout_fixture(dataset_path)

    simulation = MicrocosmPolicyEngineRunner(dataset_path=dataset_path).simulation

    yearly_wic = np.asarray(simulation.calculate("wic", 2024, use_weights=False))
    declining_child_wic, claiming_child_wic = yearly_wic[1], yearly_wic[2]
    assert declining_child_wic == 0
    assert claiming_child_wic > 0
    take_up = simulation.calculate(
        "takes_up_wic_if_eligible", "2024-01", use_weights=False
    )
    assert np.asarray(take_up).tolist() == list(STORED_WIC_TAKE_UP.values())

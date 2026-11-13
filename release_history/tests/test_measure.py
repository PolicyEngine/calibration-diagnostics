import numpy as np
import pytest

from release_history.measure import MeasurementError, build_frame, measure
from release_history.spec import parse_spec

from .fakes import FakeBackend, FakeSim, baseline_world, fake_spec_dict


def cells_by_output(result):
    return {(c.output, c.period): c for c in result.cells}


def test_baseline_items_are_weighted_on_their_own_entity():
    spec = parse_spec(fake_spec_dict())
    result = measure(spec, FakeBackend())
    cells = cells_by_output(result)
    assert cells[("baseline/income_tax", 2026)].value == pytest.approx(4_700_000)
    assert cells[("baseline/benefit", 2026)].value == pytest.approx(70_000)
    assert cells[("baseline/benefit_caseload", 2026)].value == pytest.approx(700)
    assert cells[("baseline/households", 2026)].value == pytest.approx(1_000)
    assert cells[("baseline/poverty_children", 2026)].value == pytest.approx(0.0)
    assert cells[("baseline/net_income_mean/decile_3", 2026)].value == pytest.approx(32_100)
    assert cells[("baseline/net_income_mean/decile_2", 2026)].value is None


def test_reform_outputs_cover_every_level():
    spec = parse_spec(fake_spec_dict())
    result = measure(spec, FakeBackend())
    cells = cells_by_output(result)
    assert result.status == "ok"
    assert cells[("reform/tax_up/target/income_tax", 2026)].value == pytest.approx(2_350_000)
    assert cells[("reform/tax_up/budgetary_impact", 2026)].value == pytest.approx(2_350_000)
    assert cells[("reform/tax_up/programme/income_tax", 2026)].value == pytest.approx(2_350_000)
    assert cells[("reform/tax_up/programme/benefit", 2026)].value == pytest.approx(0)
    assert cells[("reform/tax_up/households_losing", 2026)].value == pytest.approx(1_000)
    assert cells[("reform/tax_up/households_gaining", 2026)].value == pytest.approx(0)
    assert cells[("reform/tax_up/people_losing", 2026)].value == pytest.approx(1_800)
    assert cells[("reform/tax_up/net_income_change_pct", 2026)].value == pytest.approx(
        100 * -2_350_000 / 18_870_000
    )
    assert cells[("reform/tax_up/poverty/poverty/all", 2026)].value == pytest.approx(0)
    # A benefit increase costs money: the budgetary impact is negative.
    assert cells[("reform/benefit_up/budgetary_impact", 2026)].value == pytest.approx(-70_000)
    assert cells[("reform/benefit_up/programme/benefit", 2026)].value == pytest.approx(70_000)
    assert cells[("reform/benefit_up/households_gaining", 2026)].value == pytest.approx(700)


def test_one_baseline_simulation_and_one_per_reform():
    backend = FakeBackend()
    spec = parse_spec(fake_spec_dict())
    result = measure(spec, backend)
    assert len(backend.builds) == 1 + len(spec.reforms)
    assert [s["label"] for s in result.simulations] == [
        "baseline",
        "reform:tax_up",
        "reform:benefit_up",
    ]
    # The add reform is the model's own baseline value plus the delta.
    applied = result.reforms["tax_up"]["applied"]["gov.tax.rate"]
    assert applied == {"2026-01-01.2026-12-31": pytest.approx(0.3)}


def test_a_crashing_reform_is_a_gap_never_a_zero():
    backend = FakeBackend(fail_on=lambda reform: bool(reform) and "gov.tax.rate" in reform)
    result = measure(parse_spec(fake_spec_dict()), backend)
    assert result.status == "partial"
    assert result.reforms["tax_up"]["status"] == "error"
    assert result.reforms["tax_up"]["error"]["class"] == "RuntimeError"
    assert not [c for c in result.cells if c.output.startswith("reform/tax_up/")]
    assert result.reforms["benefit_up"]["status"] == "ok"


def test_a_failing_baseline_ends_the_measurement():
    backend = FakeBackend(fail_on=lambda reform: True)
    with pytest.raises(MeasurementError) as caught:
        measure(parse_spec(fake_spec_dict()), backend)
    assert caught.value.stage == "load"


def test_an_unknown_reform_parameter_is_an_error_for_that_reform_only():
    spec = parse_spec(
        fake_spec_dict(
            reforms=[
                {"id": "bad", "add": {"gov.tax.missing": 1.0}, "targets": ["income_tax"]},
                {"id": "tax_up", "add": {"gov.tax.rate": 0.1}, "targets": ["income_tax"]},
            ]
        )
    )
    result = measure(spec, FakeBackend())
    assert result.reforms["bad"]["status"] == "error"
    assert result.reforms["bad"]["error"]["stage"] == "reform_definition"
    assert result.reforms["bad"]["error"]["name"] == "gov.tax.missing"
    assert result.reforms["tax_up"]["status"] == "ok"


def test_group_entities_find_their_household_through_people():
    # policyengine-core's group-to-group mapping divides and re-sums, which
    # breaks ids; the frame must still place each benefit unit in its household.
    spec = parse_spec(fake_spec_dict())
    frame = build_frame(FakeSim(baseline_world()), spec, 2026, {"benunit", "person"})
    assert frame.positions["benunit"].tolist() == [0, 0, 1, 2, 3]
    assert frame.positions["person"].tolist() == [0, 0, 0, 1, 1, 2, 3, 3]


def test_targets_only_runs_compute_no_net_income():
    calls = []

    class CountingSim(FakeSim):
        def values(self, variable, period, map_to=None):
            calls.append(variable)
            return super().values(variable, period, map_to)

    class Backend(FakeBackend):
        def build(self, reform):
            base = super().build(reform)
            return CountingSim(base.world)

    spec = parse_spec(
        fake_spec_dict(
            outputs=["targets"],
            variables={"groups": {"all": None}},
            baseline=[{"id": "income_tax", "variable": "income_tax", "stat": "sum", "kind": "tax"}],
        )
    )
    result = measure(spec, Backend())
    assert result.status == "ok"
    assert "net_income" not in calls and "gov_balance" not in calls
    outputs = {c.output for c in result.cells}
    assert "reform/tax_up/target/income_tax" in outputs
    assert not any("budgetary_impact" in o for o in outputs)


def test_cells_carry_household_level_support_masks():
    result = measure(parse_spec(fake_spec_dict()), FakeBackend())
    cell = cells_by_output(result)[("baseline/benefit", 2026)]
    assert cell.supports[0].dtype == bool
    assert cell.supports[0].tolist() == [True, True, False, True]
    assert np.asarray(result.household_ids).tolist() == [10, 20, 30, 40]

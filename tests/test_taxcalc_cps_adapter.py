from pathlib import Path

import numpy as np
import pytest

from evaluation_harness.adapters.taxcalc_cps import TaxCalcCPSRunner
from evaluation_harness.execution import RunGroup, build_run_groups, execute_groups
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


class FakeCalculator:
    def __init__(self, arrays: dict[str, np.ndarray]) -> None:
        self.arrays = arrays
        self.calls: list[str] = []

    def array(self, name: str) -> np.ndarray:
        self.calls.append(name)
        return self.arrays[name]


def group(*variables: str) -> RunGroup:
    return RunGroup(
        source_id="taxcalc_public_cps_2024",
        population_period="tax_year:2024",
        policy_period="tax_year:2024",
        geography_method="fixed_country",
        entity="tax_unit",
        fact_keys=("fact",),
        required_variables=variables,
    )


def test_runner_constructs_one_calculator_and_caches_arrays() -> None:
    calculator = FakeCalculator(
        {
            "s006": np.array([1.0, 2.0]),
            "c00100": np.array([10.0, 20.0]),
            "MARS": np.array([1, 2]),
            "EIC": np.array([0, 1]),
        }
    )
    factory_calls: list[int] = []

    def factory(year: int):
        factory_calls.append(year)
        return calculator

    runner = TaxCalcCPSRunner(calculator_factory=factory)
    first = runner.prepare(group("s006", "c00100"))
    runner.prepare(group("s006", "c00100"))
    assert factory_calls == [2024]
    assert calculator.calls == ["s006", "c00100", "MARS", "EIC"]
    assert first.dataset_version == "taxcalc-cps-2014@6.7.1"
    assert first.model_version == "taxcalc==6.7.1"


def test_runner_exposes_geography_domains_and_breakdown_dimensions() -> None:
    calculator = FakeCalculator(
        {
            "s006": np.ones(5),
            "MARS": np.array([1, 2, 3, 4, 5]),
            "EIC": np.array([0, 1, 2, 3, 4]),
        }
    )
    bundle = TaxCalcCPSRunner(calculator_factory=lambda _: calculator).prepare(
        group("s006", "filing_status", "eitc_child_count")
    )
    assert bundle.arrays["__geography__"].tolist() == ["0100000US"] * 5
    assert bundle.arrays["filing_status"].tolist() == [
        "single", "joint", "separate", "head_of_household", "surviving_spouse"
    ]
    assert bundle.arrays["eitc_child_count"].tolist() == [0, 1, 2, "3plus", "3plus"]
    assert set(bundle.domain_masks) == {
        "all_individual_income_tax_returns",
        "individual_income_tax_returns",
    }
    assert all(mask.all() for mask in bundle.domain_masks.values())


def test_runner_rejects_wrong_entity_geography_and_array_lengths() -> None:
    calculator = FakeCalculator(
        {"s006": np.ones(2), "MARS": np.ones(2), "EIC": np.zeros(2), "c00100": np.ones(3)}
    )
    runner = TaxCalcCPSRunner(calculator_factory=lambda _: calculator)
    with pytest.raises(ValueError, match="entity"):
        runner.prepare(RunGroup(**{**group("s006").__dict__, "entity": "person"}))
    with pytest.raises(ValueError, match="geography"):
        runner.prepare(RunGroup(**{**group("s006").__dict__, "geography_method": "state_fips"}))
    with pytest.raises(ValueError, match="length"):
        runner.prepare(group("s006", "c00100"))


def test_all_ten_reviewed_ledger_facts_execute_numerically() -> None:
    integration = Path("integrations/taxcalc_cps")
    overview = load_integration_overview(integration / "overview.yaml")
    mappings = MappingRegistry.from_yaml(integration / "mappings.yaml")
    capabilities = tuple(
        CapabilityPlanner(mappings, snapshot_id=overview.ledger_snapshot_id).classify(
            fact, overview.source
        )
        for fact in overview.verification_facts
    )
    targets = {fact.measure: float(fact.value) for fact in overview.verification_facts}
    arrays = {
        "s006": np.array([1.0]),
        "MARS": np.array([1]),
        "EIC": np.array([1]),
        "iitax": np.array([targets["irs_soi.income_tax_liability_after_credits"]]),
        "c00100": np.array([targets["us:statutes/26/62#adjusted_gross_income"]]),
        "e00200": np.array([targets["cbo.wages_and_salaries_projection"]]),
        "e00300": np.array([targets["irs_soi.taxable_interest"]]),
        "e00600": np.array([targets["irs_soi.ordinary_dividends"]]),
        "e01700": np.array([targets["irs_soi.taxable_pensions_and_annuities"]]),
        "c02500": np.array([targets["irs_soi.taxable_social_security_benefits"]]),
        "e02300": np.array([targets["irs_soi.unemployment_compensation"]]),
        "c59660": np.array([targets["irs_soi.total_earned_income_credit"]]),
    }
    count_fact = next(f for f in overview.verification_facts if f.unit == "count")
    count_caps = tuple(c for c in capabilities if c.fact_key == count_fact.fact_key)
    amount_caps = tuple(c for c in capabilities if c.fact_key != count_fact.fact_key)
    count_arrays = {
        **arrays,
        "s006": np.array([float(count_fact.value)]),
        "iitax": np.array([1.0]),
    }
    count_runner = TaxCalcCPSRunner(
        calculator_factory=lambda _: FakeCalculator(count_arrays)
    )
    amount_runner = TaxCalcCPSRunner(calculator_factory=lambda _: FakeCalculator(arrays))
    count_results = execute_groups(
        build_run_groups(count_caps), count_caps, {overview.source.source_id: count_runner}
    )
    amount_results = execute_groups(
        build_run_groups(amount_caps), amount_caps, {overview.source.source_id: amount_runner}
    )
    facts = {fact.fact_key: fact for fact in overview.verification_facts}
    assert len(count_results + amount_results) == 10
    for result in count_results + amount_results:
        assert float(result.estimate) == pytest.approx(
            float(facts[result.fact_key].value), rel=1e-12
        )

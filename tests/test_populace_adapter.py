from pathlib import Path

import numpy as np
import pytest

from evaluation_harness.adapters.populace import (
    POPULACE_RELEASE,
    PopulacePolicyEngineRunner,
    PopulaceRelease,
    resolve_release_dataset,
)
from evaluation_harness.execution import RunGroup
from evaluation_harness.execution import build_run_groups, execute_groups
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import CapabilityPlanner


class FakeVariable:
    def __init__(self, entity: str) -> None:
        self.entity = type("Entity", (), {"key": entity})()


class FakeSystem:
    def __init__(self, entities: dict[str, str]) -> None:
        self.entities = entities

    def get_variable(self, name: str) -> FakeVariable:
        return FakeVariable(self.entities[name])


class FakeSimulation:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, bool]] = []
        self.tax_benefit_system = FakeSystem(
            {
                "eitc": "tax_unit",
                "eitc_child_count": "tax_unit",
                "adjusted_gross_income": "tax_unit",
            }
        )

    def calculate(self, name: str, period: str, use_weights: bool = False) -> np.ndarray:
        self.calls.append((name, period, use_weights))
        values = {
            "eitc": np.array([0.0, 1_000.0]),
            "eitc_child_count": np.array([0, 2]),
            "adjusted_gross_income": np.array([5_000.0, 25_000.0]),
        }
        return values[name]


@pytest.fixture
def tables() -> dict[str, dict[str, np.ndarray]]:
    return {
        "household": {
            "household_id": np.array([10, 20]),
            "state_fips": np.array([1, 6]),
            "congressional_district_geoid": np.array([101, 612]),
            "household_weight": np.array([2.0, 3.0]),
        },
        "person": {
            "person_id": np.array([1, 2, 3]),
            "person_household_id": np.array([10, 20, 20]),
            "person_tax_unit_id": np.array([100, 200, 200]),
            "person_weight": np.array([1.0, 1.5, 1.5]),
            "age": np.array([4, 10, 30]),
            "employment_income": np.array([0.0, 10_000.0, 40_000.0]),
        },
        "tax_unit": {
            "tax_unit_id": np.array([100, 200]),
            "tax_unit_weight": np.array([1.0, 2.0]),
        },
    }


def group(entity: str, *variables: str) -> RunGroup:
    return RunGroup(
        source_id="populace_us_policyengine_us_2024",
        population_period="calendar_year:2024",
        policy_period="tax_year:2024",
        geography_method="fixed_country",
        entity=entity,
        fact_keys=("fact",),
        required_variables=variables,
    )


def runner(tables, simulation=None) -> PopulacePolicyEngineRunner:
    simulation = simulation or FakeSimulation()
    return PopulacePolicyEngineRunner(
        dataset_path=Path("fixture.h5"),
        release=POPULACE_RELEASE,
        table_loader=lambda _: tables,
        simulation_factory=lambda _: simulation,
    )


def test_release_dataset_is_checksum_verified(tmp_path: Path) -> None:
    payload = b"pinned populace"
    release = PopulaceRelease(
        release_id="fixture",
        dataset_filename="fixture.h5",
        dataset_sha256=__import__("hashlib").sha256(payload).hexdigest(),
        model_version="1.0",
    )
    path = resolve_release_dataset(release, tmp_path, lambda _, target: target.write_bytes(payload))
    assert path.read_bytes() == payload
    bad = PopulaceRelease("fixture", "bad.h5", "0" * 64, "1.0")
    with pytest.raises(ValueError, match="checksum"):
        resolve_release_dataset(bad, tmp_path, lambda _, target: target.write_bytes(payload))


def test_release_url_uses_the_immutable_hugging_face_revision() -> None:
    assert POPULACE_RELEASE.download_url == (
        "https://huggingface.co/datasets/policyengine/populace-us/resolve/"
        "populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z/"
        "populace_us_2024.h5"
    )


def test_runner_builds_entity_specific_geographies(tables) -> None:
    adapter = runner(tables)
    person = adapter.prepare(group("person", "person_weight", "__geography__"))
    household = adapter.prepare(group("household", "household_weight", "__geography__"))
    tax_unit = adapter.prepare(group("tax_unit", "tax_unit_weight", "__geography__"))
    assert person.arrays["__geography__"].tolist() == [
        "0100000US", "0100000US", "0100000US"
    ]
    assert person.arrays["__state_geography__"].tolist() == [
        "0400000US01", "0400000US06", "0400000US06"
    ]
    assert household.arrays["__district_geography__"].tolist() == [
        "5001900US0101", "5001900US0612"
    ]
    assert tax_unit.arrays["__state_geography__"].tolist() == [
        "0400000US01", "0400000US06"
    ]


def test_requested_geography_method_selects_the_query_geography(tables) -> None:
    state_group = group("person", "person_weight", "__geography__")
    state_group = RunGroup(**{**state_group.__dict__, "geography_method": "state_fips"})
    bundle = runner(tables).prepare(state_group)
    assert bundle.arrays["__geography__"].tolist() == [
        "0400000US01", "0400000US06", "0400000US06"
    ]


def test_policy_variables_are_aliased_and_cached(tables) -> None:
    simulation = FakeSimulation()
    adapter = runner(tables, simulation)
    requested = group(
        "tax_unit",
        "tax_unit_weight",
        "eitc",
        "us:statutes/26/62#adjusted_gross_income",
    )
    first = adapter.prepare(requested)
    adapter.prepare(requested)
    assert first.arrays["us:statutes/26/62#adjusted_gross_income"].tolist() == [
        5_000.0, 25_000.0
    ]
    assert simulation.calls == [
        ("eitc", "2024", False),
        ("adjusted_gross_income", "2024", False),
    ]


def test_model_entity_mismatch_and_ambiguous_tax_unit_join_are_rejected(tables) -> None:
    simulation = FakeSimulation()
    simulation.tax_benefit_system = FakeSystem({"eitc": "person"})
    with pytest.raises(ValueError, match="belongs to entity"):
        runner(tables, simulation).prepare(group("tax_unit", "eitc"))

    broken = {name: dict(table) for name, table in tables.items()}
    broken["person"]["person_household_id"] = np.array([10, 20, 10])
    with pytest.raises(ValueError, match="multiple households"):
        runner(broken).prepare(group("tax_unit", "tax_unit_weight", "__geography__"))


def test_supported_populace_domains_are_explicit_masks(tables) -> None:
    bundle = runner(tables).prepare(group("person", "person_weight"))
    assert set(bundle.domain_masks) == {
        "resident_population",
        "total_population",
        "compensation_of_employees",
    }
    assert bundle.domain_masks["resident_population"].all()


def test_eitc_return_domain_and_ledger_child_constraint_are_model_backed(tables) -> None:
    bundle = runner(tables).prepare(
        group(
            "tax_unit",
            "tax_unit_weight",
            "us.tax.earned_income_credit_qualifying_children",
        )
    )
    assert bundle.arrays[
        "us.tax.earned_income_credit_qualifying_children"
    ].tolist() == [0, 2]
    assert bundle.domain_masks[
        "individual_income_tax_returns_with_earned_income_credit"
    ].tolist() == [False, True]


def test_all_ten_reviewed_ledger_facts_execute_numerically() -> None:
    integration = Path("integrations/populace_policyengine_us")
    overview = load_integration_overview(integration / "overview.yaml")
    mappings = MappingRegistry.from_yaml(integration / "mappings.yaml")
    capabilities = tuple(
        CapabilityPlanner(mappings, snapshot_id=overview.ledger_snapshot_id).classify(
            fact, overview.source
        )
        for fact in overview.verification_facts
    )
    person_weights = np.array([2_083_154.0, 37_348_109.0, 16_516_160.0, 284_163_565.0])
    tax_weights = np.array([3_819_056.0, 20_018_093.0, 0.0, 0.0])
    bracket_eitc = 9_085_291_000.0 / tax_weights[0]
    other_eitc = (69_041_649_000.0 - 9_085_291_000.0) / tax_weights[1]
    target_tables = {
        "household": {
            "household_id": np.array([10, 20, 30, 40]),
            "state_fips": np.array([6, 6, 1, 36]),
            "congressional_district_geoid": np.array([612, 612, 101, 3610]),
            "household_weight": np.array([1.0, 1.0, 300_636.0, 1.0]),
        },
        "person": {
            "person_id": np.array([1, 2, 3, 4]),
            "person_household_id": np.array([10, 20, 30, 40]),
            "person_tax_unit_id": np.array([100, 200, 300, 400]),
            "age": np.array([4, 30, 4, 30]),
        },
        "tax_unit": {
            "tax_unit_id": np.array([100, 200, 300, 400]),
            "tax_unit_weight": tax_weights,
        },
    }

    class TargetSimulation:
        tax_benefit_system = FakeSystem(
            {
                "person_weight": "person",
                "employment_income": "person",
                "eitc": "tax_unit",
                "adjusted_gross_income": "tax_unit",
            }
        )

        def calculate(self, name, period, use_weights=False):
            assert period == "2024" and use_weights is False
            return {
                "person_weight": person_weights,
                "employment_income": np.array(
                    [0.0, 0.0, 0.0, 12_387_929_000_000.0 / person_weights[3]]
                ),
                "eitc": np.array([bracket_eitc, other_eitc, 0.0, 0.0]),
                "adjusted_gross_income": np.array([12_000.0, 25_000.0, 0.0, 0.0]),
            }[name]

    adapter = PopulacePolicyEngineRunner(
        dataset_path="fixture.h5",
        table_loader=lambda _: target_tables,
        simulation_factory=lambda _: TargetSimulation(),
    )
    results = execute_groups(
        build_run_groups(capabilities),
        capabilities,
        {overview.source.source_id: adapter},
    )
    targets = {fact.fact_key: float(fact.value) for fact in overview.verification_facts}
    assert len(results) == 10
    for result in results:
        assert float(result.estimate) == pytest.approx(targets[result.fact_key], rel=1e-12)

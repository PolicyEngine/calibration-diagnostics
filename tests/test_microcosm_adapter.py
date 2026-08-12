from pathlib import Path

import numpy as np
import pytest

from evaluation_harness.adapters.microcosm import (
    MICROCOSM_RELEASE,
    MicrocosmPolicyEngineRunner,
    MicrocosmRelease,
    resolve_release_calibration_diagnostics,
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
                "assigned_aca_ptc": "tax_unit",
                "age": "person",
                "base_part_a_premium": "person",
                "chip_enrolled": "person",
                "ctc": "tax_unit",
                "ctc_limiting_tax_liability": "tax_unit",
                "employer_federal_unemployment_tax": "person",
                "employer_medicare_tax": "person",
                "employer_social_security_tax": "person",
                "employer_state_payroll_tax": "person",
                "gross_medicare_part_b_premium": "person",
                "medicare_cost": "person",
                "medicaid_enrolled": "person",
                "medical_expense_deduction": "tax_unit",
                "ordinary_dividend_income": "person",
                "person_receives_aca": "person",
                "rental_income": "person",
                "farm_rent_income": "person",
                "roth_ira_contributions": "person",
                "snap": "spm_unit",
                "snap_unit_size": "spm_unit",
                "ssi_category": "person",
                "self_employment_income": "person",
                "tanf": "spm_unit",
                "tax_unit_is_filer": "tax_unit",
                "tax_unit_itemizes": "tax_unit",
            }
        )

    def calculate(self, name: str, period: str, use_weights: bool = False) -> np.ndarray:
        self.calls.append((name, period, use_weights))
        values = {
            "eitc": np.array([0.0, 1_000.0]),
            "eitc_child_count": np.array([0, 2]),
            "adjusted_gross_income": np.array([5_000.0, 25_000.0]),
            "assigned_aca_ptc": np.array([1_200.0, 3_600.0]),
            "age": np.array([4, 10, 30]),
            "base_part_a_premium": np.array([0.0, 100.0, 200.0]),
            "chip_enrolled": np.array([False, True, False]),
            "ctc": np.array([500.0, 3_000.0]),
            "ctc_limiting_tax_liability": np.array([400.0, 2_200.0]),
            "employer_federal_unemployment_tax": np.array([1.0, 2.0, 3.0]),
            "employer_medicare_tax": np.array([4.0, 5.0, 6.0]),
            "employer_social_security_tax": np.array([7.0, 8.0, 9.0]),
            "employer_state_payroll_tax": np.array([10.0, 20.0, 30.0]),
            "gross_medicare_part_b_premium": np.array([0.0, 300.0, 400.0]),
            "medicare_cost": np.array([0.0, 8_000.0, 9_000.0]),
            "medicaid_enrolled": np.array([True, False, False]),
            "medical_expense_deduction": np.array([40.0, 70.0]),
            "ordinary_dividend_income": np.array([10.0, 20.0, 30.0]),
            "person_receives_aca": np.array([True, True, True]),
            "rental_income": np.array([0.0, 100.0, -25.0]),
            "farm_rent_income": np.array([0.0, 0.0, 25.0]),
            "roth_ira_contributions": np.array([0.0, 100.0, 200.0]),
            "snap": np.array([0.0, 500.0]),
            "snap_unit_size": np.array([1, 2]),
            "ssi_category": np.array(["AGED", "BLIND", "DISABLED"]),
            "self_employment_income": np.array([100.0, -200.0, 50.0]),
            "tanf": np.array([0.0, 500.0]),
            "tax_unit_is_filer": np.array([False, True]),
            "tax_unit_itemizes": np.array([False, True]),
        }
        return values[name]


@pytest.fixture
def tables() -> dict[str, dict[str, np.ndarray]]:
    return {
        "household": {
            "household_id": np.array([10, 20]),
            "block_geoid": np.array(["010010201001000", "060014001001000"]),
            "state_fips": np.array([1, 6]),
            "congressional_district_geoid": np.array([101, 612]),
            "household_weight": np.array([2.0, 3.0]),
        },
        "person": {
            "person_id": np.array([1, 2, 3]),
            "person_household_id": np.array([10, 20, 20]),
            "person_tax_unit_id": np.array([100, 200, 200]),
            "person_spm_unit_id": np.array([1_000, 2_000, 2_000]),
            "person_weight": np.array([1.0, 1.5, 1.5]),
            "age": np.array([4, 10, 30]),
            "employment_income": np.array([0.0, 10_000.0, 40_000.0]),
        },
        "tax_unit": {
            "tax_unit_id": np.array([100, 200]),
            "tax_unit_weight": np.array([1.0, 2.0]),
        },
        "spm_unit": {
            "spm_unit_id": np.array([1_000, 2_000]),
        },
    }


def group(entity: str, *variables: str) -> RunGroup:
    return RunGroup(
        source_id="microcosm_us_policyengine_us_2024",
        population_period="calendar_year:2024",
        policy_period="tax_year:2024",
        geography_method="fixed_country",
        entity=entity,
        fact_keys=("fact",),
        required_variables=variables,
    )


def runner(tables, simulation=None) -> MicrocosmPolicyEngineRunner:
    simulation = simulation or FakeSimulation()
    return MicrocosmPolicyEngineRunner(
        dataset_path=Path("fixture.h5"),
        release=MICROCOSM_RELEASE,
        table_loader=lambda _: tables,
        simulation_factory=lambda _: simulation,
    )


def test_runner_interprets_cps_asec_age_topcodes_as_group_indicators(tables) -> None:
    class TopcodedAgeSimulation(FakeSimulation):
        def calculate(
            self, name: str, period: str, use_weights: bool = False
        ) -> np.ndarray:
            if name == "age":
                return np.array([79, 80, 81, 84, 85, 90])
            return super().calculate(name, period, use_weights)

    adapter = runner(tables, TopcodedAgeSimulation())

    assert adapter._model_array(  # noqa: SLF001 - adapter expression contract
        "cps_asec_age_80_84_population", "person", "2024"
    ).tolist() == [False, True, False, False, False, False]
    assert adapter._model_array(  # noqa: SLF001 - adapter expression contract
        "cps_asec_age_85_plus_population", "person", "2024"
    ).tolist() == [False, False, False, False, True, False]


def test_runner_materializes_audited_bea_macro_expressions(tables) -> None:
    adapter = runner(tables)

    employer_contributions = adapter._model_array(  # noqa: SLF001
        "bea_nipa_employer_government_social_insurance_contributions",
        "person",
        "2024",
    )
    gross_medicare = adapter._model_array(  # noqa: SLF001
        "bea_nipa_gross_medicare_benefits",
        "person",
        "2024",
    )

    assert employer_contributions.tolist() == [22.0, 35.0, 48.0]
    assert gross_medicare.tolist() == [0.0, 8_400.0, 9_600.0]


def test_runner_exposes_modeled_tanf_receiving_units_for_caseload_counts(tables) -> None:
    bundle = runner(tables).prepare(group("spm_unit", "tanf"))

    assert bundle.arrays["tanf"].tolist() == [0.0, 500.0]


def test_release_dataset_is_checksum_verified(tmp_path: Path) -> None:
    payload = b"pinned microcosm"
    release = MicrocosmRelease(
        release_id="fixture",
        dataset_filename="fixture.h5",
        dataset_sha256=__import__("hashlib").sha256(payload).hexdigest(),
        model_version="1.0",
    )
    path = resolve_release_dataset(release, tmp_path, lambda _, target: target.write_bytes(payload))
    assert path.read_bytes() == payload
    bad = MicrocosmRelease("fixture", "bad.h5", "0" * 64, "1.0")
    with pytest.raises(ValueError, match="checksum"):
        resolve_release_dataset(bad, tmp_path, lambda _, target: target.write_bytes(payload))


def test_release_calibration_diagnostics_are_independently_pinned(tmp_path: Path) -> None:
    payload = b'{"targets": []}'
    checksum = __import__("hashlib").sha256(payload).hexdigest()
    release = MicrocosmRelease(
        release_id="fixture",
        dataset_filename="fixture.h5",
        dataset_sha256="0" * 64,
        model_version="1.0",
        calibration_diagnostics_filename="release/calibration_diagnostics.json",
        calibration_diagnostics_sha256=checksum,
    )

    path = resolve_release_calibration_diagnostics(
        release,
        tmp_path,
        lambda _, target: target.write_bytes(payload),
    )

    assert path.read_bytes() == payload


def test_release_url_uses_the_immutable_hugging_face_revision() -> None:
    assert MICROCOSM_RELEASE.download_url == (
        "https://huggingface.co/datasets/policyengine/microcosm-us/resolve/"
        "microcosm-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z/"
        "microcosm_us_2024.h5"
    )


def test_runner_builds_entity_specific_geographies(tables) -> None:
    adapter = runner(tables)
    person = adapter.prepare(group("person", "person_weight", "__geography__"))
    household = adapter.prepare(group("household", "household_weight", "__geography__"))
    tax_unit = adapter.prepare(group("tax_unit", "tax_unit_weight", "__geography__"))
    spm_unit = adapter.prepare(group("spm_unit", "spm_unit_weight", "__geography__"))
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
    assert spm_unit.arrays["__state_geography__"].tolist() == [
        "0400000US01", "0400000US06"
    ]
    assert spm_unit.arrays["spm_unit_weight"].tolist() == [2.0, 3.0]


def test_runner_can_use_exact_old_districts_derived_from_household_blocks(tables) -> None:
    adapter = MicrocosmPolicyEngineRunner(
        dataset_path=Path("fixture.h5"),
        table_loader=lambda _: tables,
        simulation_factory=lambda _: FakeSimulation(),
        old_congressional_district_assignments={
            "010010201001000": "5001700US0102",
            "060014001001000": "5001700US0613",
        },
    )
    old_group = RunGroup(
        source_id="microcosm_us_policyengine_us_2024",
        population_period="calendar_year:2024",
        policy_period="tax_year:2024",
        geography_method="congressional_district_geoid_117th",
        entity="person",
        fact_keys=("fact",),
        required_variables=("person_weight",),
    )

    bundle = adapter.prepare(old_group)

    assert bundle.arrays["__geography__"].tolist() == [
        "5001700US0102",
        "5001700US0613",
        "5001700US0613",
    ]
    assert bundle.arrays["__district_geography__"].tolist() == [
        "5001900US0101",
        "5001900US0612",
        "5001900US0612",
    ]


def test_old_district_evaluation_rejects_unassigned_household_blocks(tables) -> None:
    adapter = MicrocosmPolicyEngineRunner(
        dataset_path=Path("fixture.h5"),
        table_loader=lambda _: tables,
        simulation_factory=lambda _: FakeSimulation(),
        old_congressional_district_assignments={
            "010010201001000": "5001700US0102"
        },
    )
    old_group = RunGroup(
        source_id="microcosm_us_policyengine_us_2024",
        population_period="calendar_year:2024",
        policy_period="tax_year:2024",
        geography_method="congressional_district_geoid_117th",
        entity="household",
        fact_keys=("fact",),
        required_variables=("household_weight",),
    )

    with pytest.raises(ValueError, match="old congressional district assignment"):
        adapter.prepare(old_group)


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
        ("tax_unit_is_filer", "2024", False),
    ]


def test_person_variables_can_be_explicitly_aggregated_to_tax_units(tables) -> None:
    simulation = FakeSimulation()
    bundle = runner(tables, simulation).prepare(
        group(
            "tax_unit",
            "tax_unit_sum_person:ordinary_dividend_income",
            "tax_unit_count_person:roth_ira_contributions",
        )
    )
    assert bundle.arrays[
        "tax_unit_sum_person:ordinary_dividend_income"
    ].tolist() == [10.0, 50.0]
    assert bundle.arrays[
        "tax_unit_count_person:roth_ira_contributions"
    ].tolist() == [0, 2]


def test_rental_royalty_build_concept_combines_the_same_base_variables(tables) -> None:
    bundle = runner(tables).prepare(
        group(
            "tax_unit",
            "tax_unit_sum_person:rental_income+farm_rent_income",
        )
    )

    assert bundle.arrays[
        "tax_unit_sum_person:rental_income+farm_rent_income"
    ].tolist() == [0.0, 100.0]


def test_soi_income_components_use_the_builds_positive_part_semantics(tables) -> None:
    bundle = runner(tables).prepare(
        group(
            "tax_unit",
            "soi_positive:tax_unit_sum_person:self_employment_income",
        )
    )

    assert bundle.arrays[
        "soi_positive:tax_unit_sum_person:self_employment_income"
    ].tolist() == [100.0, 0.0]


def test_soi_itemized_components_apply_the_builds_itemizer_mask(tables) -> None:
    bundle = runner(tables).prepare(
        group("tax_unit", "soi_itemized:medical_expense_deduction")
    )

    assert bundle.arrays["soi_itemized:medical_expense_deduction"].tolist() == [
        0.0,
        70.0,
    ]


def test_soi_ctc_is_capped_by_limiting_tax_liability_like_the_build(tables) -> None:
    bundle = runner(tables).prepare(group("tax_unit", "soi_capped_ctc"))

    assert bundle.arrays["soi_capped_ctc"].tolist() == [400.0, 2_200.0]


def test_tax_unit_aca_credit_is_allocated_to_recipient_people_per_month(tables) -> None:
    bundle = runner(tables).prepare(
        group(
            "person",
            "person_assigned_aca_ptc_per_month",
            "person_receives_aca",
        )
    )
    assert bundle.arrays["person_assigned_aca_ptc_per_month"].tolist() == [
        100.0,
        150.0,
        150.0,
    ]


def test_medicaid_or_chip_enrollment_is_a_person_level_union(tables) -> None:
    bundle = runner(tables).prepare(
        group("person", "medicaid_or_chip_enrolled")
    )
    assert bundle.arrays["medicaid_or_chip_enrolled"].tolist() == [
        True,
        True,
        False,
    ]


def test_medicaid_age_groups_match_cms_child_and_adult_definitions(tables) -> None:
    bundle = runner(tables).prepare(
        group(
            "person",
            "adult_medicaid_enrolled",
            "child_medicaid_or_chip_enrolled",
        )
    )

    assert bundle.arrays["adult_medicaid_enrolled"].tolist() == [
        False,
        False,
        False,
    ]
    assert bundle.arrays["child_medicaid_or_chip_enrolled"].tolist() == [
        True,
        True,
        False,
    ]


def test_snap_administrative_person_measures_use_snap_unit_membership(tables) -> None:
    bundle = runner(tables).prepare(
        group(
            "spm_unit",
            "snap_recipient_count",
            "snap_recipient_person_months",
        )
    )

    assert bundle.arrays["snap_recipient_count"].tolist() == [0, 2]
    assert bundle.arrays["snap_recipient_person_months"].tolist() == [0, 24]


def test_household_snap_receipt_bridge_uses_positive_spm_benefits(tables) -> None:
    bundle = runner(tables).prepare(group("household", "snap_receipt_status"))
    assert bundle.arrays["snap_receipt_status"].tolist() == [
        "not_receiving_food_stamps_snap",
        "receiving_food_stamps_snap",
    ]


def test_policyengine_enum_values_are_normalized_for_chronicle_constraints(tables) -> None:
    bundle = runner(tables).prepare(group("person", "ssi_category"))
    assert bundle.arrays["ssi_category"].tolist() == ["aged", "blind", "disabled"]


def test_model_entity_mismatch_and_ambiguous_tax_unit_join_are_rejected(tables) -> None:
    simulation = FakeSimulation()
    simulation.tax_benefit_system = FakeSystem({"eitc": "person"})
    with pytest.raises(ValueError, match="belongs to entity"):
        runner(tables, simulation).prepare(group("tax_unit", "eitc"))

    broken = {name: dict(table) for name, table in tables.items()}
    broken["person"]["person_household_id"] = np.array([10, 20, 10])
    with pytest.raises(ValueError, match="multiple households"):
        runner(broken).prepare(group("tax_unit", "tax_unit_weight", "__geography__"))


def test_supported_microcosm_domains_are_explicit_masks(tables) -> None:
    bundle = runner(tables).prepare(group("person", "person_weight"))
    assert set(bundle.domain_masks) == {
        "aca_marketplace_effectuated_enrollment",
        "aca_marketplace_qhp_selections",
        "medicaid_chip_enrollment",
        "medicare_financing",
        "national_health_expenditures",
        "resident_population",
        "total_population",
        "population_projection",
        "compensation_of_employees",
        "personal_income",
        "personal_current_transfer_receipts",
        "social_security_and_ssi_payments",
    }
    assert bundle.domain_masks["resident_population"].all()

    households = runner(tables).prepare(group("household", "household_weight"))
    assert set(households.domain_masks) == {
        "household_balance_sheet",
        "households",
    }

    tax_units = runner(tables).prepare(group("tax_unit", "tax_unit_weight"))
    assert tax_units.domain_masks["all_individual_income_tax_returns"].tolist() == [
        False,
        True,
    ]

    spm_units = runner(tables).prepare(group("spm_unit", "spm_unit_weight"))
    assert set(spm_units.domain_masks) == {
        "liheap_state_programs",
        "supplemental_nutrition_assistance_program",
        "tanf_cash_assistance",
        "tanf_caseload",
    }
    assert "state_government_tax_collections" in tax_units.domain_masks


def test_eitc_return_domain_and_chronicle_child_constraint_are_model_backed(tables) -> None:
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


def test_all_ten_reviewed_chronicle_facts_execute_numerically() -> None:
    integration = Path("integrations/microcosm_policyengine_us")
    overview = load_integration_overview(integration / "overview.yaml")
    mappings = MappingRegistry.from_yaml(integration / "mappings.yaml")
    capabilities = tuple(
        CapabilityPlanner(mappings, snapshot_id=overview.chronicle_snapshot_id).classify(
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
                "tax_unit_is_filer": "tax_unit",
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
                "adjusted_gross_income": np.array(
                    [12_000.0, 25_000.0, 0.0, 0.0]
                ),
                "tax_unit_is_filer": np.array([True, True, True, True]),
            }[name]

    adapter = MicrocosmPolicyEngineRunner(
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

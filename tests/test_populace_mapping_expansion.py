from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from evaluation_harness.contracts import (
    AlignmentQuality,
    CapabilityStatus,
    FactContract,
    TypedPeriod,
)
from evaluation_harness.integration import load_integration_overview
from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.planner import AlignmentDeclaration, CapabilityPlanner


INTEGRATION = Path("integrations/populace_policyengine_us")


def _fact(
    source: str,
    measure: str,
    unit: str,
    entity: str,
    domain: str,
    *,
    constraints: tuple[dict, ...] = (),
    dimensions: dict | None = None,
    period: str | None = None,
) -> FactContract:
    return FactContract(
        fact_key="ledger.aggregate_fact.v2:ffffffffffffffffffffffff",
        source=source,
        jurisdiction="US",
        period=TypedPeriod.parse(
            period
            or (
                "calendar_year:2024"
                if entity
                in {"person", "household", "government", "institutional_sector"}
                else "tax_year:2024"
            )
        ),
        geography_level="country",
        geography_id="0100000US",
        entity=entity,
        measure=measure,
        unit=unit,
        value=Decimal("1"),
        dimensions=dimensions or {},
        universe_constraints=({"domain": domain}, *constraints),
        provenance_class="administrative",
    )


def _planner():
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    return CapabilityPlanner(registry), overview.source


@pytest.mark.parametrize(
    ("fact", "mapping_id"),
    [
        (
            _fact(
                "census_pep",
                "census_pep.resident_population",
                "count",
                "person",
                "resident_population",
                constraints=({"variable": "age", "operator": ">=", "value": 65},),
            ),
            "census-pep-resident-population-validation",
        ),
        (
            _fact(
                "census_population_projections",
                "census.population_projection",
                "count",
                "person",
                "population_projection",
                constraints=({"variable": "age", "operator": "<", "value": 18},),
            ),
            "census-population-projection",
        ),
        (
            _fact(
                "census_acs",
                "census_acs.household_count",
                "count",
                "household",
                "households",
                constraints=(
                    {
                        "variable": "snap_receipt_status",
                        "operator": "==",
                        "value": "receiving_food_stamps_snap",
                    },
                ),
            ),
            "census-acs-household-count-holdout",
        ),
        (
            _fact(
                "irs_soi",
                "irs_soi.returns_with_earned_income_credit",
                "count",
                "tax_unit",
                "all_individual_income_tax_returns",
            ),
            "irs-soi-eitc-return-count",
        ),
        (
            _fact(
                "irs_soi",
                "irs_soi.ordinary_dividends",
                "usd",
                "tax_unit",
                "all_individual_income_tax_returns",
            ),
            "irs-soi-ordinary-dividends-amount",
        ),
        (
            _fact(
                "ssa",
                "ssa.ssi_recipient_count",
                "count",
                "person",
                "social_security_and_ssi_payments",
                constraints=(
                    {"variable": "ssi_category", "operator": "==", "value": "aged"},
                ),
            ),
            "ssa-ssi-recipient-count",
        ),
        (
            replace(
                _fact(
                    "cbo",
                    "cbo.net_business_income_projection",
                    "usd",
                    "tax_unit",
                    "individual_income_tax_returns",
                ),
                period=TypedPeriod.parse("tax_year:2024"),
            ),
            "cbo-net-business-income",
        ),
        (
            _fact(
                "cms_nhe",
                "cms_nhe.medicaid_title_xix_expenditures",
                "usd",
                "person",
                "national_health_expenditures",
            ),
            "cms-nhe-medicaid-title-xix-expenditures",
        ),
        (
            replace(
                _fact(
                    "cms_nhe",
                    "cms_nhe.employer_contribution_private_health_insurance_premiums",
                    "usd",
                    "person",
                    "national_health_expenditures",
                ),
                fact_key="ledger.aggregate_fact.v2:f4c1ba528660b3f48ca03b90",
            ),
            "cms-nhe-employer-health-insurance-premiums",
        ),
        (
            _fact(
                "cms_medicare",
                "cms_medicare.part_b_premium_income",
                "usd",
                "government",
                "medicare_financing",
                constraints=(
                    {"variable": "amount_basis", "operator": "==", "value": "actual"},
                    {"variable": "medicare.part", "operator": "==", "value": "part_b"},
                    {
                        "variable": "medicare.financing_component",
                        "operator": "==",
                        "value": "premiums_from_enrollees",
                    },
                ),
                dimensions={
                    "amount_basis": "actual",
                    "medicare.part": "part_b",
                    "medicare.financing_component": "premiums_from_enrollees",
                },
            ),
            "cms-medicare-part-b-premium-income",
        ),
        (
            _fact(
                "cms_aca",
                "cms_aca.aptc_consumers",
                "count",
                "person",
                "aca_marketplace_qhp_selections",
            ),
            "cms-aca-aptc-consumers",
        ),
        (
            _fact(
                "cms_aca",
                "cms_aca.marketplace_plan_selections",
                "count",
                "person",
                "aca_marketplace_qhp_selections",
            ),
            "cms-aca-marketplace-plan-selections",
        ),
        (
            _fact(
                "cms_aca",
                "cms_aca.average_monthly_aptc",
                "usd",
                "person",
                "aca_marketplace_qhp_selections",
            ),
            "cms-aca-average-monthly-aptc",
        ),
        (
            _fact(
                "kff",
                "cms_aca.marketplace_effectuated_enrollment",
                "count",
                "person",
                "aca_marketplace_effectuated_enrollment",
            ),
            "kff-marketplace-effectuated-enrollment",
        ),
        (
            _fact(
                "federal_reserve",
                "federal_reserve.z1.households_nonprofits_net_worth",
                "usd",
                "institutional_sector",
                "household_balance_sheet",
            ),
            "federal-reserve-household-net-worth",
        ),
        (
            _fact(
                "usda_snap",
                "usda_snap.total_benefits",
                "usd",
                "government",
                "supplemental_nutrition_assistance_program",
                period="fiscal_year:2024",
            ),
            "usda-snap-total-benefits",
        ),
        (
            _fact(
                "usda_snap",
                "usda_snap.average_monthly_households",
                "count",
                "household",
                "supplemental_nutrition_assistance_program",
                period="fiscal_year:2024",
            ),
            "usda-snap-average-monthly-households",
        ),
        (
            _fact(
                "hhs_acf_liheap",
                "hhs_acf_liheap.households_served_by_state_programs",
                "count",
                "household",
                "liheap_state_programs",
                constraints=(
                    {"variable": "program", "operator": "==", "value": "liheap"},
                    {
                        "variable": "administering_entity",
                        "operator": "==",
                        "value": "state_programs",
                    },
                ),
                dimensions={
                    "program": "liheap",
                    "administering_entity": "state_programs",
                },
                period="fiscal_year:2024",
            ),
            "liheap-households-served",
        ),
        (
            _fact(
                "hhs_acf_tanf",
                "hhs_acf_tanf.cash_assistance_expenditures",
                "usd",
                "family",
                "tanf_cash_assistance",
                period="fiscal_year:2024",
            ),
            "tanf-cash-assistance-expenditures",
        ),
        (
            _fact(
                "census_stc",
                "census_stc.individual_income_tax_collections",
                "usd",
                "government",
                "state_government_tax_collections",
                period="fiscal_year:2024",
            ),
            "census-stc-individual-income-tax-collections",
        ),
        (
            _fact(
                "ssa",
                "ssa.ssi_federal_payment_recipient_count",
                "count",
                "person",
                "social_security_and_ssi_payments",
                constraints=(
                    {"variable": "age", "operator": ">=", "value": 18},
                    {"variable": "age", "operator": "<", "value": 65},
                ),
                period="month:2024-12",
            ),
            "ssa-ssi-federal-payment-recipients-by-age",
        ),
        (
            replace(
                _fact(
                    "irs_soi",
                    "irs_soi.form_w2_social_security_tip_income",
                    "usd",
                    "tax_unit",
                    "form_w2_items",
                ),
                period=TypedPeriod.parse("tax_year:2024"),
            ),
            "irs-soi-form-w2-social-security-tip-income",
        ),
        *[
            (
                _fact(
                    "cms_medicaid",
                    measure,
                    "count",
                    "person",
                    "medicaid_chip_enrollment",
                    period="month:2024-12",
                ),
                mapping_id,
            )
            for measure, mapping_id in (
                (
                    "cms_medicaid.total_medicaid_enrollment",
                    "cms-medicaid-total-medicaid-enrollment",
                ),
                (
                    "cms_medicaid.total_chip_enrollment",
                    "cms-medicaid-total-chip-enrollment",
                ),
                (
                    "cms_medicaid.total_medicaid_chip_enrollment",
                    "cms-medicaid-total-medicaid-chip-enrollment",
                ),
            )
        ],
        *[
            (
                _fact(
                    "bea",
                    measure,
                    "usd",
                    "person",
                    domain,
                    constraints=(
                        {
                            "variable": "bea_nipa.series_code",
                            "operator": "==",
                            "value": series,
                        },
                    ),
                    dimensions={"bea_nipa.series_code": series},
                ),
                mapping_id,
            )
            for measure, series, mapping_id, domain in (
                (
                    "bea_nipa.medicaid_benefits",
                    "W729RC",
                    "bea-nipa-medicaid-benefits",
                    "personal_current_transfer_receipts",
                ),
                (
                    "bea_nipa.social_security_benefits",
                    "W823RC",
                    "bea-nipa-social-security-benefits",
                    "personal_current_transfer_receipts",
                ),
                (
                    "bea_nipa.unemployment_insurance_benefits",
                    "W825RC",
                    "bea-nipa-unemployment-insurance-benefits",
                    "personal_current_transfer_receipts",
                ),
                (
                    "bea_nipa.veterans_benefits",
                    "W826RC",
                    "bea-nipa-veterans-benefits",
                    "personal_current_transfer_receipts",
                ),
                (
                    "bea_nipa.proprietors_income_with_inventory_valuation_and_capital_consumption_adjustments",
                    "A041RC",
                    "bea-nipa-proprietors-income",
                    "personal_income",
                ),
            )
        ],
        (
            _fact(
                "bea",
                "bea_regional.proprietors_income",
                "usd",
                "person",
                "personal_income",
                constraints=(
                    {"variable": "bea_regional.geo_name", "operator": "==", "value": "United States"},
                    {"variable": "bea_regional.line_code", "operator": "==", "value": 70},
                    {"variable": "bea_regional.table_name", "operator": "==", "value": "SAINC5N"},
                ),
                dimensions={
                    "bea_regional.geo_name": "United States",
                    "bea_regional.line_code": 70,
                    "bea_regional.table_name": "SAINC5N",
                },
            ),
            "bea-regional-proprietors-income",
        ),
    ],
)
def test_high_confidence_gap_families_are_executable(fact, mapping_id) -> None:
    planner, source = _planner()
    result = planner.classify(fact, source)
    assert result.status in {
        CapabilityStatus.DIRECT,
        CapabilityStatus.MODEL,
        CapabilityStatus.CALIBRATION_TARGET,
    }
    assert result.mapping_id == mapping_id
    assert result.query is not None


def test_2024_irs_mapping_expansion_covers_reviewed_measure_families() -> None:
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    mapped_measures = {
        measure
        for mapping in registry.mappings
        if "irs_soi" in mapping.selector.sources
        for measure in mapping.selector.measures
    }
    expected = {
        "irs_soi.additional_child_tax_credit",
        "irs_soi.business_or_profession_net_income",
        "irs_soi.charitable_contributions_deduction",
        "irs_soi.earned_income_credit",
        "irs_soi.income_tax_before_credits",
        "irs_soi.income_tax_liability_after_credits",
        "irs_soi.individual_income_tax_returns",
        "irs_soi.interest_paid_deduction",
        "irs_soi.limited_state_local_taxes",
        "irs_soi.medical_dental_expense_deduction",
        "irs_soi.net_capital_gains",
        "irs_soi.ordinary_dividends",
        "irs_soi.partnership_s_corporation_net_income",
        "irs_soi.premium_tax_credit",
        "irs_soi.qualified_business_income_deduction",
        "irs_soi.qualified_dividends",
        "irs_soi.returns_with_additional_child_tax_credit",
        "irs_soi.returns_with_business_or_profession_net_income",
        "irs_soi.returns_with_charitable_contributions_deduction",
        "irs_soi.returns_with_earned_income_credit",
        "irs_soi.returns_with_income_tax_before_credits",
        "irs_soi.returns_with_income_tax_liability_after_credits",
        "irs_soi.returns_with_interest_paid_deduction",
        "irs_soi.returns_with_limited_state_local_taxes",
        "irs_soi.returns_with_medical_dental_expense_deduction",
        "irs_soi.returns_with_net_capital_gains",
        "irs_soi.returns_with_ordinary_dividends",
        "irs_soi.returns_with_partnership_s_corporation_net_income",
        "irs_soi.returns_with_premium_tax_credit",
        "irs_soi.returns_with_qualified_business_income_deduction",
        "irs_soi.returns_with_qualified_dividends",
        "irs_soi.returns_with_tax_exempt_interest",
        "irs_soi.returns_with_taxable_interest",
        "irs_soi.returns_with_taxable_ira_distributions",
        "irs_soi.returns_with_taxable_pensions_and_annuities",
        "irs_soi.returns_with_taxable_social_security_benefits",
        "irs_soi.returns_with_unemployment_compensation",
        "irs_soi.tax_exempt_interest",
        "irs_soi.tax_filer_individuals",
        "irs_soi.taxable_interest",
        "irs_soi.taxable_ira_distributions",
        "irs_soi.taxable_pensions_and_annuities",
        "irs_soi.taxable_social_security_benefits",
        "irs_soi.total_itemized_deductions",
        "irs_soi.unemployment_compensation",
        "us:statutes/26/62#adjusted_gross_income",
    }
    assert expected <= mapped_measures


def _classify_aligned_2022(fact: FactContract):
    planner, source = _planner()
    alignment = AlignmentDeclaration(
        alignment_id=f"test-aging:{fact.fact_key}",
        source_id=source.source_id,
        measure=fact.measure,
        source_period=fact.period,
        target_period=TypedPeriod.parse("tax_year:2024"),
        quality=AlignmentQuality.VALIDATED,
        fact_key=fact.fact_key,
        score_eligible=True,
    )
    planner = CapabilityPlanner(planner.mappings, alignments=[alignment])
    return planner.classify(fact, source)


@pytest.mark.parametrize(
    ("measure", "mapping_id"),
    [
        ("irs_soi.returns_with_schedule_c_income", "irs-soi-2022-schedule-c-returns"),
        ("irs_soi.returns_with_total_income_tax", "irs-soi-2022-income-tax-returns"),
        ("irs_soi.returns_with_total_wages", "irs-soi-2022-wage-returns"),
        ("irs_soi.returns_with_itemized_deductions", "irs-soi-2022-itemized-returns"),
        ("irs_soi.returns_with_child_tax_credit", "irs-soi-2022-ctc-returns"),
        (
            "irs_soi.returns_with_taxable_net_capital_gains",
            "irs-soi-2022-capital-gain-returns",
        ),
        ("irs_soi.returns_with_taxable_income", "irs-soi-2022-taxable-income-returns"),
        (
            "irs_soi.returns_with_taxable_pension_income",
            "irs-soi-2022-taxable-pension-returns",
        ),
        (
            "irs_soi.returns_with_real_estate_taxes",
            "irs-soi-2022-real-estate-tax-returns",
        ),
        ("irs_soi.returns_with_total_income", "irs-soi-2022-total-income-returns"),
        (
            "irs_soi.returns_with_partnership_scorp_income",
            "irs-soi-2022-partnership-s-corp-returns",
        ),
    ],
)
def test_reviewed_2022_return_concepts_map_after_populace_aging(
    measure, mapping_id
) -> None:
    fact = replace(
        _fact(
            "irs_soi",
            measure,
            "count",
            "tax_unit",
            "all_individual_income_tax_returns",
            constraints=(
                {
                    "variable": "us:statutes/26/62#adjusted_gross_income",
                    "operator": ">=",
                    "value": 10_000,
                },
            ),
            dimensions={"filing_status": "all", "income_range": "10k_plus"},
        ),
        period=TypedPeriod.parse("tax_year:2022"),
    )
    result = _classify_aligned_2022(fact)
    assert result.status is CapabilityStatus.PROJECTED
    assert result.mapping_id == mapping_id
    assert result.score_eligible


@pytest.mark.parametrize(
    "measure",
    [
        "irs_soi.individual_income_tax_returns",
        "irs_soi.returns_with_additional_child_tax_credit",
        "irs_soi.returns_with_income_tax_before_credits",
        "irs_soi.returns_with_limited_state_local_taxes",
        "irs_soi.returns_with_medical_dental_expense_deduction",
        "irs_soi.returns_with_ordinary_dividends",
        "irs_soi.returns_with_premium_tax_credit",
        "irs_soi.returns_with_qualified_business_income_deduction",
        "irs_soi.returns_with_qualified_dividends",
        "irs_soi.returns_with_tax_exempt_interest",
        "irs_soi.returns_with_taxable_interest",
        "irs_soi.returns_with_taxable_ira_distributions",
        "irs_soi.returns_with_taxable_social_security_benefits",
        "irs_soi.returns_with_unemployment_compensation",
        "irs_soi.tax_filer_individuals",
    ],
)
def test_existing_irs_return_mappings_accept_chronicle_agi_slices(measure) -> None:
    fact = replace(
        _fact(
            "irs_soi",
            measure,
            "count",
            "tax_unit",
            "all_individual_income_tax_returns",
            constraints=(
                {
                    "variable": "us:statutes/26/62#adjusted_gross_income",
                    "operator": "<",
                    "value": 10_000,
                },
            ),
            dimensions={"filing_status": "all", "income_range": "under_10k"},
        ),
        period=TypedPeriod.parse("tax_year:2022"),
    )
    assert _classify_aligned_2022(fact).status is CapabilityStatus.PROJECTED


def test_2022_eitc_returns_accept_the_generic_filer_universe() -> None:
    fact = replace(
        _fact(
            "irs_soi",
            "irs_soi.returns_with_earned_income_credit",
            "count",
            "tax_unit",
            "individual_income_tax_returns",
            constraints=(
                {
                    "variable": "us.tax.earned_income_credit_qualifying_children",
                    "operator": "==",
                    "value": 2,
                },
            ),
            dimensions={"eitc_child_count": 2, "filing_status": "all"},
        ),
        period=TypedPeriod.parse("tax_year:2022"),
    )
    assert _classify_aligned_2022(fact).status is CapabilityStatus.PROJECTED

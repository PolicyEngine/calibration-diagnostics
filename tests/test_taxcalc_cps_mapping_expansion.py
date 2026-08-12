from dataclasses import replace
from pathlib import Path

import pytest

from evaluation_harness.mappings import MappingRegistry
from evaluation_harness.integration import load_integration_overview


INTEGRATION = Path("integrations/taxcalc_cps")


@pytest.mark.parametrize(
    ("source", "measure", "unit", "expression", "operation"),
    [
        ("cbo", "cbo.adjusted_gross_income_projection", "usd", "c00100", "weighted_sum"),
        ("cbo", "cbo.qualified_dividend_income_projection", "usd", "e00650", "weighted_sum"),
        (
            "cbo",
            "cbo.taxable_interest_and_ordinary_dividends_excluding_qualified_dividends_projection",
            "usd",
            "taxable_interest_and_nonqualified_dividends",
            "weighted_sum",
        ),
        ("irs_soi", "irs_soi.additional_child_tax_credit", "usd", "c11070", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_additional_child_tax_credit", "count", "c11070", "weighted_count"),
        ("irs_soi", "irs_soi.child_tax_credit", "usd", "c07220", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_child_tax_credit", "count", "c07220", "weighted_count"),
        ("irs_soi", "irs_soi.schedule_c_income", "usd", "positive_schedule_c_income", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_schedule_c_income", "count", "positive_schedule_c_income", "weighted_count"),
        ("irs_soi", "irs_soi.charitable_contributions_deduction", "usd", "c19700", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_charitable_contributions_deduction", "count", "c19700", "weighted_count"),
        ("irs_soi", "irs_soi.income_tax_before_credits", "usd", "c05800", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_income_tax_before_credits", "count", "c05800", "weighted_count"),
        ("irs_soi", "irs_soi.interest_paid_deduction", "usd", "c19200", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_interest_paid_deduction", "count", "c19200", "weighted_count"),
        ("irs_soi", "irs_soi.limited_state_local_taxes", "usd", "c18300", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_limited_state_local_taxes", "count", "c18300", "weighted_count"),
        ("irs_soi", "irs_soi.medical_dental_expense_deduction", "usd", "c17000", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_medical_dental_expense_deduction", "count", "c17000", "weighted_count"),
        ("irs_soi", "irs_soi.returns_with_ordinary_dividends", "count", "e00600", "weighted_count"),
        ("irs_soi", "irs_soi.qualified_business_income_deduction", "usd", "qbided", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_qualified_business_income_deduction", "count", "qbided", "weighted_count"),
        ("irs_soi", "irs_soi.qualified_dividends", "usd", "e00650", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_qualified_dividends", "count", "e00650", "weighted_count"),
        ("irs_soi", "irs_soi.tax_exempt_interest", "usd", "e00400", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_tax_exempt_interest", "count", "e00400", "weighted_count"),
        ("irs_soi", "irs_soi.returns_with_taxable_interest", "count", "e00300", "weighted_count"),
        ("irs_soi", "irs_soi.taxable_ira_distributions", "usd", "e01400", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_taxable_ira_distributions", "count", "e01400", "weighted_count"),
        ("irs_soi", "irs_soi.returns_with_taxable_pension_income", "count", "e01700", "weighted_count"),
        ("irs_soi", "irs_soi.returns_with_taxable_social_security_benefits", "count", "c02500", "weighted_count"),
        ("irs_soi", "irs_soi.total_itemized_deductions", "usd", "c04470", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_itemized_deductions", "count", "c04470", "weighted_count"),
        ("irs_soi", "irs_soi.returns_with_unemployment_compensation", "count", "e02300", "weighted_count"),
        ("irs_soi", "irs_soi.taxable_income", "usd", "c04800", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_taxable_income", "count", "c04800", "weighted_count"),
        ("irs_soi", "irs_soi.total_income", "usd", "total_income", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_total_income", "count", "total_income", "weighted_count"),
        ("irs_soi", "irs_soi.total_income_tax", "usd", "income_tax_after_nonrefundable_credits", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_total_income_tax", "count", "income_tax_after_nonrefundable_credits", "weighted_count"),
        ("irs_soi", "irs_soi.real_estate_taxes", "usd", "itemized_real_estate_taxes", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_real_estate_taxes", "count", "itemized_real_estate_taxes", "weighted_count"),
        ("irs_soi", "us:statutes/26/62#input.wages", "usd", "e00200", "weighted_sum"),
        ("irs_soi", "irs_soi.returns_with_total_wages", "count", "e00200", "weighted_count"),
    ],
)
def test_reviewed_direct_tax_concepts_have_executable_mappings(
    source: str,
    measure: str,
    unit: str,
    expression: str,
    operation: str,
) -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    template = overview.verification_facts[0]
    candidate = replace(
        template,
        fact_key=f"test:{source}:{measure}:{unit}",
        source=source,
        measure=measure,
        unit=unit,
        dimensions={},
        universe_constraints=(),
    )

    mapping = registry.match(candidate)
    assert mapping is not None
    assert mapping.source_expression == expression
    assert mapping.operation == operation


def test_eitc_mappings_cover_both_chronicle_names_and_child_breakdowns() -> None:
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    by_id = {mapping.mapping_id: mapping for mapping in registry.mappings}

    amount = by_id["taxcalc-cps-eitc-by-children"]
    assert amount.selector.measures >= {
        "irs_soi.earned_income_credit",
        "irs_soi.total_earned_income_credit",
    }
    count = by_id["taxcalc-cps-eitc-return-count-by-children"]
    assert count.selector.measures >= {
        "irs_soi.returns_with_earned_income_credit",
        "irs_soi.returns_with_total_earned_income_credit",
    }
    for mapping in (amount, count):
        assert "eitc_child_count" in mapping.supported_dimensions
        assert "individual_income_tax_returns" in mapping.supported_constraint_domains
        assert "individual_income_tax_returns_with_earned_income_credit" in (
            mapping.supported_constraint_domains
        )


@pytest.mark.parametrize(
    ("fact_key", "measure", "expression", "dimensions"),
    [
        (
            "chronicle.aggregate_fact.v2:035d27c7ddaecd3099232f2d",
            "ssa.annual_oasdi_or_ssi_payment_amount",
            "e02400",
            {"us_social_security_and_ssi.program_payment_type": "social_security_benefits"},
        ),
        (
            "chronicle.aggregate_fact.v2:87b624b0ca9e9bcdfaa480c1",
            "ssa.ssi_payment_amount",
            "ssi_ben",
            {},
        ),
    ],
)
def test_public_cps_benefit_totals_bridge_person_facts_to_tax_units(
    fact_key: str,
    measure: str,
    expression: str,
    dimensions: dict,
) -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    candidate = replace(
        overview.verification_facts[0],
        fact_key=fact_key,
        source="ssa",
        entity="person",
        measure=measure,
        unit="usd",
        dimensions=dimensions,
        universe_constraints=({"domain": "social_security_and_ssi_payments"},),
    )

    mapping = registry.match(candidate)
    assert mapping is not None
    assert mapping.execution_entity == "tax_unit"
    assert mapping.source_expression == expression


@pytest.mark.parametrize(
    ("source", "measure", "unit", "expression", "operation", "entity"),
    [
        ("irs_soi", "irs_soi.net_capital_gains", "usd", "e01100", "weighted_sum", "tax_unit"),
        ("irs_soi", "irs_soi.taxable_net_capital_gains", "usd", "e01100", "weighted_sum", "tax_unit"),
        ("irs_soi", "irs_soi.returns_with_net_capital_gains", "count", "e01100", "weighted_count", "tax_unit"),
        ("irs_soi", "irs_soi.returns_with_taxable_net_capital_gains", "count", "e01100", "weighted_count", "tax_unit"),
        ("cbo", "cbo.net_capital_gain_projection", "usd", "e01100", "weighted_sum", "tax_unit"),
        ("census_pep", "census_pep.resident_population", "count", "XTOT", "weighted_sum", "person"),
        ("bea", "bea_regional.wages_and_salaries", "usd", "e00200", "weighted_sum", "person"),
        ("bea", "bea_nipa.wages_and_salaries", "usd", "e00200", "weighted_sum", "person"),
        ("bea", "bea_nipa.social_security_benefits", "usd", "e02400", "weighted_sum", "person"),
        ("bea", "bea_nipa.unemployment_insurance_benefits", "usd", "e02300", "weighted_sum", "person"),
        ("bea", "bea_nipa.veterans_benefits", "usd", "vet_ben", "weighted_sum", "person"),
        ("bea", "bea_nipa.medicare_benefits", "usd", "mcare_ben", "weighted_sum", "person"),
        ("bea", "bea_nipa.medicaid_benefits", "usd", "mcaid_ben", "weighted_sum", "person"),
        ("bea", "bea_nipa.government_social_benefits_to_persons", "usd", "benefit_cost_total", "weighted_sum", "person"),
        ("cms_nhe", "cms_nhe.medicaid_title_xix_expenditures", "usd", "mcaid_ben", "weighted_sum", "person"),
    ],
)
def test_reviewed_additive_chronicle_concepts_have_exact_executable_mappings(
    source: str,
    measure: str,
    unit: str,
    expression: str,
    operation: str,
    entity: str,
) -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    candidate = replace(
        overview.verification_facts[0],
        fact_key=f"test:{source}:{measure}:{unit}",
        source=source,
        entity=entity,
        measure=measure,
        unit=unit,
        dimensions={},
        universe_constraints=(),
    )

    mapping = registry.match(candidate)
    assert mapping is not None
    assert mapping.source_expression == expression
    assert mapping.operation == operation
    if entity == "person":
        assert mapping.execution_entity == "tax_unit"


@pytest.mark.parametrize(
    "tax_expenditure",
    [
        "charitable_deduction",
        "deductible_mortgage_interest",
        "medical_expense_deduction",
        "qualified_business_income_deduction",
        "salt_deduction",
        "self_employed_health_insurance_deduction",
        "self_employed_pension_contribution_deduction",
        "student_loan_interest_deduction",
        "traditional_ira_deduction",
    ],
)
def test_reviewed_jct_facts_map_to_distinct_repeal_counterfactuals(
    tax_expenditure: str,
) -> None:
    overview = load_integration_overview(INTEGRATION / "overview.yaml")
    registry = MappingRegistry.from_yaml(INTEGRATION / "mappings.yaml")
    candidate = replace(
        overview.verification_facts[0],
        fact_key=f"test:jct:{tax_expenditure}",
        source="jct",
        entity="tax_unit",
        measure="jct.individual_tax_expenditure_revenue_loss",
        unit="usd",
        dimensions={"tax_expenditure": tax_expenditure},
        universe_constraints=(
            {"domain": "federal_income_tax"},
            {
                "variable": "tax_expenditure",
                "operator": "==",
                "value": tax_expenditure,
            },
        ),
    )

    mapping = registry.match(candidate)
    assert mapping is not None
    assert mapping.source_expression == f"jct_repeal:{tax_expenditure}"
    assert mapping.execution.value == "model"
    assert mapping.mapping_quality.value == "exact"

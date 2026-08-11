from __future__ import annotations

from typing import Any, Callable

import numpy as np

from ..execution import ArrayBundle, RunGroup


DATASET_VERSION = "taxcalc-cps-2014@6.7.1"
MODEL_VERSION = "taxcalc==6.7.1"

VARIABLE_ALIASES = {
    "us:statutes/26/62#adjusted_gross_income": "c00100",
    "us.tax.earned_income_credit_qualifying_children": "EIC",
}

FILING_STATUS = {
    1: "single",
    2: "joint",
    3: "separate",
    4: "head_of_household",
    5: "surviving_spouse",
}

JCT_REPEAL_REFORMS: dict[str, tuple[str, float]] = {
    "charitable_deduction": ("ID_Charity_hc", 1.0),
    "deductible_mortgage_interest": ("ID_InterestPaid_hc", 1.0),
    "medical_expense_deduction": ("ID_Medical_hc", 1.0),
    "qualified_business_income_deduction": ("PT_qbid_rt", 0.0),
    "salt_deduction": ("ID_AllTaxes_hc", 1.0),
    "self_employed_health_insurance_deduction": (
        "ALD_SelfEmp_HealthIns_hc",
        1.0,
    ),
    "self_employed_pension_contribution_deduction": (
        "ALD_KEOGH_SEP_hc",
        1.0,
    ),
    "student_loan_interest_deduction": ("ALD_StudentLoan_hc", 1.0),
    "traditional_ira_deduction": ("ALD_IRAContributions_hc", 1.0),
}


def _default_calculator_factory(year: int) -> Any:
    try:
        import taxcalc as tc
    except ImportError as error:  # pragma: no cover - optional install path
        raise RuntimeError("install the 'taxcalc-cps' extra to run public CPS") from error
    records = tc.Records.cps_constructor()
    calculator = tc.Calculator(policy=tc.Policy(), records=records)
    calculator.advance_to_year(year)
    calculator.calc_all()
    return calculator


def _default_counterfactual_calculator_factory(
    year: int,
    reform_key: str,
) -> Any:
    try:
        import taxcalc as tc
    except ImportError as error:  # pragma: no cover - optional install path
        raise RuntimeError("install the 'taxcalc-cps' extra to run public CPS") from error
    try:
        parameter, value = JCT_REPEAL_REFORMS[reform_key]
    except KeyError as error:
        raise ValueError(f"unknown reviewed JCT repeal {reform_key!r}") from error
    policy = tc.Policy()
    policy.implement_reform({parameter: {year: value}})
    records = tc.Records.cps_constructor()
    calculator = tc.Calculator(policy=policy, records=records)
    calculator.advance_to_year(year)
    calculator.calc_all()
    return calculator


class TaxCalcCPSRunner:
    """Expose one advanced public-CPS Tax-Calculator run to the shared harness."""

    def __init__(
        self,
        *,
        calculator_factory: Callable[[int], Any] = _default_calculator_factory,
        counterfactual_calculator_factory: Callable[[int, str], Any] = (
            _default_counterfactual_calculator_factory
        ),
    ) -> None:
        self._calculator_factory = calculator_factory
        self._counterfactual_calculator_factory = counterfactual_calculator_factory
        self._calculator: Any | None = None
        self._year: int | None = None
        self._array_cache: dict[str, np.ndarray] = {}
        self._counterfactual_calculators: dict[str, Any] = {}

    def _calculator_for(self, year: int) -> Any:
        if self._calculator is None or self._year != year:
            self._calculator = self._calculator_factory(year)
            self._year = year
            self._array_cache = {}
            self._counterfactual_calculators = {}
        return self._calculator

    def _counterfactual_calculator_for(self, year: int, reform_key: str) -> Any:
        self._calculator_for(year)
        if reform_key not in self._counterfactual_calculators:
            self._counterfactual_calculators[reform_key] = (
                self._counterfactual_calculator_factory(year, reform_key)
            )
        return self._counterfactual_calculators[reform_key]

    def _array(self, name: str, year: int) -> np.ndarray:
        self._calculator_for(year)
        if name not in self._array_cache:
            self._array_cache[name] = np.asarray(
                self._calculator_for(year).array(name)
            )
        return self._array_cache[name]

    def _expression(self, name: str, year: int) -> np.ndarray:
        if name in self._array_cache:
            return self._array_cache[name]
        if name.startswith("jct_repeal:"):
            reform_key = name.split(":", 1)[1]
            if reform_key not in JCT_REPEAL_REFORMS:
                raise ValueError(f"unknown reviewed JCT repeal {reform_key!r}")
            values = np.asarray(
                self._counterfactual_calculator_for(year, reform_key).array(
                    "iitax"
                )
            ) - self._array("iitax", year)
        elif name == "taxable_interest_and_nonqualified_dividends":
            values = (
                self._array("e00300", year)
                + self._array("e00600", year)
                - self._array("e00650", year)
            )
        elif name == "total_income":
            values = self._array("c00100", year) + self._array("c02900", year)
        elif name == "income_tax_after_nonrefundable_credits":
            values = np.maximum(
                self._array("c05800", year) - self._array("c07100", year),
                0,
            )
        elif name == "itemized_real_estate_taxes":
            values = np.where(
                self._array("c04470", year) != 0,
                self._array("e18500", year),
                0,
            )
        elif name == "positive_schedule_c_income":
            values = np.maximum(self._array("e00900", year), 0)
        else:
            return self._array(VARIABLE_ALIASES.get(name, name), year)
        self._array_cache[name] = np.asarray(values)
        return self._array_cache[name]

    def prepare(self, group: RunGroup) -> ArrayBundle:
        if group.source_id != "taxcalc_public_cps_2024":
            raise ValueError(f"Tax-Calculator CPS runner cannot execute {group.source_id!r}")
        if group.entity != "tax_unit":
            raise ValueError(
                f"Public CPS + Tax-Calculator exposes tax_unit entity, not {group.entity!r}"
            )
        if group.geography_method not in {"fixed_country", "state_fips"}:
            raise ValueError(
                "Public CPS + Tax-Calculator supports country and state geography, "
                f"not {group.geography_method!r}"
            )
        year = int((group.policy_period or group.population_period).split(":", 1)[-1])
        weights = self._array("s006", year)
        length = len(weights)
        if group.geography_method == "fixed_country":
            geography = np.full(length, "0100000US", dtype=object)
        else:
            geography = np.asarray(
                [f"0400000US{int(value):02d}" for value in self._array("fips", year)],
                dtype=object,
            )
        arrays: dict[str, np.ndarray] = {
            "__geography__": geography,
            "s006": weights,
        }
        for name in group.required_variables:
            if name not in arrays and name not in {"filing_status", "eitc_child_count"}:
                if name == "positive_iitax":
                    arrays[name] = self._array("iitax", year) > 0
                else:
                    arrays[name] = self._expression(name, year)

        mars = self._array("MARS", year)
        try:
            arrays["filing_status"] = np.asarray(
                [FILING_STATUS[int(value)] for value in mars], dtype=object
            )
        except KeyError as error:
            raise ValueError(f"unknown Tax-Calculator MARS value {error.args[0]}") from error
        eic = self._array("EIC", year)
        arrays["eitc_child_count"] = np.asarray(
            ["3plus" if int(value) >= 3 else int(value) for value in eic],
            dtype=object,
        )
        for name, values in arrays.items():
            if len(values) != length:
                raise ValueError(
                    f"Tax-Calculator array length mismatch for {name!r}: "
                    f"{len(values)} != {length}"
                )
        domains = {
            "all_individual_income_tax_returns": np.ones(length, dtype=bool),
            "compensation_of_employees": np.ones(length, dtype=bool),
            "federal_income_tax": np.ones(length, dtype=bool),
            "individual_income_tax_returns": np.ones(length, dtype=bool),
            "national_health_expenditures": np.ones(length, dtype=bool),
            "personal_current_transfer_receipts": np.ones(length, dtype=bool),
            "personal_income": np.ones(length, dtype=bool),
            "resident_population": np.ones(length, dtype=bool),
            "social_security_and_ssi_payments": np.ones(length, dtype=bool),
        }
        if "c59660" in arrays:
            domains["individual_income_tax_returns_with_earned_income_credit"] = (
                np.asarray(arrays["c59660"]) != 0
            )
        return ArrayBundle(
            arrays=arrays,
            dataset_version=DATASET_VERSION,
            model_version=MODEL_VERSION,
            domain_masks=domains,
        )

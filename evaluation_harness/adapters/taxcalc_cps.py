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


class TaxCalcCPSRunner:
    """Expose one advanced public-CPS Tax-Calculator run to the shared harness."""

    def __init__(
        self,
        *,
        calculator_factory: Callable[[int], Any] = _default_calculator_factory,
    ) -> None:
        self._calculator_factory = calculator_factory
        self._calculator: Any | None = None
        self._year: int | None = None
        self._array_cache: dict[str, np.ndarray] = {}

    def _calculator_for(self, year: int) -> Any:
        if self._calculator is None:
            self._calculator = self._calculator_factory(year)
            self._year = year
        elif self._year != year:
            raise ValueError(
                f"Tax-Calculator runner is pinned to {self._year}, not requested {year}"
            )
        return self._calculator

    def _array(self, name: str, year: int) -> np.ndarray:
        if name not in self._array_cache:
            self._array_cache[name] = np.asarray(
                self._calculator_for(year).array(name)
            )
        return self._array_cache[name]

    def prepare(self, group: RunGroup) -> ArrayBundle:
        if group.source_id != "taxcalc_public_cps_2024":
            raise ValueError(f"Tax-Calculator CPS runner cannot execute {group.source_id!r}")
        if group.entity != "tax_unit":
            raise ValueError(
                f"Tax-Calculator public CPS exposes tax_unit entity, not {group.entity!r}"
            )
        if group.geography_method != "fixed_country":
            raise ValueError(
                "Tax-Calculator public CPS supports only country geography, "
                f"not {group.geography_method!r}"
            )
        year = int((group.policy_period or group.population_period).split(":", 1)[-1])
        weights = self._array("s006", year)
        length = len(weights)
        arrays: dict[str, np.ndarray] = {
            "__geography__": np.full(length, "0100000US", dtype=object),
            "s006": weights,
        }
        for name in group.required_variables:
            if name not in arrays and name not in {"filing_status", "eitc_child_count"}:
                if name == "positive_iitax":
                    arrays[name] = self._array("iitax", year) > 0
                else:
                    arrays[name] = self._array(VARIABLE_ALIASES.get(name, name), year)

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
            "individual_income_tax_returns": np.ones(length, dtype=bool),
        }
        return ArrayBundle(
            arrays=arrays,
            dataset_version=DATASET_VERSION,
            model_version=MODEL_VERSION,
            domain_masks=domains,
        )

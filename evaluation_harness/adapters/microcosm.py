from __future__ import annotations

import hashlib
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

import numpy as np

from ..execution import ArrayBundle, RunGroup


# Deprecated upstream identifiers: Microcosm still publishes this release under
# the former Populace Hugging Face repository, release, and filename literals.
MICROCOSM_REPOSITORY = "policyengine/populace-us"


@dataclass(frozen=True)
class MicrocosmRelease:
    release_id: str
    dataset_filename: str
    dataset_sha256: str
    model_version: str
    repository: str = MICROCOSM_REPOSITORY
    calibration_diagnostics_filename: str | None = None
    calibration_diagnostics_sha256: str | None = None

    @property
    def download_url(self) -> str:
        return self.file_download_url(self.dataset_filename)

    def file_download_url(self, filename: str) -> str:
        return (
            f"https://huggingface.co/datasets/{self.repository}/resolve/"
            f"{self.release_id}/{filename}"
        )


MICROCOSM_RELEASE = MicrocosmRelease(
    release_id="populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z",
    dataset_filename="populace_us_2024.h5",
    dataset_sha256="48b9d479fb4fd1c3537f9383ce4697d130b6f618658409d74f6233c43b994c7e",
    model_version="1.764.6",
    calibration_diagnostics_filename=(
        "releases/"
        "populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z/"
        "calibration_diagnostics.json"
    ),
    calibration_diagnostics_sha256=(
        "870449b44e86b13b25bcea1a57f0e7af37f4d4db18be815eea3acdf9fe6eb40e"
    ),
)


Downloader = Callable[[MicrocosmRelease, Path], Any]
Table = Mapping[str, np.ndarray]
Tables = Mapping[str, Table]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_release_file(
    path: str | Path,
    *,
    expected_sha256: str,
    label: str,
) -> Path:
    verified = Path(path)
    if not verified.is_file():
        raise FileNotFoundError(f"{label} does not exist: {verified}")
    actual = _sha256(verified)
    if actual != expected_sha256:
        raise ValueError(
            f"{label} checksum mismatch: expected {expected_sha256}, found {actual}"
        )
    return verified


def verify_release_dataset(
    path: str | Path,
    release: MicrocosmRelease = MICROCOSM_RELEASE,
) -> Path:
    """Authenticate a caller-supplied HDF5 against the pinned release."""

    return _verify_release_file(
        path,
        expected_sha256=release.dataset_sha256,
        label="Microcosm dataset",
    )


def verify_release_calibration_diagnostics(
    path: str | Path,
    release: MicrocosmRelease = MICROCOSM_RELEASE,
) -> Path:
    """Authenticate caller-supplied diagnostics against the pinned release."""

    expected = release.calibration_diagnostics_sha256
    if expected is None:
        raise ValueError("Microcosm release does not pin calibration diagnostics")
    return _verify_release_file(
        path,
        expected_sha256=expected,
        label="Microcosm calibration diagnostics",
    )


def _download(release: MicrocosmRelease, target: Path) -> None:
    urllib.request.urlretrieve(release.download_url, target)


def _download_calibration_diagnostics(
    release: MicrocosmRelease, target: Path
) -> None:
    if release.calibration_diagnostics_filename is None:
        raise ValueError("Microcosm release does not pin calibration diagnostics")
    urllib.request.urlretrieve(
        release.file_download_url(release.calibration_diagnostics_filename), target
    )


def resolve_release_dataset(
    release: MicrocosmRelease,
    directory: str | Path,
    downloader: Downloader = _download,
) -> Path:
    """Resolve a pinned Microcosm artifact and reject any byte-level drift."""

    destination = Path(directory) / release.dataset_filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        downloader(release, destination)
    if not destination.is_file():
        raise ValueError(f"Microcosm downloader did not create {destination}")
    return verify_release_dataset(destination, release)


def resolve_release_calibration_diagnostics(
    release: MicrocosmRelease,
    directory: str | Path,
    downloader: Downloader = _download_calibration_diagnostics,
) -> Path:
    """Resolve the exact compiled target registry shipped with a release."""

    filename = release.calibration_diagnostics_filename
    expected = release.calibration_diagnostics_sha256
    if filename is None or expected is None:
        raise ValueError("Microcosm release does not pin calibration diagnostics")
    destination = Path(directory) / Path(filename).name
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        downloader(release, destination)
    if not destination.is_file():
        raise ValueError(f"Microcosm downloader did not create {destination}")
    return verify_release_calibration_diagnostics(destination, release)


def _default_table_loader(dataset_path: Path) -> Tables:
    try:
        import pandas as pd
    except ImportError as error:  # pragma: no cover - exercised by optional install
        raise RuntimeError("install the 'microcosm' extra to read Microcosm HDF5") from error
    tables: dict[str, dict[str, np.ndarray]] = {}
    with pd.HDFStore(dataset_path, mode="r") as store:
        available = {key.lstrip("/"): key for key in store.keys()}
        for entity in ("person", "household", "tax_unit", "spm_unit"):
            if entity not in available:
                raise ValueError(f"Microcosm dataset has no {entity!r} table")
            frame = store[available[entity]]
            tables[entity] = {column: frame[column].to_numpy() for column in frame.columns}
    return tables


def _default_simulation_factory(dataset_path: Path) -> Any:
    try:
        from policyengine_us import Microsimulation
    except ImportError as error:  # pragma: no cover - exercised by optional install
        raise RuntimeError("install the 'microcosm' extra to run PolicyEngine-US") from error
    return Microsimulation(dataset=str(dataset_path))


VARIABLE_ALIASES = {
    "us:statutes/26/62#adjusted_gross_income": "adjusted_gross_income",
    "us.tax.earned_income_credit_qualifying_children": "eitc_child_count",
}

ENTITY_DOMAINS = {
    "person": (
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
    ),
    "household": ("household_balance_sheet", "households"),
    "spm_unit": (
        "liheap_state_programs",
        "supplemental_nutrition_assistance_program",
        "tanf_cash_assistance",
        "tanf_caseload",
    ),
    "tax_unit": (
        "all_individual_income_tax_returns",
        "individual_income_tax_returns",
        "form_w2_items",
        "individual_retirement_arrangement_contributions",
        "state_government_tax_collections",
    ),
}


class MicrocosmPolicyEngineRunner:
    """Prepare entity-aligned arrays from one pinned Microcosm/PolicyEngine run."""

    def __init__(
        self,
        *,
        dataset_path: str | Path,
        release: MicrocosmRelease = MICROCOSM_RELEASE,
        table_loader: Callable[[Path], Tables] = _default_table_loader,
        simulation_factory: Callable[[Path], Any] = _default_simulation_factory,
        old_congressional_district_assignments: Mapping[str, str] | None = None,
    ) -> None:
        self.dataset_path = Path(dataset_path)
        self.release = release
        self._table_loader = table_loader
        self._simulation_factory = simulation_factory
        self._old_congressional_district_assignments = (
            dict(old_congressional_district_assignments)
            if old_congressional_district_assignments is not None
            else None
        )
        self._tables: Tables | None = None
        self._simulation: Any | None = None
        self._calculation_cache: dict[tuple[str, str], np.ndarray] = {}

    @property
    def tables(self) -> Tables:
        if self._tables is None:
            loaded = self._table_loader(self.dataset_path)
            self._tables = {
                entity: {name: np.asarray(values) for name, values in table.items()}
                for entity, table in loaded.items()
            }
        return self._tables

    @property
    def simulation(self) -> Any:
        if self._simulation is None:
            self._simulation = self._simulation_factory(self.dataset_path)
        return self._simulation

    @staticmethod
    def _column(table: Table, name: str) -> np.ndarray:
        if name not in table:
            raise ValueError(f"Microcosm table is missing required column {name!r}")
        return np.asarray(table[name])

    @staticmethod
    def _lookup(keys: np.ndarray, values: np.ndarray, requested: np.ndarray, label: str) -> np.ndarray:
        if len(keys) != len(values):
            raise ValueError(f"invalid {label} lookup arrays")
        lookup = dict(zip(keys.tolist(), values.tolist(), strict=True))
        missing = sorted(set(requested.tolist()) - set(lookup))
        if missing:
            raise ValueError(f"{label} references unknown IDs: {missing[:3]}")
        return np.asarray([lookup[key] for key in requested.tolist()])

    def _household_geographies(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        household = self.tables["household"]
        count = len(self._column(household, "household_id"))
        country = np.full(count, "0100000US", dtype=object)
        states = np.asarray(
            [f"0400000US{int(value):02d}" for value in self._column(household, "state_fips")],
            dtype=object,
        )
        districts = np.asarray(
            [
                f"5001900US{int(value):04d}"
                for value in self._column(household, "congressional_district_geoid")
            ],
            dtype=object,
        )
        return country, states, districts

    def _entity_geographies(self, entity: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        country, states, districts = self._household_geographies()
        return tuple(
            self._household_values_for_entity(entity, values)
            for values in (country, states, districts)
        )

    def _household_values_for_entity(
        self, entity: str, values: np.ndarray
    ) -> np.ndarray:
        household = self.tables["household"]
        household_ids = self._column(household, "household_id")
        if entity == "household":
            return values
        person = self.tables["person"]
        person_households = self._column(person, "person_household_id")
        if entity == "person":
            return self._lookup(
                household_ids, values, person_households, "person-household join"
            )
        if entity == "spm_unit":
            spm_households = self._spm_unit_households()
            return self._lookup(
                household_ids,
                values,
                spm_households,
                "SPM-unit household join",
            )
        if entity != "tax_unit":
            raise ValueError(f"unsupported Microcosm entity {entity!r}")

        person_tax_units = self._column(person, "person_tax_unit_id")
        tax_unit_households: dict[Any, Any] = {}
        for tax_unit_id, household_id in zip(
            person_tax_units.tolist(), person_households.tolist(), strict=True
        ):
            previous = tax_unit_households.setdefault(tax_unit_id, household_id)
            if previous != household_id:
                raise ValueError(f"tax unit {tax_unit_id} belongs to multiple households")
        tax_unit = self.tables["tax_unit"]
        tax_unit_ids = self._column(tax_unit, "tax_unit_id")
        try:
            assigned_households = np.asarray(
                [tax_unit_households[tax_unit_id] for tax_unit_id in tax_unit_ids.tolist()]
            )
        except KeyError as error:
            raise ValueError(f"tax unit has no person-household link: {error.args[0]}") from error
        return self._lookup(
            household_ids, values, assigned_households, "tax-unit household join"
        )

    def _entity_old_congressional_districts(self, entity: str) -> np.ndarray:
        assignments = self._old_congressional_district_assignments
        if assignments is None:
            raise ValueError(
                "old congressional district assignment artifact was not supplied"
            )
        blocks = self._column(self.tables["household"], "block_geoid").astype(str)
        missing = sorted(set(blocks.tolist()) - set(assignments))
        if missing:
            raise ValueError(
                "old congressional district assignment is missing household blocks: "
                f"{missing[:3]}"
            )
        household_districts = np.asarray(
            [assignments[block] for block in blocks.tolist()], dtype=object
        )
        return self._household_values_for_entity(entity, household_districts)

    def _model_array(self, requested_name: str, entity: str, period: str) -> np.ndarray:
        if requested_name.startswith("soi_positive:"):
            if entity != "tax_unit":
                raise ValueError("SOI positive-part expressions require tax-unit grain")
            expression = requested_name.split(":", 1)[1]
            return np.maximum(
                np.asarray(self._model_array(expression, entity, period), dtype=float),
                0.0,
            )
        if requested_name.startswith("soi_itemized:"):
            if entity != "tax_unit":
                raise ValueError("SOI itemized expressions require tax-unit grain")
            expression = requested_name.split(":", 1)[1]
            values = np.maximum(
                np.asarray(self._model_array(expression, entity, period), dtype=float),
                0.0,
            )
            itemizes = self._native_model_array(
                "tax_unit_itemizes", period, expected_entity="tax_unit"
            ).astype(bool)
            return np.where(itemizes, values, 0.0)
        if requested_name == "soi_capped_ctc":
            if entity != "tax_unit":
                raise ValueError("SOI CTC expressions require tax-unit grain")
            ctc = self._native_model_array(
                "ctc", period, expected_entity="tax_unit"
            )
            limiting_tax = self._native_model_array(
                "ctc_limiting_tax_liability",
                period,
                expected_entity="tax_unit",
            )
            return np.maximum(np.minimum(ctc, limiting_tax), 0.0)
        if requested_name.startswith("tax_unit_sum_person:"):
            expression = requested_name.split(":", 1)[1]
            values = sum(
                (
                    self._native_model_array(name, period, expected_entity="person")
                    for name in expression.split("+")
                ),
                start=np.zeros(len(self.tables["person"]["person_id"])),
            )
            return self._person_values_to_tax_units(values)
        if requested_name.startswith("tax_unit_count_person:"):
            model_name = requested_name.split(":", 1)[1]
            values = self._native_model_array(
                model_name, period, expected_entity="person"
            )
            return self._person_values_to_tax_units((values != 0).astype(np.int64))
        if requested_name == "snap_receipt_status" and entity == "household":
            snap = self._native_model_array("snap", period, expected_entity="spm_unit")
            receives = self._spm_values_to_households(snap > 0)
            return np.where(
                receives,
                "receiving_food_stamps_snap",
                "not_receiving_food_stamps_snap",
            )
        if requested_name == "person_assigned_aca_ptc_per_month" and entity == "person":
            receives = self._native_model_array(
                "person_receives_aca", period, expected_entity="person"
            ).astype(bool)
            assigned = self._native_model_array(
                "assigned_aca_ptc", period, expected_entity="tax_unit"
            )
            recipient_counts = self._person_values_to_tax_units(
                receives.astype(np.int64)
            )
            assigned_by_person = self._tax_unit_values_to_people(assigned)
            counts_by_person = self._tax_unit_values_to_people(recipient_counts)
            denominator = counts_by_person * 12
            return np.divide(
                assigned_by_person,
                denominator,
                out=np.zeros_like(assigned_by_person, dtype=float),
                where=receives & (denominator > 0),
            )
        if requested_name == "medicaid_or_chip_enrolled" and entity == "person":
            return self._native_model_array(
                "medicaid_enrolled", period, expected_entity="person"
            ).astype(bool) | self._native_model_array(
                "chip_enrolled", period, expected_entity="person"
            ).astype(bool)
        if requested_name == "adult_medicaid_enrolled" and entity == "person":
            age = self._native_model_array(
                "age", period, expected_entity="person"
            )
            medicaid = self._native_model_array(
                "medicaid_enrolled", period, expected_entity="person"
            ).astype(bool)
            return medicaid & (age >= 19)
        if (
            requested_name == "child_medicaid_or_chip_enrolled"
            and entity == "person"
        ):
            age = self._native_model_array(
                "age", period, expected_entity="person"
            )
            medicaid_or_chip = self._native_model_array(
                "medicaid_enrolled", period, expected_entity="person"
            ).astype(bool) | self._native_model_array(
                "chip_enrolled", period, expected_entity="person"
            ).astype(bool)
            return medicaid_or_chip & (age < 19)
        if requested_name in {
            "snap_recipient_count",
            "snap_recipient_person_months",
        } and entity == "spm_unit":
            snap = self._native_model_array(
                "snap", period, expected_entity="spm_unit"
            )
            snap_unit_size = self._native_model_array(
                "snap_unit_size", period, expected_entity="spm_unit"
            )
            recipient_count = np.where(snap > 0, snap_unit_size, 0)
            if requested_name == "snap_recipient_person_months":
                return recipient_count * 12
            return recipient_count
        if requested_name in {
            "cps_asec_age_80_84_population",
            "cps_asec_age_85_plus_population",
        } and entity == "person":
            age = self._native_model_array(
                "age", period, expected_entity="person"
            )
            # These are public-use category codes, not literal single years:
            # A_AGE=80 represents ages 80--84 and A_AGE=85 represents 85+.
            code = (
                80
                if requested_name == "cps_asec_age_80_84_population"
                else 85
            )
            return age == code
        if (
            requested_name
            == "bea_nipa_employer_government_social_insurance_contributions"
            and entity == "person"
        ):
            components = (
                "employer_social_security_tax",
                "employer_medicare_tax",
                "employer_federal_unemployment_tax",
                "employer_state_payroll_tax",
            )
            return sum(
                (
                    self._native_model_array(
                        name, period, expected_entity="person"
                    )
                    for name in components
                ),
                start=np.zeros(len(self.tables["person"]["person_id"])),
            )
        if (
            requested_name == "bea_nipa_gross_medicare_benefits"
            and entity == "person"
        ):
            # PolicyEngine defines medicare_cost net of beneficiary Part A/B
            # premiums. BEA records those premiums as contributions rather
            # than netting them out of Medicare social benefits.
            components = (
                "medicare_cost",
                "base_part_a_premium",
                "gross_medicare_part_b_premium",
            )
            return sum(
                (
                    self._native_model_array(
                        name, period, expected_entity="person"
                    )
                    for name in components
                ),
                start=np.zeros(len(self.tables["person"]["person_id"])),
            )

        model_name = VARIABLE_ALIASES.get(requested_name, requested_name)
        values = self._native_model_array(model_name, period, expected_entity=entity)
        if requested_name == "ssi_category":
            return np.char.lower(values.astype(str))
        return values

    def _native_model_array(
        self,
        model_name: str,
        period: str,
        *,
        expected_entity: str,
    ) -> np.ndarray:
        cache_key = (model_name, period)
        if cache_key not in self._calculation_cache:
            variable = self.simulation.tax_benefit_system.get_variable(model_name)
            variable_entity = variable.entity.key
            if variable_entity != expected_entity:
                raise ValueError(
                    f"PolicyEngine variable {model_name!r} belongs to entity "
                    f"{variable_entity!r}, not {expected_entity!r}"
                )
            self._calculation_cache[cache_key] = np.asarray(
                self.simulation.calculate(model_name, period, use_weights=False)
            )
        return self._calculation_cache[cache_key]

    def _person_values_to_tax_units(self, values: np.ndarray) -> np.ndarray:
        person = self.tables["person"]
        person_tax_units = self._column(person, "person_tax_unit_id")
        if len(values) != len(person_tax_units):
            raise ValueError("person-to-tax-unit values do not align with people")
        tax_unit_ids = self._column(self.tables["tax_unit"], "tax_unit_id")
        positions = {value: index for index, value in enumerate(tax_unit_ids.tolist())}
        try:
            indices = np.asarray(
                [positions[value] for value in person_tax_units.tolist()], dtype=int
            )
        except KeyError as error:
            raise ValueError(
                f"person references unknown tax unit: {error.args[0]}"
            ) from error
        result = np.zeros(len(tax_unit_ids), dtype=np.asarray(values).dtype)
        np.add.at(result, indices, values)
        return result

    def _tax_unit_values_to_people(self, values: np.ndarray) -> np.ndarray:
        tax_unit_ids = self._column(self.tables["tax_unit"], "tax_unit_id")
        if len(values) != len(tax_unit_ids):
            raise ValueError("tax-unit-to-person values do not align with tax units")
        positions = {value: index for index, value in enumerate(tax_unit_ids.tolist())}
        person_tax_units = self._column(
            self.tables["person"], "person_tax_unit_id"
        )
        try:
            indices = np.asarray(
                [positions[value] for value in person_tax_units.tolist()], dtype=int
            )
        except KeyError as error:
            raise ValueError(
                f"person references unknown tax unit: {error.args[0]}"
            ) from error
        return np.asarray(values)[indices]

    def _spm_values_to_households(self, values: np.ndarray) -> np.ndarray:
        spm_unit_ids = self._column(self.tables["spm_unit"], "spm_unit_id")
        if len(values) != len(spm_unit_ids):
            raise ValueError("SPM-to-household values do not align with SPM units")
        spm_households = self._spm_unit_households()
        household_ids = self._column(self.tables["household"], "household_id")
        positions = {value: index for index, value in enumerate(household_ids.tolist())}
        result = np.zeros(len(household_ids), dtype=bool)
        for household_id, value in zip(
            spm_households.tolist(), values.tolist(), strict=True
        ):
            try:
                position = positions[household_id]
            except KeyError as error:
                raise ValueError(
                    f"SPM unit references unknown household: {error.args[0]}"
                ) from error
            result[position] |= bool(value)
        return result

    def _spm_unit_households(self) -> np.ndarray:
        person = self.tables["person"]
        spm_to_household: dict[Any, Any] = {}
        for spm_unit_id, household_id in zip(
            self._column(person, "person_spm_unit_id").tolist(),
            self._column(person, "person_household_id").tolist(),
            strict=True,
        ):
            previous = spm_to_household.setdefault(spm_unit_id, household_id)
            if previous != household_id:
                raise ValueError(
                    f"SPM unit {spm_unit_id} belongs to multiple households"
                )
        spm_unit_ids = self._column(self.tables["spm_unit"], "spm_unit_id")
        try:
            return np.asarray(
                [spm_to_household[spm_unit_id] for spm_unit_id in spm_unit_ids]
            )
        except KeyError as error:
            raise ValueError(
                f"SPM unit has no household link: {error.args[0]}"
            ) from error

    def prepare(self, group: RunGroup) -> ArrayBundle:
        if group.source_id != "populace_us_policyengine_us_2024":
            raise ValueError(f"Microcosm runner cannot execute source {group.source_id!r}")
        if group.entity not in self.tables:
            raise ValueError(f"Microcosm dataset has no entity table {group.entity!r}")
        table = self.tables[group.entity]
        identifier = self._column(table, f"{group.entity}_id")
        length = len(identifier)
        country, state, district = self._entity_geographies(group.entity)
        geography_by_method = {
            "fixed_country": country,
            "state_fips": state,
            "congressional_district_geoid": district,
        }
        if group.geography_method == "congressional_district_geoid_117th":
            geography_by_method[group.geography_method] = (
                self._entity_old_congressional_districts(group.entity)
            )
        if group.geography_method not in geography_by_method:
            raise ValueError(f"unsupported geography method {group.geography_method!r}")
        arrays: dict[str, np.ndarray] = {
            "__geography__": geography_by_method[group.geography_method],
            "__country_geography__": country,
            "__state_geography__": state,
            "__district_geography__": district,
        }
        policy_period = (group.policy_period or group.population_period).split(":", 1)[-1]
        for name in group.required_variables:
            if name in arrays:
                continue
            if name == "spm_unit_weight" and group.entity == "spm_unit":
                household = self.tables["household"]
                arrays[name] = self._lookup(
                    self._column(household, "household_id"),
                    self._column(household, "household_weight"),
                    self._spm_unit_households(),
                    "SPM-unit weight join",
                )
            elif name == "bea_nipa.series_code":
                arrays[name] = np.full(length, "A034RC", dtype=object)
            elif name in table:
                arrays[name] = np.asarray(table[name])
            else:
                arrays[name] = self._model_array(name, group.entity, policy_period)
            if len(arrays[name]) != length:
                raise ValueError(
                    f"array length mismatch for {name!r}: {len(arrays[name])} != {length}"
                )
        masks = {
            domain: np.ones(length, dtype=bool)
            for domain in ENTITY_DOMAINS[group.entity]
        }
        if group.entity == "tax_unit":
            filer = self._model_array("tax_unit_is_filer", group.entity, policy_period)
            masks["all_individual_income_tax_returns"] = filer
            masks["individual_income_tax_returns"] = filer
            masks["individual_income_tax_returns_with_earned_income_credit"] = (
                self._model_array("eitc", group.entity, policy_period) != 0
            )
        return ArrayBundle(
            arrays=arrays,
            dataset_version=self.release.release_id,
            model_version=f"policyengine-us=={self.release.model_version}",
            domain_masks=masks,
        )

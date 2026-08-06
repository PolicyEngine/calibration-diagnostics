from __future__ import annotations

import hashlib
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

import numpy as np

from ..execution import ArrayBundle, RunGroup


POPULACE_REPOSITORY = "policyengine/populace-us"


@dataclass(frozen=True)
class PopulaceRelease:
    release_id: str
    dataset_filename: str
    dataset_sha256: str
    model_version: str
    repository: str = POPULACE_REPOSITORY

    @property
    def download_url(self) -> str:
        return (
            f"https://huggingface.co/datasets/{self.repository}/resolve/"
            f"{self.release_id}/{self.dataset_filename}"
        )


POPULACE_RELEASE = PopulaceRelease(
    release_id="populace-us-2024-buildp-sparse-rmloss100-cae8640-20260728T011454Z",
    dataset_filename="populace_us_2024.h5",
    dataset_sha256="48b9d479fb4fd1c3537f9383ce4697d130b6f618658409d74f6233c43b994c7e",
    model_version="1.764.6",
)


Downloader = Callable[[PopulaceRelease, Path], Any]
Table = Mapping[str, np.ndarray]
Tables = Mapping[str, Table]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(release: PopulaceRelease, target: Path) -> None:
    urllib.request.urlretrieve(release.download_url, target)


def resolve_release_dataset(
    release: PopulaceRelease,
    directory: str | Path,
    downloader: Downloader = _download,
) -> Path:
    """Resolve a pinned Populace artifact and reject any byte-level drift."""

    destination = Path(directory) / release.dataset_filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        downloader(release, destination)
    if not destination.is_file():
        raise ValueError(f"Populace downloader did not create {destination}")
    actual = _sha256(destination)
    if actual != release.dataset_sha256:
        raise ValueError(
            "Populace dataset checksum mismatch: "
            f"expected {release.dataset_sha256}, found {actual}"
        )
    return destination


def _default_table_loader(dataset_path: Path) -> Tables:
    try:
        import pandas as pd
    except ImportError as error:  # pragma: no cover - exercised by optional install
        raise RuntimeError("install the 'populace' extra to read Populace HDF5") from error
    tables: dict[str, dict[str, np.ndarray]] = {}
    with pd.HDFStore(dataset_path, mode="r") as store:
        available = {key.lstrip("/"): key for key in store.keys()}
        for entity in ("person", "household", "tax_unit"):
            if entity not in available:
                raise ValueError(f"Populace dataset has no {entity!r} table")
            frame = store[available[entity]]
            tables[entity] = {column: frame[column].to_numpy() for column in frame.columns}
    return tables


def _default_simulation_factory(dataset_path: Path) -> Any:
    try:
        from policyengine_us import Microsimulation
    except ImportError as error:  # pragma: no cover - exercised by optional install
        raise RuntimeError("install the 'populace' extra to run PolicyEngine-US") from error
    return Microsimulation(dataset=str(dataset_path))


VARIABLE_ALIASES = {
    "us:statutes/26/62#adjusted_gross_income": "adjusted_gross_income",
}

ENTITY_DOMAINS = {
    "person": ("resident_population", "total_population", "compensation_of_employees"),
    "household": ("households",),
    "tax_unit": ("all_individual_income_tax_returns",),
}


class PopulacePolicyEngineRunner:
    """Prepare entity-aligned arrays from one pinned Populace/PolicyEngine run."""

    def __init__(
        self,
        *,
        dataset_path: str | Path,
        release: PopulaceRelease = POPULACE_RELEASE,
        table_loader: Callable[[Path], Tables] = _default_table_loader,
        simulation_factory: Callable[[Path], Any] = _default_simulation_factory,
    ) -> None:
        self.dataset_path = Path(dataset_path)
        self.release = release
        self._table_loader = table_loader
        self._simulation_factory = simulation_factory
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
            raise ValueError(f"Populace table is missing required column {name!r}")
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
        household = self.tables["household"]
        household_ids = self._column(household, "household_id")
        if entity == "household":
            return country, states, districts
        person = self.tables["person"]
        person_households = self._column(person, "person_household_id")
        if entity == "person":
            return tuple(
                self._lookup(household_ids, values, person_households, "person-household join")
                for values in (country, states, districts)
            )
        if entity != "tax_unit":
            raise ValueError(f"unsupported Populace entity {entity!r}")

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
        return tuple(
            self._lookup(household_ids, values, assigned_households, "tax-unit household join")
            for values in (country, states, districts)
        )

    def _model_array(self, requested_name: str, entity: str, period: str) -> np.ndarray:
        model_name = VARIABLE_ALIASES.get(requested_name, requested_name)
        cache_key = (model_name, period)
        if cache_key not in self._calculation_cache:
            variable = self.simulation.tax_benefit_system.get_variable(model_name)
            variable_entity = variable.entity.key
            if variable_entity != entity:
                raise ValueError(
                    f"PolicyEngine variable {model_name!r} belongs to entity "
                    f"{variable_entity!r}, not {entity!r}"
                )
            self._calculation_cache[cache_key] = np.asarray(
                self.simulation.calculate(model_name, period, use_weights=False)
            )
        return self._calculation_cache[cache_key]

    def prepare(self, group: RunGroup) -> ArrayBundle:
        if group.source_id != "populace_us_policyengine_us_2024":
            raise ValueError(f"Populace runner cannot execute source {group.source_id!r}")
        if group.entity not in self.tables:
            raise ValueError(f"Populace dataset has no entity table {group.entity!r}")
        table = self.tables[group.entity]
        identifier = self._column(table, f"{group.entity}_id")
        length = len(identifier)
        country, state, district = self._entity_geographies(group.entity)
        geography_by_method = {
            "fixed_country": country,
            "state_fips": state,
            "congressional_district_geoid": district,
        }
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
            if name == "bea_nipa.series_code":
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
        return ArrayBundle(
            arrays=arrays,
            dataset_version=self.release.release_id,
            model_version=f"policyengine-us=={self.release.model_version}",
            domain_masks=masks,
        )

"""The per-country spec: what one measurement computes.

`countries/<code>/spec.yaml` holds everything country-specific: the series, the
engine module, the periods, the variable names the fixed output vocabulary
needs, the baseline variables list and the reform definitions. No code here or
elsewhere in the producer branches on a country code.

The spec's digest is part of the panel id, so an edit that can change a number
gives that country (and only that country) a new panel. The digest leaves out
what changes no number: which releases are in the series, the schedule, the
runner limits, and reform labels and sources (`measurement_definition`).
References live in a separate file (`references.yaml`) and are not part of the
digest either.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from release_history import SCHEMA_VERSION
from release_history.canonical import json_sha256

OUTPUT_LEVELS = ("targets", "budget", "distribution", "poverty")
STATS = ("sum", "count", "mean", "population")
KINDS = ("tax", "benefit", "caseload", "input", "population", "rate", "income", "other")
UNITS = ("currency", "count", "rate", "ratio")
SCHEDULES = ("weekly", "manual")
PERIOD_LABELS = ("fiscal_year", "calendar_year")
DISCLOSURE_POLICIES = ("none", "source_household_small_cells")
# CD171's absolute floor; a spec may raise it, never lower it.
MIN_SOURCE_HOUSEHOLD_FLOOR = 3
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
_DEFAULT_UNIT = {"sum": "currency", "count": "count", "mean": "rate", "population": "count"}
# Spec keys that change no measured number, so editing them keeps the panel (and
# its points): which releases are in the series, when it runs, runner limits.
_UNHASHED_KEYS = ("series", "schedule", "runner")
# Per reform: its display label and where it was taken from.
_UNHASHED_REFORM_KEYS = ("label", "source")


def measurement_definition(raw: Mapping[str, Any]) -> dict[str, Any]:
    """The part of a spec that decides the numbers; the panel id hashes this."""
    definition = {key: value for key, value in raw.items() if key not in _UNHASHED_KEYS}
    if isinstance(definition.get("reforms"), list):
        definition["reforms"] = [
            {key: value for key, value in reform.items() if key not in _UNHASHED_REFORM_KEYS}
            if isinstance(reform, Mapping)
            else reform
            for reform in definition["reforms"]
        ]
    return definition


class SpecError(ValueError):
    """A spec that cannot be measured as written."""


@dataclass(frozen=True)
class BaselineItem:
    id: str
    variables: tuple[str, ...]
    stat: str
    kind: str
    unit: str
    entity: str | None = None
    where: str | None = None
    by: str | None = None

    @property
    def is_programme(self) -> bool:
        """A plain tax or benefit total, which reforms report the change in."""
        return (
            self.kind in ("tax", "benefit")
            and self.stat == "sum"
            and self.where is None
            and self.by is None
        )


@dataclass(frozen=True)
class ReformSpec:
    id: str
    label: str
    add: Mapping[str, float]
    scale: Mapping[str, float]
    parameters: Mapping[str, Any]
    targets: tuple[str, ...]
    outputs: tuple[str, ...]
    source: Mapping[str, Any] | None = None

    @property
    def definition(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "add": dict(self.add),
            "scale": dict(self.scale),
            "parameters": dict(self.parameters),
            "targets": list(self.targets),
            "outputs": list(self.outputs),
        }

    @property
    def definition_sha256(self) -> str:
        return json_sha256(self.definition)


@dataclass(frozen=True)
class Spec:
    raw: Mapping[str, Any]
    country: str
    release_repo: str
    series_releases: tuple[str, ...]
    series_exclude: tuple[str, ...]
    schedule: str
    engine_module: str
    model_package: str
    simulation_options: Mapping[str, Any]
    periods: tuple[int, ...]
    period_label: str
    currency: str
    household_entity: str
    weights: Mapping[str, str]
    household_net_income: str | None
    budget_plus: tuple[str, ...]
    budget_minus: tuple[str, ...]
    income_decile: str | None
    poverty: Mapping[str, str]
    groups: Mapping[str, str | None]
    behaviour: Mapping[str, Any]
    baseline: tuple[BaselineItem, ...]
    reforms: tuple[ReformSpec, ...]
    outputs: tuple[str, ...]
    disclosure_policy: str
    min_source_households: int
    source_id_columns: tuple[str, ...]
    max_dataset_bytes: int | None
    digest: str = field(default="")

    def weight_variable(self, entity: str) -> str:
        return self.weights.get(entity, f"{entity}_weight")

    def label_period(self, period: int) -> str:
        if self.period_label == "fiscal_year":
            return f"{period}-{(period + 1) % 100:02d}"
        return str(period)

    @property
    def household_id_variable(self) -> str:
        return f"{self.household_entity}_id"

    def matches_series(self, release_directory: str, release_id: str | None = None) -> bool:
        """Whether a release build belongs to this country's series.

        An exclude pattern drops a build when it matches the build's release
        folder or its release id, so single builds of a release can be left out.
        """
        names = (release_directory,) + ((release_id,) if release_id else ())
        if any(re.search(pattern, name) for pattern in self.series_exclude for name in names):
            return False
        return any(
            release_directory == name or release_directory.startswith(f"{name}/")
            for name in self.series_releases
        ) or any(
            name.startswith("^") and re.search(name, release_directory)
            for name in self.series_releases
        )


def _require(mapping: Mapping[str, Any], key: str, where: str) -> Any:
    if key not in mapping or mapping[key] is None:
        raise SpecError(f"{where}: missing '{key}'.")
    return mapping[key]


def _identifier(value: Any, where: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.match(value):
        raise SpecError(f"{where}: '{value}' must be a lower-case identifier.")
    return value


def _names(value: Any, where: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise SpecError(f"{where}: must be a name or a list of names.")
    return tuple(value)


def _numbers(value: Any, where: str) -> dict[str, float]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise SpecError(f"{where}: must map parameter paths to numbers.")
    out = {}
    for path, number in value.items():
        if isinstance(number, bool) or not isinstance(number, int | float):
            raise SpecError(f"{where}: '{path}' must be a number.")
        out[str(path)] = float(number)
    return out


def _baseline_item(raw: Any, index: int) -> BaselineItem:
    where = f"baseline[{index}]"
    if not isinstance(raw, Mapping):
        raise SpecError(f"{where}: must be a mapping.")
    item_id = _identifier(_require(raw, "id", where), f"{where}.id")
    variables = _names(raw.get("variables", raw.get("variable")), f"{where}.variable")
    stat = _require(raw, "stat", where)
    if stat not in STATS:
        raise SpecError(f"{where}: stat '{stat}' must be one of {STATS}.")
    if stat == "population":
        if variables or not raw.get("entity"):
            raise SpecError(f"{where}: 'population' counts an 'entity' and takes no variable.")
    elif not variables:
        raise SpecError(f"{where}: needs 'variable' or 'variables'.")
    kind = raw.get("kind", "other")
    if kind not in KINDS:
        raise SpecError(f"{where}: kind '{kind}' must be one of {KINDS}.")
    unit = raw.get("unit", _DEFAULT_UNIT[stat])
    if unit not in UNITS:
        raise SpecError(f"{where}: unit '{unit}' must be one of {UNITS}.")
    by = raw.get("by")
    if by not in (None, "income_decile"):
        raise SpecError(f"{where}: by '{by}' must be 'income_decile' or absent.")
    return BaselineItem(
        id=item_id,
        variables=variables,
        stat=stat,
        kind=kind,
        unit=unit,
        entity=raw.get("entity"),
        where=raw.get("where"),
        by=by,
    )


def _reform(raw: Any, index: int, default_outputs: tuple[str, ...]) -> ReformSpec:
    where = f"reforms[{index}]"
    if not isinstance(raw, Mapping):
        raise SpecError(f"{where}: must be a mapping.")
    reform_id = _identifier(_require(raw, "id", where), f"{where}.id")
    add = _numbers(raw.get("add"), f"{where}.add")
    scale = _numbers(raw.get("scale"), f"{where}.scale")
    parameters = raw.get("parameters") or {}
    if not isinstance(parameters, Mapping):
        raise SpecError(f"{where}.parameters: must map parameter paths to values.")
    if not (add or scale or parameters):
        raise SpecError(f"{where}: needs at least one of 'add', 'scale' or 'parameters'.")
    paths = [*add, *scale, *parameters]
    if len(paths) != len(set(paths)):
        raise SpecError(f"{where}: a parameter path appears in more than one operation.")
    outputs = tuple(raw.get("outputs", default_outputs))
    unknown = set(outputs) - set(OUTPUT_LEVELS)
    if unknown or not outputs:
        raise SpecError(f"{where}: outputs {sorted(unknown)} must come from {OUTPUT_LEVELS}.")
    targets = _names(raw.get("targets"), f"{where}.targets")
    if "targets" in outputs and not targets:
        raise SpecError(f"{where}: the 'targets' output level needs a 'targets' list.")
    return ReformSpec(
        id=reform_id,
        label=str(raw.get("label", reform_id)),
        add=add,
        scale=scale,
        parameters=dict(parameters),
        targets=targets,
        outputs=outputs,
        source=raw.get("source"),
    )


def jsonable(value: Any) -> Any:
    """YAML dates (an unquoted 2026-01-01) become ISO strings; tuples become lists."""
    if isinstance(value, Mapping):
        return {str(jsonable(key)): jsonable(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [jsonable(item) for item in value]
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return value.isoformat()
    return value


def parse_spec(raw: Mapping[str, Any], *, expected_country: str | None = None) -> Spec:
    """Validate a spec document and return it parsed. Raises SpecError."""
    if not isinstance(raw, Mapping):
        raise SpecError("The spec must be a mapping.")
    raw = jsonable(raw)
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise SpecError(f"schema_version must be {SCHEMA_VERSION}.")
    country = _identifier(_require(raw, "country", "spec"), "spec.country")
    if expected_country is not None and country != expected_country:
        raise SpecError(f"spec.country '{country}' does not match its folder '{expected_country}'.")
    series = raw.get("series") or {}
    series_releases = _names(series.get("releases"), "series.releases")
    if not series_releases:
        raise SpecError("series.releases must name at least one release.")
    schedule = raw.get("schedule", "manual")
    if schedule not in SCHEDULES:
        raise SpecError(f"schedule '{schedule}' must be one of {SCHEDULES}.")
    engine = _require(raw, "engine", "spec")
    periods = raw.get("periods")
    if (
        not isinstance(periods, list)
        or not periods
        or not all(isinstance(p, int) and not isinstance(p, bool) for p in periods)
    ):
        raise SpecError("periods must be a non-empty list of years.")
    period_label = raw.get("period_label", "calendar_year")
    if period_label not in PERIOD_LABELS:
        raise SpecError(f"period_label '{period_label}' must be one of {PERIOD_LABELS}.")
    variables = raw.get("variables") or {}
    budget = variables.get("budget") or {}
    poverty = variables.get("poverty") or {}
    groups = variables.get("groups") or {"all": None}
    if "all" not in groups or groups["all"] is not None:
        raise SpecError("variables.groups must include 'all: null'.")
    outputs = tuple(raw.get("outputs", OUTPUT_LEVELS))
    unknown_levels = set(outputs) - set(OUTPUT_LEVELS)
    if unknown_levels:
        raise SpecError(f"outputs {sorted(unknown_levels)} must come from {OUTPUT_LEVELS}.")
    baseline = tuple(_baseline_item(item, i) for i, item in enumerate(raw.get("baseline") or []))
    reforms = tuple(_reform(item, i, outputs) for i, item in enumerate(raw.get("reforms") or []))
    for kind, ids in (("baseline", [b.id for b in baseline]), ("reform", [r.id for r in reforms])):
        if len(ids) != len(set(ids)):
            raise SpecError(f"Duplicate {kind} ids.")
    used_levels = {level for reform in reforms for level in reform.outputs}
    if "budget" in used_levels and not budget.get("plus"):
        raise SpecError("The 'budget' output level needs variables.budget.plus.")
    if "distribution" in used_levels and not (
        variables.get("household_net_income") and variables.get("income_decile")
    ):
        raise SpecError(
            "The 'distribution' output level needs variables.household_net_income and "
            "variables.income_decile."
        )
    if "poverty" in used_levels and not poverty:
        raise SpecError("The 'poverty' output level needs variables.poverty.")
    if any(item.by == "income_decile" for item in baseline) and not variables.get("income_decile"):
        raise SpecError("A baseline item 'by: income_decile' needs variables.income_decile.")
    disclosure = raw.get("disclosure") or {"policy": "none"}
    policy = disclosure.get("policy", "none")
    if policy not in DISCLOSURE_POLICIES:
        raise SpecError(f"disclosure.policy '{policy}' must be one of {DISCLOSURE_POLICIES}.")
    floor = int(disclosure.get("min_source_households", MIN_SOURCE_HOUSEHOLD_FLOOR))
    if floor < MIN_SOURCE_HOUSEHOLD_FLOOR:
        raise SpecError(
            f"disclosure.min_source_households may be raised, never lowered below "
            f"{MIN_SOURCE_HOUSEHOLD_FLOOR}."
        )
    source_id_columns = _names(disclosure.get("source_id_columns"), "disclosure.source_id_columns")
    if policy == "source_household_small_cells" and not source_id_columns:
        raise SpecError("source_household_small_cells needs disclosure.source_id_columns.")
    runner = raw.get("runner") or {}
    max_bytes = runner.get("max_dataset_bytes")
    spec = Spec(
        raw=raw,
        country=country,
        release_repo=str(_require(raw, "release_repo", "spec")),
        series_releases=series_releases,
        series_exclude=_names(series.get("exclude"), "series.exclude"),
        schedule=schedule,
        engine_module=_identifier(_require(engine, "module", "engine"), "engine.module"),
        model_package=str(_require(engine, "model_package", "engine")),
        simulation_options=dict(engine.get("simulation_options") or {}),
        periods=tuple(periods),
        period_label=period_label,
        currency=str(_require(raw, "currency", "spec")),
        household_entity=str(raw.get("household_entity", "household")),
        weights=dict(raw.get("weights") or {}),
        household_net_income=variables.get("household_net_income"),
        budget_plus=_names(budget.get("plus"), "variables.budget.plus"),
        budget_minus=_names(budget.get("minus"), "variables.budget.minus"),
        income_decile=variables.get("income_decile"),
        poverty=dict(poverty),
        groups=dict(groups),
        behaviour=dict(variables.get("behaviour") or {}),
        baseline=baseline,
        reforms=reforms,
        outputs=outputs,
        disclosure_policy=policy,
        min_source_households=floor,
        source_id_columns=source_id_columns,
        max_dataset_bytes=int(max_bytes) if max_bytes is not None else None,
        digest=json_sha256(measurement_definition(raw)),
    )
    return spec


def countries_dir() -> Path:
    """The `release_history/countries` folder next to this package's source."""
    return Path(__file__).resolve().parents[2] / "countries"


def load_spec(country: str, root: Path | None = None) -> Spec:
    path = (root or countries_dir()) / country / "spec.yaml"
    if not path.is_file():
        raise SpecError(f"No spec at {path}.")
    with path.open(encoding="utf-8") as stream:
        raw = yaml.safe_load(stream)
    return parse_spec(raw, expected_country=country)

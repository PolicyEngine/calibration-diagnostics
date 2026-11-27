"""The per-country spec: what one measurement computes.

`countries/<code>/spec.yaml` holds everything country-specific: the series, the
engine module, the periods, the variable names the fixed output vocabulary
needs, the baseline variables list and the reform definitions. No code here or
elsewhere in the producer branches on a country code.

The spec's digest is part of the panel id, so an edit that can change a number
gives that country (and only that country) a new panel. The digest leaves out
what changes no number: the spec's own format version, the release repository,
which builds are in the series, the runner limits, and the labels, sources,
notes and descriptions of baseline items and reforms
(`measurement_definition`). References live in a separate file
(`references.yaml`) and are not part of the digest either.

The spec format only grows: keys are added, an absent key means the old
behaviour, and the digest hashes the spec as written, so no default is ever
written into the hashed form.

The series is every build the release repository's `releases.json` records
under the lines `series.releases` names, published on or after
`series.since` when it is set.

When a country runs is not in the spec: weekly top-ups are switched on per
country by the repository variable `RELEASE_HISTORY_WEEKLY`, so turning one on
or off needs no pull request.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import yaml

from release_history import SPEC_FORMAT_VERSION
from release_history.canonical import json_sha256
from release_history.documents import CellUnit, DisclosurePolicy, RunnerLimits

OUTPUT_LEVELS = ("targets", "budget", "distribution", "poverty")
STATS = ("sum", "count", "mean", "population")
KINDS = ("tax", "benefit", "caseload", "input", "population", "rate", "income", "other")
UNITS = ("currency", "count", "rate", "ratio")
PERIOD_LABELS = ("fiscal_year", "calendar_year")
DISCLOSURE_POLICIES = ("none", "source_household_small_cells")
# CD171's absolute floor; a spec may raise it, never lower it.
MIN_SOURCE_HOUSEHOLD_FLOOR = 3
# A run is flagged once it uses this share of a runner limit: 20% short of the limit.
RUNNER_WARN_AT = 0.8
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DEFAULT_UNIT = {"sum": "currency", "count": "count", "mean": "rate", "population": "count"}
# Spec keys that change no measured number, so editing them keeps the panel (and
# its points): the spec's own format version, the release repository, which
# builds are in the series, and runner limits.
_UNHASHED_KEYS = ("schema_version", "release_repo", "series", "runner")
# On a baseline item or a reform: what the page shows and where it was taken from.
_DISPLAY_KEYS = ("label", "source", "note", "description")


def measurement_definition(raw: Mapping[str, Any]) -> dict[str, Any]:
    """The part of a spec that decides the numbers; the panel id hashes this."""
    definition = {key: value for key, value in raw.items() if key not in _UNHASHED_KEYS}
    for section in ("baseline", "reforms"):
        items: object = definition.get(section)
        if isinstance(items, list):
            definition[section] = [
                _without_display_keys(item) for item in cast(list[object], items)
            ]
    return definition


def _without_display_keys(item: object) -> object:
    if not isinstance(item, Mapping):
        return item
    entry = cast(Mapping[str, Any], item)
    return {key: value for key, value in entry.items() if key not in _DISPLAY_KEYS}


class SpecError(ValueError):
    """A spec that cannot be measured as written."""


@dataclass(frozen=True)
class BaselineItem:
    id: str
    variables: tuple[str, ...]
    stat: str
    kind: str
    unit: CellUnit
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
    # The release lines (`releases.json` names) whose builds make the series.
    series_releases: tuple[str, ...]
    # The first publish date in the series (YYYY-MM-DD), or None.
    series_since: str | None
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
    disclosure_policy: DisclosurePolicy
    min_source_households: int
    source_id_columns: tuple[str, ...]
    max_dataset_bytes: int | None
    # The measure step's time limit and the runner's memory; a run near either is flagged.
    max_seconds: int | None = None
    max_memory_bytes: int | None = None
    digest: str = field(default="")

    def weight_variable(self, entity: str) -> str:
        return self.weights.get(entity, f"{entity}_weight")

    def label_period(self, period: int) -> str:
        if self.period_label == "fiscal_year":
            return f"{period}-{(period + 1) % 100:02d}"
        return str(period)

    def runner_limits(self) -> RunnerLimits:
        """The limits a point runs under, recorded on the point (`runtime.limits`)."""
        return {
            "seconds": self.max_seconds,
            "memory_bytes": self.max_memory_bytes,
            "dataset_bytes": self.max_dataset_bytes,
            "warn_at": RUNNER_WARN_AT,
        }

    @property
    def household_id_variable(self) -> str:
        return f"{self.household_entity}_id"

    def in_series(self, release: str, published_at: str) -> bool:
        """Whether a recorded build belongs to the series: its line is named, and it was
        published on or after `series.since` (compared by UTC date)."""
        if release not in self.series_releases:
            return False
        return self.series_since is None or utc_date(published_at) >= self.series_since


def utc_date(timestamp: str) -> str:
    """The UTC date of an ISO 8601 time (one without an offset is read as UTC).

    Raises ValueError for text that is not an ISO 8601 time.
    """
    moment = dt.datetime.fromisoformat(timestamp)
    if moment.tzinfo is not None:
        moment = moment.astimezone(dt.UTC)
    return moment.date().isoformat()


def _require(mapping: Mapping[str, Any], key: str, where: str) -> Any:
    if key not in mapping or mapping[key] is None:
        raise SpecError(f"{where}: missing '{key}'.")
    return mapping[key]


def _mapping(value: object, error: str) -> Mapping[str, Any]:
    """A part of the spec that must be a mapping, typed as one."""
    if not isinstance(value, Mapping):
        raise SpecError(error)
    return cast(Mapping[str, Any], value)


def _section(raw: Mapping[str, Any], key: str, where: str) -> Mapping[str, Any]:
    """An optional mapping in the spec: empty when absent or empty."""
    value = raw.get(key)
    if not value:
        return {}
    return _mapping(value, f"{where}: must be a mapping.")


def _identifier(value: object, where: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.match(value):
        raise SpecError(f"{where}: '{value}' must be a lower-case identifier.")
    return value


def _names(value: object, where: str) -> tuple[str, ...]:
    """A name or a list of names, as a tuple; absent is none."""
    if value is None:
        return ()
    items = [value] if isinstance(value, str) else value
    if not isinstance(items, list):
        raise SpecError(f"{where}: must be a name or a list of names.")
    names: list[str] = []
    for name in cast(list[object], items):
        if not isinstance(name, str) or not name:
            raise SpecError(f"{where}: must be a name or a list of names.")
        names.append(name)
    return tuple(names)


def _numbers(value: object, where: str) -> dict[str, float]:
    if value is None:
        return {}
    numbers = _mapping(value, f"{where}: must map parameter paths to numbers.")
    out: dict[str, float] = {}
    for path, number in numbers.items():
        if isinstance(number, bool) or not isinstance(number, int | float):
            raise SpecError(f"{where}: '{path}' must be a number.")
        out[str(path)] = float(number)
    return out


def _baseline_item(value: object, index: int) -> BaselineItem:
    where = f"baseline[{index}]"
    raw = _mapping(value, f"{where}: must be a mapping.")
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


def _reform(value: object, index: int, default_outputs: tuple[str, ...]) -> ReformSpec:
    where = f"reforms[{index}]"
    raw = _mapping(value, f"{where}: must be a mapping.")
    reform_id = _identifier(_require(raw, "id", where), f"{where}.id")
    add = _numbers(raw.get("add"), f"{where}.add")
    scale = _numbers(raw.get("scale"), f"{where}.scale")
    parameters: Mapping[str, Any] = (
        _mapping(raw["parameters"], f"{where}.parameters: must map parameter paths to values.")
        if raw.get("parameters")
        else {}
    )
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


def jsonable(value: object) -> Any:
    """YAML dates (an unquoted 2026-01-01) become ISO strings; tuples become lists."""
    if isinstance(value, Mapping):
        mapping = cast(Mapping[object, object], value)
        return {str(jsonable(key)): jsonable(item) for key, item in mapping.items()}
    if isinstance(value, list | tuple):
        return [jsonable(item) for item in cast(list[object] | tuple[object, ...], value)]
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat) and not isinstance(value, str):
        return isoformat()
    return value


def parse_spec(document: object, *, expected_country: str | None = None) -> Spec:
    """Validate a spec document and return it parsed. Raises SpecError."""
    _mapping(document, "The spec must be a mapping.")
    raw: dict[str, Any] = jsonable(document)
    if raw.get("schema_version") != SPEC_FORMAT_VERSION:
        raise SpecError(f"schema_version must be {SPEC_FORMAT_VERSION}.")
    country = _identifier(_require(raw, "country", "spec"), "spec.country")
    if expected_country is not None and country != expected_country:
        raise SpecError(f"spec.country '{country}' does not match its folder '{expected_country}'.")
    series_releases, since = _series_rule(raw)
    if "schedule" in raw:
        raise SpecError(
            "schedule: weekly top-ups are switched on per country by the repository variable "
            "RELEASE_HISTORY_WEEKLY, not by the spec; remove the key."
        )
    engine = _mapping(_require(raw, "engine", "spec"), "engine: must be a mapping.")
    periods, period_label = _periods(raw)
    variables = _section(raw, "variables", "variables")
    budget = _section(variables, "budget", "variables.budget")
    groups = _groups(variables)
    outputs = _output_levels(raw)
    baseline = tuple(
        _baseline_item(item, index) for index, item in enumerate(raw.get("baseline") or [])
    )
    reforms = tuple(
        _reform(item, index, outputs) for index, item in enumerate(raw.get("reforms") or [])
    )
    _check_items(baseline, reforms, variables)
    policy, floor, source_id_columns = _disclosure(raw)
    limits = _runner_limits(raw)
    return Spec(
        raw=raw,
        country=country,
        release_repo=str(_require(raw, "release_repo", "spec")),
        series_releases=series_releases,
        series_since=since,
        engine_module=_identifier(_require(engine, "module", "engine"), "engine.module"),
        model_package=str(_require(engine, "model_package", "engine")),
        simulation_options=dict(
            _section(engine, "simulation_options", "engine.simulation_options")
        ),
        periods=periods,
        period_label=period_label,
        currency=str(_require(raw, "currency", "spec")),
        household_entity=str(raw.get("household_entity", "household")),
        weights=dict(_section(raw, "weights", "weights")),
        household_net_income=variables.get("household_net_income"),
        budget_plus=_names(budget.get("plus"), "variables.budget.plus"),
        budget_minus=_names(budget.get("minus"), "variables.budget.minus"),
        income_decile=variables.get("income_decile"),
        poverty=dict(_section(variables, "poverty", "variables.poverty")),
        groups=groups,
        behaviour=dict(_section(variables, "behaviour", "variables.behaviour")),
        baseline=baseline,
        reforms=reforms,
        outputs=outputs,
        disclosure_policy=policy,
        min_source_households=floor,
        source_id_columns=source_id_columns,
        max_dataset_bytes=limits["max_dataset_bytes"],
        max_seconds=limits["max_seconds"],
        max_memory_bytes=limits["max_memory_bytes"],
        digest=json_sha256(measurement_definition(raw)),
    )


def _series_rule(raw: Mapping[str, Any]) -> tuple[tuple[str, ...], str | None]:
    """The series' release lines, named as releases.json names them, and the date from which
    their builds count, if one is set."""
    series = _section(raw, "series", "series")
    releases = _names(series.get("releases"), "series.releases")
    if not releases:
        raise SpecError("series.releases must name at least one release line.")
    if any(name.startswith("^") for name in releases):
        raise SpecError(
            "series.releases names release lines as releases.json does; patterns are gone."
        )
    if "exclude" in series:
        raise SpecError(
            "series.exclude is gone: the series is every build releases.json records under "
            "series.releases, from the date series.since if set."
        )
    since = series.get("since")
    if since is not None and not (isinstance(since, str) and _DATE.match(since)):
        raise SpecError("series.since must be a date, YYYY-MM-DD.")
    return releases, since


def _periods(raw: Mapping[str, Any]) -> tuple[tuple[int, ...], str]:
    """The years measured, and how the page labels them."""
    periods: object = raw.get("periods")
    if not isinstance(periods, list) or not periods:
        raise SpecError("periods must be a non-empty list of years.")
    years: list[int] = []
    for period in cast(list[object], periods):
        if not isinstance(period, int) or isinstance(period, bool):
            raise SpecError("periods must be a non-empty list of years.")
        years.append(period)
    period_label = raw.get("period_label", "calendar_year")
    if period_label not in PERIOD_LABELS:
        raise SpecError(f"period_label '{period_label}' must be one of {PERIOD_LABELS}.")
    return tuple(years), period_label


def _groups(variables: Mapping[str, Any]) -> dict[str, str | None]:
    """The poverty groups by name: `all` (no variable) and any group a person flag defines."""
    groups: dict[str, str | None] = dict(_section(variables, "groups", "variables.groups")) or {
        "all": None
    }
    if "all" not in groups or groups["all"] is not None:
        raise SpecError("variables.groups must include 'all: null'.")
    return groups


def _output_levels(raw: Mapping[str, Any]) -> tuple[str, ...]:
    """The output levels a reform gets when it names none."""
    outputs = tuple(raw.get("outputs", OUTPUT_LEVELS))
    unknown_levels = set(outputs) - set(OUTPUT_LEVELS)
    if unknown_levels:
        raise SpecError(f"outputs {sorted(unknown_levels)} must come from {OUTPUT_LEVELS}.")
    return outputs


def _check_items(
    baseline: tuple[BaselineItem, ...],
    reforms: tuple[ReformSpec, ...],
    variables: Mapping[str, Any],
) -> None:
    """Ids are unique, and every output level asked for has the variables it needs."""
    for kind, ids in (
        ("baseline", [item.id for item in baseline]),
        ("reform", [reform.id for reform in reforms]),
    ):
        if len(ids) != len(set(ids)):
            raise SpecError(f"Duplicate {kind} ids.")
    used_levels = {level for reform in reforms for level in reform.outputs}
    if "budget" in used_levels and not _section(variables, "budget", "variables.budget").get(
        "plus"
    ):
        raise SpecError("The 'budget' output level needs variables.budget.plus.")
    if "distribution" in used_levels and not (
        variables.get("household_net_income") and variables.get("income_decile")
    ):
        raise SpecError(
            "The 'distribution' output level needs variables.household_net_income and "
            "variables.income_decile."
        )
    if "poverty" in used_levels and not variables.get("poverty"):
        raise SpecError("The 'poverty' output level needs variables.poverty.")
    if any(item.by == "income_decile" for item in baseline) and not variables.get("income_decile"):
        raise SpecError("A baseline item 'by: income_decile' needs variables.income_decile.")


def _disclosure(raw: Mapping[str, Any]) -> tuple[DisclosurePolicy, int, tuple[str, ...]]:
    """The disclosure policy, its floor of source households (raised, never lowered), and
    the columns that hold each household's source id."""
    disclosure = _section(raw, "disclosure", "disclosure") or {"policy": "none"}
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
    return policy, floor, source_id_columns


def _runner_limits(raw: Mapping[str, Any]) -> dict[str, int | None]:
    """The runner block's limits: each a positive whole number, or absent."""
    runner = _section(raw, "runner", "runner")
    limits = {
        key: runner.get(key) for key in ("max_dataset_bytes", "max_seconds", "max_memory_bytes")
    }
    for key, value in limits.items():
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or value <= 0
        ):
            raise SpecError(f"runner.{key} must be a positive whole number.")
    return limits


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

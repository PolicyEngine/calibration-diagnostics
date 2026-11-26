"""Compute one measurement: the spec's baseline items and reform outputs.

Cost is set by the number of simulations, never by the number of outputs: one
baseline simulation plus one simulation per reform, each covering every
period. One simulation is alive at a time. The baseline keeps only the arrays
the reform outputs need (net income, budget terms, decile, poverty flags,
programme and target variables, weights and entity positions), then is freed.

Every number is a `Cell` with an output id, so a measurement is a flat list of
cells:

- `baseline/<item>` (or `baseline/<item>/decile_<d>`);
- `reform/<id>/target/<variable>`;
- `reform/<id>/budgetary_impact`, `reform/<id>/programme/<item>`;
- `reform/<id>/households_gaining|households_losing|people_gaining|people_losing`;
- `reform/<id>/net_income_change_pct`, `reform/<id>/decile_relative_change/decile_<d>`;
- `reform/<id>/poverty/<measure>/<group>`.

A reform that crashes contributes no cells and records its error: a gap,
never a zero.
"""

from __future__ import annotations

import math
import traceback
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from release_history.disclosure import RESIDUAL, Cell, Table
from release_history.reforms import behaviour_dict, merged, reform_dict
from release_history.simulate import Backend, PeakMemory, SimulationView, WarningLog
from release_history.spec import BaselineItem, ReformSpec, Spec

# A household's change counts as a change when it moves by more than this.
CURRENCY_TOLERANCE = 0.005
# pe.py's ChangeAggregate thresholds for gaining and losing (change_geq=1 / change_leq=-1).
GAIN_THRESHOLD = 1.0
DECILES = tuple(range(1, 11))


class MeasurementError(RuntimeError):
    """A failure that ends the whole measurement, with the stage it happened in."""

    def __init__(self, stage: str, error: BaseException) -> None:
        super().__init__(f"{stage}: {type(error).__name__}")
        self.stage = stage
        self.error = error


def error_record(stage: str, error: BaseException) -> dict[str, Any]:
    """An error as stored: its class, its stage and a model name if it names one.

    Exception text can carry values, so it is never stored or printed. The one
    exception is a missing variable or parameter, whose message is a name.
    """
    record: dict[str, Any] = {"stage": stage, "class": type(error).__name__}
    name = getattr(error, "args", ())
    if isinstance(error, LookupError) and name and isinstance(name[0], str):
        if " " not in name[0].strip("'\"") and len(name[0]) < 200:
            record["name"] = name[0].strip("'\"")
    frames = traceback.extract_tb(error.__traceback__)
    if frames:
        last = frames[-1]
        record["where"] = f"{last.filename.rsplit('/', 1)[-1]}:{last.lineno}"
    return record


def _finite(value: float) -> float | None:
    value = float(value)
    return value if math.isfinite(value) else None


@dataclass
class Frame:
    """Entity positions and weights for one simulation and period."""

    household_entity: str
    household_ids: np.ndarray
    positions: dict[str, np.ndarray]
    weights: dict[str, np.ndarray]

    @property
    def household_count(self) -> int:
        return int(self.household_ids.size)

    def to_households(self, entity: str, mask: np.ndarray) -> np.ndarray:
        """A household-level mask: households with any member where `mask` holds."""
        out = np.zeros(self.household_count, dtype=bool)
        out[self.positions[entity][np.asarray(mask, dtype=bool)]] = True
        return out

    def household_sum(self, entity: str, values: np.ndarray) -> np.ndarray:
        return np.bincount(self.positions[entity], weights=values, minlength=self.household_count)


def _lookup(sorted_keys: np.ndarray, order: np.ndarray, keys: np.ndarray, what: str) -> np.ndarray:
    index = np.clip(np.searchsorted(sorted_keys, keys), 0, max(sorted_keys.size - 1, 0))
    if sorted_keys.size == 0 or not np.array_equal(sorted_keys[index], keys):
        raise ValueError(f"{what} name ids the model does not list")
    return order[index]


def build_frame(sim: SimulationView, spec: Spec, period: int, entities: Iterable[str]) -> Frame:
    """Position every entity's members in household order, through their people.

    A household id is projected onto people, which is exact. Mapping it onto
    another group entity directly is not: policyengine-core moves values
    between group entities by dividing them among people and summing, which
    keeps totals but not ids. So a group entity finds its household through
    any one of its people.
    """
    household = spec.household_entity
    id_variable = spec.household_id_variable
    household_ids = np.asarray(sim.values(id_variable, period))
    order = np.argsort(household_ids, kind="stable")
    sorted_ids = household_ids[order]
    person_households = np.asarray(sim.values(id_variable, period, map_to="person"))
    positions = {
        household: np.arange(household_ids.size),
        "person": _lookup(sorted_ids, order, person_households, "people"),
    }
    weights = {household: np.asarray(sim.values(spec.weight_variable(household), period), float)}
    for entity in sorted(set(entities) | {"person"}):
        if entity not in positions:
            entity_ids = np.asarray(sim.values(f"{entity}_id", period))
            person_entity_ids = np.asarray(sim.values(f"{entity}_id", period, map_to="person"))
            unique_ids, first = np.unique(person_entity_ids, return_index=True)
            member = _lookup(unique_ids, np.arange(unique_ids.size), entity_ids, entity)
            positions[entity] = _lookup(
                sorted_ids, order, person_households[first][member], f"{entity} members"
            )
        if entity not in weights:
            weights[entity] = np.asarray(sim.values(spec.weight_variable(entity), period), float)
    return Frame(
        household_entity=household,
        household_ids=household_ids,
        positions=positions,
        weights=weights,
    )


def entity_values(
    sim: SimulationView, variable: str, period: int, entity: str, frame: Frame | None = None
) -> np.ndarray:
    """A variable's values on an entity.

    Household values reach a member entity by position (an exact projection).
    Member values reach their household or another group through the model's
    own mapping, which keeps totals.
    """
    native = sim.entity_of(variable)
    if native == entity:
        return np.asarray(sim.values(variable, period), dtype=float)
    if frame is not None and native == frame.household_entity and entity in frame.positions:
        return np.asarray(sim.values(variable, period), dtype=float)[frame.positions[entity]]
    return np.asarray(sim.values(variable, period, map_to=entity), dtype=float)


@dataclass
class BaselinePeriod:
    """What the reform outputs need from the baseline, for one period."""

    frame: Frame
    programme: dict[str, tuple[str, np.ndarray]] = field(default_factory=dict)
    targets: dict[str, tuple[str, np.ndarray]] = field(default_factory=dict)
    budget: np.ndarray | None = None
    net_income: np.ndarray | None = None
    decile: np.ndarray | None = None
    poverty: dict[str, np.ndarray] = field(default_factory=dict)
    groups: dict[str, np.ndarray] = field(default_factory=dict)


def _entities_needed(spec: Spec, sim: SimulationView) -> set[str]:
    entities = {spec.household_entity}
    for item in spec.baseline:
        if item.entity:
            entities.add(item.entity)
        for variable in item.variables:
            entities.add(sim.entity_of(variable))
    for reform in spec.reforms:
        for variable in reform.targets:
            entities.add(sim.entity_of(variable))
    if spec.poverty or any("distribution" in reform.outputs for reform in spec.reforms):
        entities.add("person")
    return entities


def _baseline_cells(
    item: BaselineItem,
    sim: SimulationView,
    frame: Frame,
    period: int,
    household_decile: np.ndarray | None,
) -> list[Cell]:
    entity = item.entity or sim.entity_of(item.variables[0])
    weights = frame.weights[entity]
    positions = frame.positions[entity]
    if item.stat == "population":
        values = np.ones(weights.size)
    else:
        values = np.zeros(weights.size)
        for variable in item.variables:
            values = values + entity_values(sim, variable, period, entity, frame)
    group = np.ones(weights.size, dtype=bool)
    if item.where:
        group = entity_values(sim, item.where, period, entity, frame).astype(bool)

    def cell(selection: np.ndarray, output: str) -> Cell:
        nonzero = selection & (values != 0)
        if item.stat == "sum":
            value = _finite(np.sum(weights[selection] * values[selection]))
            supports = [frame.to_households(entity, nonzero)]
        elif item.stat == "count":
            positive = selection & (values > 0)
            value = _finite(np.sum(weights[positive]))
            supports = [frame.to_households(entity, positive)]
        elif item.stat == "population":
            value = _finite(np.sum(weights[selection]))
            supports = [frame.to_households(entity, selection)]
        else:  # mean
            denominator = float(np.sum(weights[selection]))
            value = (
                _finite(np.sum(weights[selection] * values[selection]) / denominator)
                if denominator > 0
                else None
            )
            supports = [frame.to_households(entity, nonzero)]
            if item.unit == "rate":  # a share needs its complement on enough households too
                supports.append(frame.to_households(entity, selection & (values == 0)))
        return Cell(output, period, item.unit, value, supports=supports)

    if item.by == "income_decile":
        entity_decile = household_decile[positions]
        return [
            cell(group & (entity_decile == decile), f"baseline/{item.id}/decile_{decile}")
            for decile in DECILES
        ]
    return [cell(group, f"baseline/{item.id}")]


def _keep_baseline(spec: Spec, sim: SimulationView, frame: Frame, period: int) -> BaselinePeriod:
    kept = BaselinePeriod(frame=frame)
    for item in spec.baseline:
        if item.is_programme:
            entity = item.entity or sim.entity_of(item.variables[0])
            values = sum(
                entity_values(sim, variable, period, entity, frame) for variable in item.variables
            )
            kept.programme[item.id] = (entity, np.asarray(values, float))
    for reform in spec.reforms:
        for variable in reform.targets:
            if variable not in kept.targets:
                entity = sim.entity_of(variable)
                kept.targets[variable] = (entity, entity_values(sim, variable, period, entity))
    levels = {level for reform in spec.reforms for level in reform.outputs}
    household = spec.household_entity
    if "budget" in levels:
        kept.budget = _budget(spec, sim, period)
    if "distribution" in levels or "poverty" in levels:
        kept.net_income = entity_values(sim, spec.household_net_income, period, household)
        kept.decile = entity_values(sim, spec.income_decile, period, household).astype(int)
    if "poverty" in levels:
        for measure, variable in spec.poverty.items():
            kept.poverty[measure] = entity_values(sim, variable, period, household).astype(bool)
        for group, variable in spec.groups.items():
            if variable is not None:
                kept.groups[group] = entity_values(sim, variable, period, "person", frame).astype(
                    bool
                )
    return kept


def _budget(spec: Spec, sim: SimulationView, period: int) -> np.ndarray:
    household = spec.household_entity
    total = 0.0
    for variable in spec.budget_plus:
        total = total + entity_values(sim, variable, period, household)
    for variable in spec.budget_minus:
        total = total - entity_values(sim, variable, period, household)
    return np.asarray(total, float)


def _changed(delta: np.ndarray) -> np.ndarray:
    return np.abs(delta) > CURRENCY_TOLERANCE


@dataclass(frozen=True)
class ReformPeriod:
    """One reform's simulation in one period, beside the baseline it is compared with."""

    reform: ReformSpec
    spec: Spec
    sim: SimulationView
    period: int
    base: BaselinePeriod

    @property
    def frame(self) -> Frame:
        return self.base.frame

    @property
    def prefix(self) -> str:
        return f"reform/{self.reform.id}"

    @property
    def household_weights(self) -> np.ndarray:
        return self.frame.weights[self.spec.household_entity]

    def currency_cell(self, output: str, entity: str, delta: np.ndarray) -> Cell:
        """A change in a weighted total, resting on the households whose value changed."""
        return Cell(
            output,
            self.period,
            "currency",
            _finite(np.sum(self.frame.weights[entity] * delta)),
            supports=[self.frame.to_households(entity, _changed(delta))],
        )


def _reform_cells(
    reform: ReformSpec, spec: Spec, sim: SimulationView, period: int, base: BaselinePeriod
) -> tuple[list[Cell], list[Table]]:
    """Every output section the reform asks for, in one period, in a fixed order."""
    run = ReformPeriod(reform, spec, sim, period, base)
    cells: list[Cell] = []
    tables: list[Table] = []
    if "targets" in reform.outputs:
        cells.extend(_target_cells(run))
    if "budget" in reform.outputs:
        budget_cells, budget_table = _budget_cells(run)
        cells.extend(budget_cells)
        tables.append(budget_table)
    if "distribution" in reform.outputs:
        distribution_cells, distribution_table = _distribution_cells(run)
        cells.extend(distribution_cells)
        tables.append(distribution_table)
    if "poverty" in reform.outputs:
        poverty_cells, poverty_tables = _poverty_cells(run)
        cells.extend(poverty_cells)
        tables.extend(poverty_tables)
    return cells, tables


def _target_cells(run: ReformPeriod) -> list[Cell]:
    """The change in each target variable's weighted total."""
    cells = []
    for variable in run.reform.targets:
        entity, before = run.base.targets[variable]
        delta = entity_values(run.sim, variable, run.period, entity, run.frame) - before
        cells.append(run.currency_cell(f"{run.prefix}/target/{variable}", entity, delta))
    return cells


def _budget_cells(run: ReformPeriod) -> tuple[list[Cell], Table]:
    """The budgetary impact and each programme's part of it. The table ties the parts to
    the impact: what no programme explains is a hidden residual."""
    spec, frame, period = run.spec, run.frame, run.period
    budget_delta = _budget(spec, run.sim, period) - run.base.budget
    total = f"{run.prefix}/budgetary_impact"
    cells = [
        Cell(
            total,
            period,
            "currency",
            _finite(np.sum(run.household_weights * budget_delta)),
            supports=[_changed(budget_delta)],
        )
    ]
    residual = budget_delta.copy()
    parts = []
    for item in spec.baseline:
        if not item.is_programme:
            continue
        entity, before = run.base.programme[item.id]
        after = sum(
            entity_values(run.sim, variable, period, entity, frame) for variable in item.variables
        )
        delta = np.asarray(after, float) - before
        part = f"{run.prefix}/programme/{item.id}"
        cells.append(run.currency_cell(part, entity, delta))
        parts.append(part)
        sign = 1.0 if item.kind == "tax" else -1.0
        residual = residual - sign * frame.household_sum(entity, delta)
    return cells, Table(period, total, parts, hidden=[_changed(residual)], reason=RESIDUAL)


def _distribution_cells(run: ReformPeriod) -> tuple[list[Cell], Table]:
    """Households and people gaining and losing, the change in net income, and its relative
    change in each income decile. The table ties the deciles to the total: households
    outside every decile are hidden."""
    spec, frame, period, base = run.spec, run.frame, run.period, run.base
    household_weights = run.household_weights
    person_weights = frame.weights["person"]
    person_positions = frame.positions["person"]
    after_income = entity_values(run.sim, spec.household_net_income, period, spec.household_entity)
    delta = after_income - base.net_income
    cells = []
    gaining, losing = delta >= GAIN_THRESHOLD, delta <= -GAIN_THRESHOLD
    for name, mask in (("gaining", gaining), ("losing", losing)):
        cells.append(
            Cell(
                f"{run.prefix}/households_{name}",
                period,
                "count",
                _finite(np.sum(household_weights[mask])),
                supports=[mask],
            )
        )
        cells.append(
            Cell(
                f"{run.prefix}/people_{name}",
                period,
                "count",
                _finite(np.sum(person_weights[mask[person_positions]])),
                supports=[mask],
            )
        )
    changed = _changed(delta)
    before_total = float(np.sum(household_weights * base.net_income))
    total = f"{run.prefix}/net_income_change_pct"
    cells.append(
        Cell(
            total,
            period,
            "ratio",
            _finite(100 * np.sum(household_weights * delta) / before_total)
            if before_total
            else None,
            supports=[changed],
        )
    )
    parts = []
    for decile in DECILES:
        in_decile = base.decile == decile
        before_decile = float(np.sum(household_weights[in_decile] * base.net_income[in_decile]))
        part = f"{run.prefix}/decile_relative_change/decile_{decile}"
        cells.append(
            Cell(
                part,
                period,
                "ratio",
                _finite(
                    100 * np.sum(household_weights[in_decile] * delta[in_decile]) / before_decile
                )
                if before_decile
                else None,
                supports=[changed & in_decile],
            )
        )
        parts.append(part)
    outside = ~np.isin(base.decile, DECILES)
    return cells, Table(period, total, parts, hidden=[changed & outside])


def _poverty_cells(run: ReformPeriod) -> tuple[list[Cell], list[Table]]:
    """The change in the number of people in poverty, by measure and group. For each
    measure, the groups a variable defines are parts of `all`, and the households of the
    people outside every such group are hidden."""
    spec, frame, period = run.spec, run.frame, run.period
    person_positions = frame.positions["person"]
    person_weights = frame.weights["person"]
    cells = []
    tables = []
    for measure, variable in spec.poverty.items():
        after = entity_values(run.sim, variable, period, spec.household_entity).astype(bool)
        moved = after.astype(int) - run.base.poverty[measure].astype(int)
        status_changed = moved != 0
        person_moved = moved[person_positions]
        in_part_groups = np.zeros(person_positions.size, dtype=bool)
        parts = []
        for group, group_variable in spec.groups.items():
            members = (
                np.ones(person_positions.size, dtype=bool)
                if group_variable is None
                else run.base.groups[group]
            )
            output = f"{run.prefix}/poverty/{measure}/{group}"
            cells.append(
                Cell(
                    output,
                    period,
                    "count",
                    _finite(np.sum(person_weights[members] * person_moved[members])),
                    supports=[status_changed & frame.to_households("person", members)],
                )
            )
            if group_variable is not None:
                parts.append(output)
                in_part_groups |= members
        if parts:
            rest = frame.to_households("person", ~in_part_groups)
            tables.append(
                Table(
                    period,
                    f"{run.prefix}/poverty/{measure}/all",
                    parts,
                    hidden=[status_changed & rest],
                )
            )
    return cells, tables


@dataclass
class Measurement:
    cells: list[Cell] = field(default_factory=list)
    tables: list[Table] = field(default_factory=list)
    baseline_status: dict[str, Any] = field(default_factory=lambda: {"status": "ok"})
    reforms: dict[str, dict[str, Any]] = field(default_factory=dict)
    simulations: list[dict[str, Any]] = field(default_factory=list)
    warnings: set[str] = field(default_factory=set)
    household_ids: np.ndarray | None = None
    engine_bundle: dict[str, Any] = field(default_factory=dict)
    model_variables: set[str] = field(default_factory=set)

    @property
    def status(self) -> str:
        if self.baseline_status["status"] != "ok":
            return "error"
        if any(record["status"] != "ok" for record in self.reforms.values()):
            return "partial"
        return "ok"


def measure(
    spec: Spec,
    backend: Backend,
    *,
    on_progress: Callable[[str], None] | None = None,
) -> Measurement:
    """Run the baseline and every reform. Raises MeasurementError if the baseline fails."""
    result = Measurement()
    note = on_progress or (lambda _message: None)
    note("baseline")
    kept, definitions = _measure_baseline(spec, backend, result)
    for reform in spec.reforms:
        if reform.id in result.reforms:
            continue  # Its definition failed, and the baseline recorded why.
        note(f"reform:{reform.id}")
        _measure_reform(spec, backend, reform, definitions[reform.id], kept, result)
    return result


def _measure_baseline(
    spec: Spec, backend: Backend, result: Measurement
) -> tuple[dict[int, BaselinePeriod], dict[str, dict[str, dict[str, Any]]]]:
    """The baseline simulation: its cells, what the reforms need from it in each period,
    and each reform's definition, read from its parameters. Raises MeasurementError."""
    with PeakMemory() as memory, WarningLog() as log:
        try:
            sim = backend.build(_behaviour(spec))
        except Exception as error:  # noqa: BLE001 - recorded, never printed
            raise MeasurementError("load", error) from error
        try:
            definitions = _reform_definitions(spec, sim.parameters, result)
            entities = _entities_needed(spec, sim)
            kept: dict[int, BaselinePeriod] = {}
            for period in spec.periods:
                frame = build_frame(sim, spec, period, entities)
                result.cells.extend(_baseline_period_cells(spec, sim, frame, period))
                kept[period] = _keep_baseline(spec, sim, frame, period)
            result.household_ids = kept[spec.periods[0]].frame.household_ids
            result.engine_bundle = getattr(sim, "bundle", {}) or {}
            names = getattr(sim, "variable_names", None)
            result.model_variables = set(names()) if callable(names) else set()
        except Exception as error:  # noqa: BLE001
            raise MeasurementError("baseline", error) from error
        finally:
            sim.close()
            del sim
    result.warnings |= log.classes
    result.simulations.append(_simulation_record("baseline", memory))
    return kept, definitions


def _behaviour(spec: Spec) -> dict[str, dict[str, Any]] | None:
    """The spec's behavioural parameters, set in every period, or None when it sets none."""
    return {
        path: {f"{period}-01-01.{period}-12-31": value for period in spec.periods}
        for path, value in spec.behaviour.items()
    } or None


def _reform_definitions(
    spec: Spec, parameters: Any, result: Measurement
) -> dict[str, dict[str, dict[str, Any]]]:
    """Each reform's parameter changes with the spec's behaviour; a reform whose definition
    fails is recorded as an error, with no simulation."""
    definitions = {}
    for reform in spec.reforms:
        try:
            definitions[reform.id] = merged(
                behaviour_dict(spec.behaviour, parameters, spec.periods),
                reform_dict(reform, parameters, spec.periods),
            )
        except Exception as error:  # noqa: BLE001
            result.reforms[reform.id] = {
                "status": "error",
                "error": error_record("reform_definition", error),
                "definition_sha256": reform.definition_sha256,
            }
    return definitions


def _baseline_period_cells(
    spec: Spec, sim: SimulationView, frame: Frame, period: int
) -> list[Cell]:
    cells = []
    for item in spec.baseline:
        household_decile = (
            entity_values(sim, spec.income_decile, period, spec.household_entity).astype(int)
            if item.by == "income_decile"
            else None
        )
        cells.extend(_baseline_cells(item, sim, frame, period, household_decile))
    return cells


def _measure_reform(
    spec: Spec,
    backend: Backend,
    reform: ReformSpec,
    definition: dict[str, dict[str, Any]],
    kept: dict[int, BaselinePeriod],
    result: Measurement,
) -> None:
    """One reform's simulation: its cells in every period, or its error and no cells."""
    record: dict[str, Any] = {
        "status": "ok",
        "definition_sha256": reform.definition_sha256,
        "applied": _applied(definition),
    }
    with PeakMemory() as memory, WarningLog() as log:
        sim = None
        try:
            sim = backend.build(definition)
            cells, tables = [], []
            for period in spec.periods:
                base = kept[period]
                ids = np.asarray(sim.values(spec.household_id_variable, period))
                if not np.array_equal(ids, base.frame.household_ids):
                    raise ValueError("reform households differ from the baseline's")
                period_cells, period_tables = _reform_cells(reform, spec, sim, period, base)
                cells.extend(period_cells)
                tables.extend(period_tables)
            result.cells.extend(cells)
            result.tables.extend(tables)
        except Exception as error:  # noqa: BLE001 - a gap, never a zero
            record["status"] = "error"
            record["error"] = error_record(f"reform:{reform.id}", error)
        finally:
            if sim is not None:
                sim.close()
            del sim
    result.warnings |= log.classes
    result.reforms[reform.id] = record
    result.simulations.append(_simulation_record(f"reform:{reform.id}", memory))


def _simulation_record(label: str, memory: PeakMemory) -> dict[str, Any]:
    return {
        "label": label,
        "seconds": round(memory.seconds, 2),
        "peak_rss_bytes": memory.peak_bytes,
    }


def _applied(reform: Mapping[str, Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """The reform as applied: absolute values per period (public parameters only)."""
    out: dict[str, dict[str, Any]] = {}
    for path, values in reform.items():
        out[path] = {
            key: (
                float(value)
                if isinstance(value, int | float) and not isinstance(value, bool)
                else value
            )
            for key, value in values.items()
        }
    return out

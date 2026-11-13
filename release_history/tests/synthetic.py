"""A synthetic model world for any country's spec: the fixtures are made with it.

Every value is invented from a seed. No survey data, no country model: the
world answers any variable and parameter name a spec uses, so each country's
real spec can be measured end to end in a test. What a variable is (an id, a
weight, a decile, a flag, an amount) and which entity holds it come from the
role the spec gives it, never from a country code.

- Entities: the spec's household entity, `person`, and every entity a
  baseline item names; group entities nest inside households.
- Households: `households` of them, two to a source household mostly (clones
  share a source id, as Microcosm's do), and one decile held by two
  households, so a floor of 3 withholds a few cells and the complementary
  rule a few more.
- A reform moves a reform-dependent fifth of households, so every reform has
  outputs; the same reform on the same build gives the same world.
- A build's `seed` (a file's synthetic digest) moves every amount, so two
  files give two different points and the timeline has steps.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from release_history.spec import Spec


def _seed(*parts: object) -> int:
    text = "\x1f".join(str(part) for part in parts)
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)


class SyntheticParameter:
    """Every node is a leaf with a numeric value, so any dotted path or bracket resolves."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._value = 0.1 + (_seed("parameter", path) % 900) / 1000
        self.values_list = [self._value]

    def __call__(self, instant: str) -> float:
        return self._value

    def __getattr__(self, name: str) -> SyntheticParameter:
        if name.startswith("_"):
            raise AttributeError(name)
        child = SyntheticParameter(f"{self._path}.{name}")
        object.__setattr__(self, name, child)
        return child

    @property
    def brackets(self) -> _Brackets:
        return _Brackets(self._path)


class _Brackets:
    def __init__(self, path: str) -> None:
        self._path = path

    def __getitem__(self, index: int) -> SyntheticParameter:
        return SyntheticParameter(f"{self._path}[{index}]")


@dataclass
class SyntheticWorld:
    """The structure every build shares: entities, membership, weights, deciles, sources."""

    spec: Spec
    households: int = 60

    def __post_init__(self) -> None:
        spec = self.spec
        rng = np.random.default_rng(_seed("structure", spec.country))
        household = spec.household_entity
        self.group_entities = sorted(
            {item.entity for item in spec.baseline if item.entity} - {household, "person"}
        )
        sizes = rng.integers(1, 5, size=self.households)
        person_household = np.repeat(np.arange(self.households), sizes)
        self.persons = int(person_household.size)
        self.index: dict[str, np.ndarray] = {
            household: person_household,
            "person": np.arange(self.persons),
        }
        self.counts: dict[str, int] = {household: self.households, "person": self.persons}
        for entity in self.group_entities:
            # One or two units per household, people split in order.
            units = np.zeros(self.persons, dtype=int)
            next_unit = 0
            for h in range(self.households):
                members = np.flatnonzero(person_household == h)
                split = members.size > 1 and rng.random() < 0.4
                cut = members.size // 2 if split else members.size
                units[members[:cut]] = next_unit
                units[members[cut:]] = next_unit + 1 if split else next_unit
                next_unit += 2 if split else 1
            self.index[entity] = units
            self.counts[entity] = next_unit
        # Deciles 1-10, every decile populated; decile 10 rests on two households.
        decile = np.array([1 + (h % 9) for h in range(self.households)])
        decile[[0, 1]] = 10
        self.decile = decile
        # Clones share a source household: mostly two households to a source.
        source = np.arange(self.households) // 2
        source[[0, 1]] = [1000, 1001]
        self.source_ids = source
        self.ids = {entity: 10 * (np.arange(count) + 1) for entity, count in self.counts.items()}
        self.weights = {
            entity: rng.uniform(50, 150, size=count) for entity, count in self.counts.items()
        }
        self.native = self._native_entities()

    def _native_entities(self) -> dict[str, str]:
        spec = self.spec
        household = spec.household_entity
        native: dict[str, str] = {}
        for entity in self.counts:
            native[f"{entity}_id"] = entity
            native[spec.weight_variable(entity)] = entity
        for variable in spec.groups.values():
            if variable:
                native[variable] = "person"
        for item in spec.baseline:
            if item.where:
                native.setdefault(item.where, "person")
            for variable in item.variables:
                native.setdefault(variable, item.entity or household)
        return native

    def entity_of(self, variable: str) -> str:
        return self.native.get(variable, self.spec.household_entity)

    def map_values(self, values: np.ndarray, source: str, target: str) -> np.ndarray:
        """policyengine-core's rules: sum people into a group, project a group onto its
        people, and between groups divide among the people, then sum."""
        if source == target:
            return values
        if source == "person":
            return np.bincount(self.index[target], weights=values, minlength=self.counts[target])
        per_person = values[self.index[source]]
        if target == "person":
            return per_person
        sizes = np.bincount(self.index[source], minlength=self.counts[source])
        per_person = per_person / sizes[self.index[source]]
        return np.bincount(self.index[target], weights=per_person, minlength=self.counts[target])


@dataclass
class SyntheticSim:
    world: SyntheticWorld
    seed: str
    reform: Mapping[str, Mapping[str, Any]] | None
    closed: bool = False
    parameters: Any = field(default_factory=lambda: SyntheticParameter("root"))
    bundle: dict[str, Any] = field(
        default_factory=lambda: {"bundle_id": "synthetic", "capital_gains_responses": None}
    )

    def _moved(self, entity: str) -> np.ndarray:
        """The members of a reform-dependent fifth of households (none for the baseline)."""
        world = self.world
        if not self.reform:
            return np.zeros(world.counts[entity], dtype=bool)
        key = sorted(
            (path, sorted(map(str, values.items()))) for path, values in self.reform.items()
        )
        rng = np.random.default_rng(_seed("reform", key))
        households = rng.random(world.households) < 0.2
        household = world.spec.household_entity
        if entity == household:
            return households
        on_people = households[world.index[household]]
        if entity == "person":
            return on_people
        return (
            np.bincount(world.index[entity], weights=on_people, minlength=world.counts[entity]) > 0
        )

    def values(self, variable: str, period: int, map_to: str | None = None) -> np.ndarray:
        world, spec = self.world, self.world.spec
        entity = world.entity_of(variable)
        size = world.counts[entity]
        flags = set(spec.poverty.values()) | {v for v in spec.groups.values() if v}
        flags |= {item.where for item in spec.baseline if item.where}
        if variable == f"{entity}_id":
            values = world.ids[entity]
        elif variable == spec.weight_variable(entity):
            values = world.weights[entity]
        elif variable == spec.income_decile:
            values = world.decile
        elif variable in flags:
            rng = np.random.default_rng(_seed("flag", variable, period))
            values = rng.random(size) < 0.3
            values = values ^ (self._moved(entity) & (rng.random(size) < 0.5))
        else:
            rng = np.random.default_rng(_seed("amount", variable, period, self.seed))
            amounts = rng.gamma(2.0, 4000.0, size=size) * (rng.random(size) > 0.25)
            values = np.where(self._moved(entity), amounts * 1.05 + 10.0, amounts)
        return world.map_values(np.asarray(values), entity, map_to or entity)

    def entity_of(self, variable: str) -> str:
        return self.world.entity_of(variable)

    def variable_names(self) -> set[str]:
        return set(self.world.native)

    def close(self) -> None:
        self.closed = True


@dataclass
class SyntheticBackend:
    """Builds the synthetic world for one build (`seed`), under any reform."""

    world: SyntheticWorld
    seed: str
    builds: list[Any] = field(default_factory=list)

    def build(self, reform: Mapping[str, Mapping[str, Any]] | None) -> SyntheticSim:
        self.builds.append(reform)
        return SyntheticSim(self.world, self.seed, reform)

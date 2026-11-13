"""A small synthetic model world that maps values the way policyengine-core does,
and a fake release repository.

Four households, five benefit units, eight people, with made-up numbers. No
survey data: every value here is invented for the tests.

Mapping rules (policyengine-core's `map_result`):
- person -> group: sum over members;
- group -> person: project the group's value onto each member;
- group -> group: divide among the source group's people, then sum.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from release_history.releases import ReleaseRefused

HOUSEHOLD_IDS = np.array([10, 20, 30, 40])
BENUNIT_IDS = np.array([1, 2, 3, 4, 5])
PERSON_HOUSEHOLD = np.array([10, 10, 10, 20, 20, 30, 40, 40])
PERSON_BENUNIT = np.array([1, 1, 2, 3, 3, 4, 5, 5])
GROUP_MEMBERS = {"household": PERSON_HOUSEHOLD, "benunit": PERSON_BENUNIT}
GROUP_IDS = {"household": HOUSEHOLD_IDS, "benunit": BENUNIT_IDS}


class FakeParameter:
    def __init__(self, value: float) -> None:
        self.value = value
        self.values_list = [value]

    def __call__(self, instant: str) -> float:
        return self.value


class FakeBrackets:
    def __init__(self, rates: list[float]) -> None:
        self.brackets = [type("Bracket", (), {"rate": FakeParameter(r)})() for r in rates]


def fake_parameters() -> Any:
    tree = type("Node", (), {})()
    tree.gov = type("Node", (), {})()
    tree.gov.tax = type("Node", (), {})()
    tree.gov.tax.rate = FakeParameter(0.2)
    tree.gov.tax.rates = FakeBrackets([0.2, 0.4])
    tree.gov.benefit = type("Node", (), {})()
    tree.gov.benefit.amount = FakeParameter(100.0)
    return tree


def _project(entity: str, values: np.ndarray) -> np.ndarray:
    ids = GROUP_IDS[entity]
    index = np.searchsorted(ids, GROUP_MEMBERS[entity])
    return values[index]


def _sum_people(entity: str, values: np.ndarray) -> np.ndarray:
    ids = GROUP_IDS[entity]
    index = np.searchsorted(ids, GROUP_MEMBERS[entity])
    return np.bincount(index, weights=values, minlength=ids.size)


def map_values(values: np.ndarray, source: str, target: str) -> np.ndarray:
    if source == target:
        return values
    if source == "person":
        return _sum_people(target, values)
    if target == "person":
        return _project(source, values)
    sizes = _sum_people(source, np.ones(PERSON_HOUSEHOLD.size))
    per_person = _project(source, values / sizes)
    return _sum_people(target, per_person)


def baseline_world(rate: float = 0.2, benefit: float = 100.0) -> dict[str, tuple[str, np.ndarray]]:
    earnings = np.array([30_000, 10_000, 0, 50_000, 0, 5_000, 20_000, 0], dtype=float)
    income_tax = rate * earnings
    benefit_values = np.where(np.array([0, 1, 1, 0, 1]) == 1, benefit, 0.0)
    household_benefit = map_values(benefit_values, "benunit", "household")
    household_tax = map_values(income_tax, "person", "household")
    household_earnings = map_values(earnings, "person", "household")
    net = household_earnings - household_tax + household_benefit
    world: dict[str, tuple[str, np.ndarray]] = {
        "household_id": ("household", HOUSEHOLD_IDS.copy()),
        "benunit_id": ("benunit", BENUNIT_IDS.copy()),
        "person_id": ("person", np.arange(1, 9)),
        "household_weight": ("household", np.array([100.0, 200.0, 300.0, 400.0])),
        "benunit_weight": ("benunit", np.array([100.0, 100.0, 200.0, 300.0, 400.0])),
        "person_weight": ("person", _project("household", np.array([100.0, 200.0, 300.0, 400.0]))),
        "earnings": ("person", earnings),
        "income_tax": ("person", income_tax),
        "benefit": ("benunit", benefit_values),
        "gov_balance": ("household", household_tax - household_benefit),
        "net_income": ("household", net),
        "decile": ("household", np.array([3, 5, 1, 9])),
        "in_poverty": ("household", net < 12_000),
        "is_child": ("person", np.array([0, 0, 1, 0, 1, 0, 0, 1], dtype=bool)),
    }
    return world


@dataclass
class FakeSim:
    world: Mapping[str, tuple[str, np.ndarray]]
    parameters: Any = field(default_factory=fake_parameters)
    closed: bool = False

    def values(self, variable: str, period: int, map_to: str | None = None) -> np.ndarray:
        entity, values = self.world[variable]
        return map_values(np.asarray(values), entity, map_to or entity)

    def entity_of(self, variable: str) -> str:
        return self.world[variable][0]

    def variable_names(self) -> set[str]:
        return set(self.world)

    def close(self) -> None:
        self.closed = True


@dataclass
class FakeBackend:
    """Builds a world from a reform dict: `gov.tax.rate` and `gov.benefit.amount` move it."""

    builds: list[Any] = field(default_factory=list)
    fail_on: Callable[[Mapping[str, Any] | None], bool] | None = None

    def build(self, reform: Mapping[str, Mapping[str, Any]] | None) -> FakeSim:
        self.builds.append(reform)
        if self.fail_on and self.fail_on(reform):
            raise RuntimeError("synthetic failure")
        rate, benefit = 0.2, 100.0
        for path, values in (reform or {}).items():
            value = next(iter(values.values()))
            if path == "gov.tax.rate":
                rate = value
            if path == "gov.benefit.amount":
                benefit = value
        return FakeSim(baseline_world(rate, benefit))


def fake_spec_dict(**overrides: Any) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "schema_version": 1,
        "country": "zz",
        "release_repo": "policyengine/zz",
        "series": {"releases": ["zz-national"]},
        "engine": {"module": "zz", "model_package": "policyengine-zz"},
        "periods": [2026],
        "currency": "XXX",
        "variables": {
            "household_net_income": "net_income",
            "budget": {"plus": ["gov_balance"]},
            "income_decile": "decile",
            "poverty": {"poverty": "in_poverty"},
            "groups": {"all": None, "children": "is_child"},
        },
        "baseline": [
            {"id": "income_tax", "variable": "income_tax", "stat": "sum", "kind": "tax"},
            {"id": "benefit", "variable": "benefit", "stat": "sum", "kind": "benefit"},
            {
                "id": "benefit_caseload",
                "variable": "benefit",
                "stat": "count",
                "entity": "benunit",
                "kind": "caseload",
            },
            {"id": "households", "stat": "population", "entity": "household", "kind": "population"},
            {
                "id": "poverty_children",
                "variable": "in_poverty",
                "stat": "mean",
                "entity": "person",
                "where": "is_child",
                "kind": "rate",
            },
            {
                "id": "net_income_mean",
                "variable": "net_income",
                "stat": "mean",
                "entity": "household",
                "by": "income_decile",
                "unit": "currency",
            },
        ],
        "reforms": [
            {"id": "tax_up", "add": {"gov.tax.rate": 0.1}, "targets": ["income_tax"]},
            {"id": "benefit_up", "scale": {"gov.benefit.amount": 2.0}, "targets": ["benefit"]},
        ],
        "disclosure": {"policy": "none"},
    }
    spec.update(overrides)
    return spec


# ---------------------------------------------------------------------------
# A release repository at one commit, for the series and the measure command.

FAKE_COMMIT = "c" * 40


@dataclass
class FakeHub:
    """The `HubClient` calls the producer makes, answered from files held in memory."""

    files: dict[str, bytes] = field(default_factory=dict)
    commit: str = FAKE_COMMIT
    reads: list[str] = field(default_factory=list)

    def put_json(self, path: str, value: Any) -> None:
        self.files[path] = json.dumps(value, sort_keys=True).encode("utf-8")

    def _get(self, commit: str, path: str) -> bytes:
        if commit != self.commit:
            raise ReleaseRefused("error", "repository_or_revision_unreadable")
        if path not in self.files:
            raise FileNotFoundError(path)
        self.reads.append(path)
        return self.files[path]

    def resolve_revision(self, repo: str, revision: str) -> str:
        return self.commit

    def read_json(self, repo: str, commit: str, path: str, directory: Path) -> tuple[Any, str]:
        data = self._get(commit, path)
        return json.loads(data), hashlib.sha256(data).hexdigest()

    def file_size(self, repo: str, commit: str, path: str) -> int | None:
        return len(self.files[path]) if path in self.files else None

    def download(self, repo: str, commit: str, path: str, directory: Path) -> Path:
        local = Path(directory) / path
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(self._get(commit, path))
        return local


def release_manifest(
    sha256: str,
    *,
    path: str = "zz.h5",
    national: bool = True,
    model: str = "policyengine-zz",
) -> dict[str, Any]:
    """A build folder's release_manifest.json naming one national file (or none)."""
    if not national:
        return {"dataset_role": "non_default_local_area", "default_datasets": {}, "artifacts": {}}
    return {
        "default_datasets": {"national": "national"},
        "artifacts": {"national": {"kind": "microdata", "path": path, "sha256": sha256}},
        "built_at": "2026-11-01T00:00:00+00:00",
        "compatible_model_packages": [{"name": model, "specifier": ">=1"}],
    }


def release_repo(
    lines: Mapping[str, Mapping[str, Mapping[str, Any]]],
    *,
    current: Mapping[str, str] | None = None,
    default: str | None = None,
    roles: Mapping[str, str] | None = None,
) -> FakeHub:
    """A repository with `releases.json` and one folder per build.

    `lines` maps each release line to its builds; a build's entry takes
    `published_at`, `withdrawn`, and `sha256` (its national file) or
    `manifest` (a whole release manifest, or None for a missing one).
    """
    hub = FakeHub()
    record: dict[str, Any] = {"schema_version": 1, "default": default, "releases": {}}
    for line, builds in lines.items():
        record["releases"][line] = {
            "role": (roles or {}).get(line, "national"),
            "current": (current or {}).get(line),
            "builds": {
                build: {
                    "published_at": facts["published_at"],
                    "withdrawn": bool(facts.get("withdrawn")),
                }
                for build, facts in builds.items()
            },
        }
        for build, facts in builds.items():
            manifest = (
                facts["manifest"] if "manifest" in facts else release_manifest(facts["sha256"])
            )
            if manifest is not None:
                hub.put_json(f"releases/{line}/{build}/release_manifest.json", manifest)
    hub.put_json("releases.json", record)
    return hub


# The release repository the shared fixtures are made from (tests/fixtures/series.json, and the
# measurement of its first file in tests/fixtures/measurement.json).
FIXTURE_LINE = "zz-national"
FIXTURE_FILES = ("1" * 64, "2" * 64, "3" * 64)
FIXTURE_SINCE = "2026-10-25"


def fixture_repo() -> FakeHub:
    """Six builds on the series line and one on another line, with every listing case: a build
    before `since`, one file under two builds, a current build, a withdrawn build, and a
    build without a release manifest."""
    first, second, third = FIXTURE_FILES
    return release_repo(
        {
            FIXTURE_LINE: {
                "zz-build-20261020": {
                    "published_at": "2026-10-20T09:00:00+00:00",
                    "sha256": "0" * 64,
                },
                "zz-build-20261101": {"published_at": "2026-11-01T09:00:00+00:00", "sha256": first},
                "zz-build-20261103": {"published_at": "2026-11-03T09:00:00+00:00", "sha256": first},
                "zz-build-20261105": {
                    "published_at": "2026-11-05T09:00:00+00:00",
                    "sha256": second,
                },
                "zz-build-20261107": {
                    "published_at": "2026-11-07T09:00:00+00:00",
                    "sha256": third,
                    "withdrawn": True,
                },
                "zz-build-20261109": {
                    "published_at": "2026-11-09T09:00:00+00:00",
                    "manifest": None,
                },
            },
            "zz-local": {
                "zz-local-1": {
                    "published_at": "2026-11-02T09:00:00+00:00",
                    "manifest": release_manifest("", national=False),
                }
            },
        },
        current={FIXTURE_LINE: "zz-build-20261105", "zz-local": "zz-local-1"},
        default=FIXTURE_LINE,
        roles={"zz-local": "local_area"},
    )


def fixture_series_spec_dict(**overrides: Any) -> dict[str, Any]:
    return fake_spec_dict(
        **{"series": {"releases": [FIXTURE_LINE], "since": FIXTURE_SINCE}, **overrides}
    )

"""The documents the producer writes and reads, as types: one per schema in `schemas/`.

Each TypedDict lists the keys its schema requires, nested the same way, and
`tests/test_documents.py` checks that the two never drift apart. Values copied
as they are from upstream manifests, and maps keyed by reform ids, stay open
(`JsonValue`).
"""

# No `from __future__ import annotations`: TypedDict reads `NotRequired` only from
# evaluated annotations, so every class here is defined before it is used.
from typing import Literal, NotRequired, TypedDict

type JsonValue = None | bool | int | float | str | list[JsonValue] | dict[str, JsonValue]

type Compatibility = Literal["inside", "outside", "undeclared", "unreadable"]
type CellUnit = Literal["currency", "count", "rate", "ratio"]
type LimitName = Literal["dataset", "memory", "seconds"]
type DisclosurePolicy = Literal["none", "source_household_small_cells"]


# ---------------------------------------------------------------------------
# The point (`schemas/point.schema.json`)


class ReleaseManifestFacts(TypedDict):
    path: str
    sha256: str
    json_sha256: str


class BuildManifestFacts(TypedDict):
    path: str
    sha256: str


class DatasetFacts(TypedDict):
    key: str
    path: str


class BuildProvenance(TypedDict):
    code_repository: str | None
    code_commit: str | None
    attempt_id: str | None
    target_surface_sha256: str | None
    n_targets: int | None
    target_registry_version: JsonValue
    household_weight_year: JsonValue
    runtime: JsonValue


class DeclaredFacts(TypedDict):
    """What the build the file was fetched through declares about it."""

    build: str | None
    cut_tag: str | None
    migrated_from: JsonValue
    built_at: str | None
    built_with_model: JsonValue
    built_with_core: JsonValue
    compatible_models: JsonValue
    reference_model_compatibility: Compatibility
    description: str | None
    build_provenance: BuildProvenance | None


class FetchedFrom(TypedDict):
    build_id: str
    hf_repo: str
    hf_commit: str | None
    release_manifest: ReleaseManifestFacts
    build_manifest: BuildManifestFacts | None
    dataset: DatasetFacts
    declared: DeclaredFacts


class FileFacts(TypedDict):
    sha256: str
    bytes: int | None


class Provenance(TypedDict):
    """The file, and where it was fetched from: what `releases.point_provenance` gives."""

    fetched_from: FetchedFrom
    file: FileFacts


class DataFacts(TypedDict):
    columns_sha256: str
    column_count: int
    unknown_columns: list[str]
    warnings: list[str]


class PeriodLabel(TypedDict):
    period: int
    label: str


class BaselineStatus(TypedDict):
    status: str


# `class` is a keyword, so this one is declared the functional way.
ReformError = TypedDict(
    "ReformError", {"stage": str, "class": str, "name": str | None, "where": str | None}
)


class ReformRecord(TypedDict):
    status: Literal["ok", "error"]
    definition_sha256: str | None
    applied: dict[str, JsonValue] | None
    error: ReformError | None


class CellDocument(TypedDict):
    output: str
    period: int
    unit: CellUnit
    value: float | None
    status: Literal["ok", "withheld"]
    reason: str | None


class DisclosureFacts(TypedDict):
    policy: DisclosurePolicy
    min_source_households: int
    withheld_cells: int | None


class EngineBundle(TypedDict):
    bundle_id: str | None
    capital_gains_responses: JsonValue


class Environment(TypedDict):
    python: str
    platform: str
    packages: list[str]
    packages_sha256: str
    uv_lock_sha256: str | None


class ProducerFacts(TypedDict):
    version: str
    commit: str | None


class SimulationRecord(TypedDict):
    label: str
    seconds: float
    peak_rss_bytes: int


class RunnerLimits(TypedDict):
    seconds: int | None
    memory_bytes: int | None
    dataset_bytes: int | None
    warn_at: float


class NearLimit(TypedDict):
    limit: LimitName
    share: float


class Runtime(TypedDict):
    started_at: str | None
    finished_at: str | None
    seconds: float | None
    runner: str | None
    simulations: list[SimulationRecord]
    limits: RunnerLimits
    near_limits: list[NearLimit]


class PointDocument(TypedDict):
    format_version: int
    kind: Literal["release_history.measurement"]
    country: str
    panel_id: str
    measurement_id: str
    status: Literal["ok", "partial", "refused"]
    reason: str | None
    fetched_from: FetchedFrom
    file: FileFacts
    data: DataFacts | None
    periods: list[PeriodLabel]
    baseline: BaselineStatus | None
    reforms: dict[str, ReformRecord] | None
    cells: list[CellDocument]
    disclosure: DisclosureFacts
    engine_bundle: EngineBundle | None
    environment: Environment
    producer: ProducerFacts
    runtime: Runtime


# ---------------------------------------------------------------------------
# The panel (`schemas/panel.schema.json`)


class PanelKey(TypedDict):
    country: str
    policyengine: str
    model: str
    core: str
    producer_version: str
    point_format_version: int
    spec_sha256: str


class ModelPin(TypedDict):
    name: str
    version: str
    wheel_sha256: str | None


class CorePin(TypedDict):
    name: str
    version: str


class EngineIdentity(TypedDict):
    policyengine: str
    bundle_sha256: str
    model: ModelPin
    core: CorePin


class PanelDocument(TypedDict):
    format_version: int
    kind: Literal["release_history.panel"]
    panel_id: str
    panel_key: PanelKey
    digest_algorithm: str
    country: str
    engine: EngineIdentity
    producer_version: str
    point_format_version: int
    spec_sha256: str
    definition: dict[str, JsonValue]


# ---------------------------------------------------------------------------
# The series record (`schemas/series.schema.json`)


class SeriesRule(TypedDict):
    releases: list[str]
    since: str | None


class RecordFacts(TypedDict):
    present: bool
    sha256: str | None
    default: str | None


class SeriesLine(TypedDict):
    release: str
    present: bool
    role: str | None


class SeriesBuild(TypedDict):
    build_id: str
    release: str
    build: str
    release_directory: str
    published_at: str
    withdrawn: bool
    current: bool
    in_default_release: bool
    role: str | None
    digest: str | None
    dataset_path: str | None
    release_manifest_sha256: str | None
    listing_status: Literal["ok", "refused"]
    listing_reason: str | None


class SeriesRecord(TypedDict):
    format_version: int
    kind: Literal["release_history.series"]
    country: str
    release_repo: str
    rule: SeriesRule
    revision: str
    commit: str
    listed_at: str
    record: RecordFacts
    lines: list[SeriesLine]
    builds: list[SeriesBuild]


# ---------------------------------------------------------------------------
# Labels, attempt reports and planned points (`labels`, `attempt`, `planned-point`)


class ReformLabel(TypedDict):
    label: str | None
    source: dict[str, JsonValue] | None


class LabelsDocument(TypedDict):
    format_version: int
    kind: Literal["release_history.labels"]
    country: str
    reforms: dict[str, ReformLabel]


class AttemptReportDocument(TypedDict):
    format_version: int
    kind: Literal["release_history.attempt"]
    country: str
    panel_id: str
    digest: str
    build_id: str
    attempt: int
    last_attempt: bool
    status: Literal["interrupted", "failed"]
    stage: str
    reason: str
    error_class: str | None
    at: str
    producer: ProducerFacts


class PlannedPointDocument(TypedDict):
    build_id: str
    release_directory: str
    hf_repo: str
    hf_commit: str
    digest: str
    attempt: int
    last_attempt: bool


# ---------------------------------------------------------------------------
# The timeline (`schemas/timeline.schema.json`), written by the TypeScript side


class TimelineRule(TypedDict):
    releases: list[str]
    since: str | None


class TimelineListing(TypedDict):
    commit: str
    listedAt: str  # noqa: N815 - the TypeScript side's camelCase keys
    rule: TimelineRule


class TimelineLabel(TypedDict):
    label: str | None
    source: JsonValue


class TimelineDeclared(TypedDict):
    """What the build a point was fetched through declares about its file, as the timeline
    copies it from the point's `fetched_from.declared`."""

    fetchedThrough: str  # noqa: N815
    builtAt: str | None  # noqa: N815
    builtWithModel: JsonValue  # noqa: N815
    builtWithCore: JsonValue  # noqa: N815
    compatibleModels: JsonValue  # noqa: N815
    codeRepository: str | None  # noqa: N815
    codeCommit: str | None  # noqa: N815
    targetSurfaceSha256: str | None  # noqa: N815
    nTargets: int | None  # noqa: N815
    targetRegistryVersion: JsonValue  # noqa: N815
    householdWeightYear: JsonValue  # noqa: N815


class TimelineBuild(TypedDict):
    buildId: str  # noqa: N815
    release: str
    build: str
    publishedAt: str  # noqa: N815
    current: bool
    withdrawn: bool
    digest: str
    sameFileAs: str | None  # noqa: N815
    state: Literal["measured", "gap", "retrying", "failed", "missing"]
    measurementId: str | None  # noqa: N815
    status: Literal["ok", "partial", "refused"] | None
    reason: str | None
    referenceModelCompatibility: Compatibility | None  # noqa: N815
    unknownColumns: list[str] | None  # noqa: N815
    # Added after the first timelines were written, so a stored timeline may lack it.
    declared: NotRequired[TimelineDeclared | None]


class TimelineReference(TypedDict):
    """The official figure; the schema leaves the rest of the entry open."""

    status: Literal["resolved", "citation", "none"]
    modelSignValue: NotRequired[float]  # noqa: N815
    value: NotRequired[float]
    basis: NotRequired[str | None]


class TimelineValue(TypedDict):
    buildId: str  # noqa: N815
    value: float | None
    status: Literal["ok", "withheld", "missing", "unmeasured"]
    comparedWith: str | None  # noqa: N815
    change: float | None
    relativeChange: float | None  # noqa: N815
    changePoints: float | None  # noqa: N815
    changeStatus: Literal["ok", "withheld", "none"]  # noqa: N815


class TimelineOutput(TypedDict):
    output: str
    period: int
    unit: CellUnit
    reference: TimelineReference | None
    values: list[TimelineValue]


class TimelineDocument(TypedDict):
    formatVersion: int  # noqa: N815
    kind: Literal["release_history.timeline"]
    country: str
    panelId: str  # noqa: N815
    builtAt: str  # noqa: N815
    listing: TimelineListing
    labels: dict[str, TimelineLabel]
    builds: list[TimelineBuild]
    outputs: list[TimelineOutput]
    chronicle: dict[str, JsonValue] | None

"""Pydantic schemas for the stable diagnostics API."""

from pydantic import BaseModel, Field


class DatasetItem(BaseModel):
    dataset_id: str
    label: str
    repo_id: str
    repo_type: str
    layout: str
    primary_h5: str


class DatasetListResponse(BaseModel):
    items: list[DatasetItem]


class RunItem(BaseModel):
    dataset_id: str
    run_id: str
    label: str
    last_modified: str | None = None


class RunListResponse(BaseModel):
    dataset_id: str
    items: list[RunItem]


class BundleItem(BaseModel):
    bundle: str
    kind: str
    geography_id: str | None = None
    geography_name: str | None = None
    target_count: int | None = None
    included_target_count: int | None = None
    cache_status: str | None = None


class BundleListResponse(BaseModel):
    dataset_id: str
    run_id: str
    items: list[BundleItem]


class ProvenanceInfo(BaseModel):
    target_db: str
    diagnostics: str | None = None
    aggregate_source: str
    calibration_pattern_source: str | None = None


class SummaryMetrics(BaseModel):
    median_abs_rel_error: float | None = None
    mean_abs_rel_error: float | None = None
    p95_abs_rel_error: float | None = None
    total_loss: float | None = None


class SummaryResponse(BaseModel):
    dataset_id: str
    run_id: str
    bundle: str
    target_universe_count: int
    included_target_count: int
    computed_target_count: int
    loss_contribution_available: bool
    metrics: SummaryMetrics
    provenance: ProvenanceInfo


class TargetItem(BaseModel):
    target_id: int | None = None
    target_name: str
    variable: str
    geo_level: str | None = None
    geographic_id: str | None = None
    target_value: float | None = None
    pe_aggregate: float | None = None
    rel_error: float | None = None
    abs_rel_error: float | None = None
    included_in_loss: bool
    loss_contribution: float | None = None
    computed_from_bundle: str | None = None
    target_value_source: str
    included_source: str | None = None
    calibration_pattern_source: str | None = None
    eval_note: str | None = None


class TargetListResponse(BaseModel):
    dataset_id: str
    run_id: str
    bundle: str
    items: list[TargetItem]
    total: int
    offset: int
    limit: int


class EvaluationFilters(BaseModel):
    geo_level: list[str] | None = None
    state_fips: list[int] | None = None
    geographic_id: str | None = None
    variable: list[str] | None = None
    source: list[str] | None = None
    included: bool | None = None
    min_abs_rel_error: float | None = None


class EvaluationRequest(BaseModel):
    dataset_id: str
    run_id: str
    bundle: str | None = None
    filters: EvaluationFilters = Field(default_factory=EvaluationFilters)
    limit: int = 5000


class EvaluationResult(BaseModel):
    target_count: int
    computed_target_count: int
    items_url: str


class EvaluationResponse(BaseModel):
    status: str
    cache_status: str
    elapsed_ms: float
    result: EvaluationResult

"""Pydantic request/response schemas."""

from pydantic import BaseModel


class TargetRow(BaseModel):
    target_idx: int
    target_id: int | None = None
    variable: str
    geo_level: str | None = None
    geographic_id: str | None = None
    geo_display_name: str | None = None
    domain: str | None = None
    additional_constraints: str | None = None
    target_value: float
    estimate: float
    rel_error: float
    abs_rel_error: float
    loss_contribution: float
    n_contributors: int
    included: bool = True


class TargetListResponse(BaseModel):
    items: list[TargetRow]
    total: int
    offset: int
    limit: int


class ErrorDecomposition(BaseModel):
    target_name: str
    target_value: float
    raw_sum: float
    initial_estimate: float
    final_estimate: float
    diagnosis: str
    concentration: dict


class ProvenanceResponse(BaseModel):
    target_id: int | None = None
    variable: str
    value: float | None = None
    period: int | None = None
    source: str | None = None
    tolerance: float | None = None
    notes: str | None = None
    active: bool | None = None
    stratum_id: int | None = None
    constraints: list[dict] = []
    geo_level: str | None = None
    geographic_id: str | None = None
    uprating_factor: float | None = None
    uprated_value: float | None = None


class EligibilityAuditResponse(BaseModel):
    target_name: str
    total_contributors: int
    meet_criterion: int
    fail_criterion: int
    pct_failing: float
    weighted_contribution_from_failing: float
    pct_estimate_from_failing: float
    diagnosis: str


class ConstraintCheck(BaseModel):
    variable: str
    operation: str
    value: str
    contributors_satisfying: int
    contributors_violating: int
    pct_violating: float
    status: str


class ConstraintDiffResponse(BaseModel):
    target_name: str
    stratum_id: int
    constraints: list[ConstraintCheck]


class ContributorRow(BaseModel):
    household_idx: int
    raw_value: float
    weighted_value: float
    income: float | None = None
    g_weight: float | None = None
    in_poverty: bool | None = None
    state: int | None = None


class HouseholdRow(BaseModel):
    household_idx: int
    income: float
    spm_threshold: float
    in_poverty: bool
    initial_weight: float
    final_weight: float
    g_weight: float
    state: int
    income_decile: int
    filter_variable_value: float | None = None


class HouseholdProfile(BaseModel):
    household_idx: int
    initial_weight: float
    final_weight: float
    g_weight: float
    in_poverty: bool
    state: int
    cd_geoid: int
    variables: dict[str, float]


class AttributionRow(BaseModel):
    target_idx: int
    target_name: str
    variable: str | None = None
    geo_level: str | None = None
    raw_value: float
    weighted_value: float
    target_rel_error: float


class WeightSlice(BaseModel):
    label: str
    n: int
    kish_effective_n: float
    mean: float
    median: float


class WeightDistribution(BaseModel):
    kish_effective_n: float
    cv: float
    design_effect: float
    mean: float
    median: float
    p5: float
    p25: float
    p75: float
    p95: float
    max: float
    top_1pct_weight_share: float
    top_5pct_weight_share: float
    slices: list[WeightSlice] = []


class HistogramBin(BaseModel):
    bin_min: float
    bin_max: float
    count: int


class PovertyRateResponse(BaseModel):
    spm_poverty_rate: float
    spm_poverty_rate_initial_weights: float
    n_poor_weighted: float
    n_total_weighted_households: float
    n_total_weighted_individuals: float
    benchmark_census: float


class IncomeQuantiles(BaseModel):
    p5: float
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    p95: float


class IncomeDistributionResponse(BaseModel):
    initial_weights: IncomeQuantiles
    final_weights: IncomeQuantiles


class DecomposeRequest(BaseModel):
    variable: str
    subgroup: str | None = None


class DecomposeComponent(BaseModel):
    variable: str
    initial_total: float
    final_total: float
    shift_pct: float


class DecomposeResponse(BaseModel):
    components: list[DecomposeComponent]
    composite_initial: float | None = None
    composite_final: float | None = None


class ConvergencePoint(BaseModel):
    epoch: int
    estimate: float
    target: float
    rel_error: float
    loss: float


class EpochSummaryRow(BaseModel):
    group: str
    epoch: int
    mean_abs_rel_error: float


class StratumDetail(BaseModel):
    stratum_id: int
    parent_stratum_id: int | None = None
    notes: str | None = None
    constraints: list[dict] = []
    children: list[dict] = []
    targets: list[dict] = []

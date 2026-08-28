// Pure-HF data layer for the country-selectable Microcosm dashboard. No
// committed snapshot: every release's manifests and per-target calibration
// diagnostics are read live from its country's Hugging Face dataset, resolved
// through latest.json (current release) or by id (version compare).

import { sourceAuthorityLabel } from "@/lib/source-labels";

import { normalizeChronicleMetadata } from "./chronicle-metadata";
import {
  chroniclePublisherFromMetadata,
  qualifyingChildrenFromRecordSet,
  readLegacyTarget,
  stateFromGeoId,
  type ParsedLegacyTarget,
} from "./legacy-target-reader";
import {
  COUNTRY_REGISTRY,
  DEFAULT_COUNTRY,
  countryRegistration,
  isCountry,
  isCountryCapability,
  parseCountry,
  type CountryCapability,
  type MicrocosmCountry,
  type RepositoryVisibility,
} from "./countries";
import {
  normalizeTargetLossAttribution,
  targetLossAttributionSummary,
  type FinalTargetLossAttribution,
  type TargetLossDiagnosticWarning,
} from "./target-loss-attribution";
import {
  classifyTargetRepresentation,
  type TargetRepresentation,
} from "./target-representation";
import { readStructuredTarget } from "./structured-target-reader";

// The registry is the registration point; these re-exports keep the server
// modules and routes that import country helpers from here working.
export { isCountry, parseCountry, type MicrocosmCountry };

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;
export type CalibrationLossKind = "normalized_target_loss" | "raw_optimizer_objective";

const DEFAULT_GEOGRAPHY = countryRegistration(DEFAULT_COUNTRY).geography;
const DEFAULT_GEOGRAPHY_LEVEL = "national";

// Deprecated upstream identifiers: Microcosm's published HF repositories and
// deployment variables still use the former Populace names. The names live on
// each country's registration; they are re-exported here for deployment docs
// and tests.
export const MICROCOSM_HF_REPO_ENV = COUNTRY_REGISTRY.us.repo_env;
export const MICROCOSM_HF_REVISION_ENV = COUNTRY_REGISTRY.us.revision_env;
export const MICROCOSM_UK_HF_REPO_ENV = COUNTRY_REGISTRY.uk.repo_env;
export const MICROCOSM_UK_HF_REVISION_ENV = COUNTRY_REGISTRY.uk.revision_env;
export const MICROCOSM_BE_HF_REPO_ENV = COUNTRY_REGISTRY.be.repo_env;
export const MICROCOSM_BE_HF_REVISION_ENV = COUNTRY_REGISTRY.be.revision_env;

interface MicrocosmCountryRepository {
  repo: string;
  revision: string;
  geography: string;
}

function envOverride(name: string | undefined): string | undefined {
  return name == null ? undefined : process.env[name];
}

// Server-side view of a registration: the registry defaults with this
// deployment's repository/revision overrides applied. Keep the national
// geography beside the repository so downstream shaping does not require a
// second exhaustive country table.
function resolveCountryRepository(country: MicrocosmCountry): MicrocosmCountryRepository {
  const registration = countryRegistration(country);
  return {
    repo: envOverride(registration.repo_env) ?? registration.repo,
    revision: envOverride(registration.revision_env) ?? registration.revision,
    geography: registration.geography,
  };
}

export const COUNTRY_REPO = Object.fromEntries(
  (Object.keys(COUNTRY_REGISTRY) as MicrocosmCountry[]).map((country) => [
    country,
    resolveCountryRepository(country),
  ]),
) as Record<MicrocosmCountry, MicrocosmCountryRepository>;

export const MICROCOSM_HF_REPO = COUNTRY_REPO.us.repo;
export const MICROCOSM_HF_REVISION = COUNTRY_REPO.us.revision;

// Release/run ids are interpolated into HuggingFace URLs that carry the
// server's HF token, so an unvalidated id ("../../..") could redirect the
// authenticated request to arbitrary paths after URL normalization. Every id
// that reaches a URL path segment must pass this allowlist first. "latest" is
// the one non-id sentinel callers may pass.
const RELEASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class InvalidReleaseIdError extends Error {}

export function assertSafeReleaseId(id: string, label = "release"): string {
  if (id === "latest" || id === "") return id;
  if (!RELEASE_ID_RE.test(id)) {
    throw new InvalidReleaseIdError(`Invalid ${label} id`);
  }
  return id;
}

// Route catch → HTTP: a bad id is the caller's fault (400); anything else is
// an upstream/HF failure (502). Keeps status semantics consistent across routes.
export function classifyApiError(error: unknown): { status: number; body: { detail: string } } {
  if (error instanceof InvalidReleaseIdError) {
    return { status: 400, body: { detail: error.message } };
  }
  return {
    status: 502,
    body: { detail: error instanceof Error ? error.message : String(error) },
  };
}

export function microcosmRepo(country: MicrocosmCountry): string {
  return COUNTRY_REPO[country].repo;
}

export function microcosmRevision(country: MicrocosmCountry): string {
  return COUNTRY_REPO[country].revision;
}

export function microcosmCountryGeography(country: MicrocosmCountry): string {
  return COUNTRY_REPO[country].geography;
}

function hfAuthHeaders(): HeadersInit | undefined {
  const token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

const FILING_MODIFIERS = new Set(["Surviving Spouse"]);
const FILING_STATUSES = new Set([
  "All", "Single", "Head of Household", "Married Filing Jointly",
  "Married Filing Separately", "Surviving Spouse",
]);
const RETURN_TYPES = new Set(["taxable", "all returns", "nontaxable"]);
const MEASURES = new Set(["total", "count", "mean", "filers", "nonfilers"]);
const QUALIFYING_CHILDREN = new Set([
  "all children",
  "no children",
  "no qualifying children",
  "one child",
  "one qualifying child",
  "two children",
  "two qualifying children",
  "three or more children",
  "three or more qualifying children",
]);

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([k, v]) => [k, scrub(v)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function calibrationLossKind(
  diag: JsonObject,
  buildManifest: JsonObject,
): CalibrationLossKind {
  const options = asObject(diag.options);
  const diagnosticsBuild = asObject(diag.build);
  if (
    (numberOrNull(diag.schema_version) != null &&
      Number(diag.schema_version) >= 6) ||
    diag.target_loss_basis != null ||
    options.target_loss_scales != null ||
    options.target_loss_weights != null ||
    diagnosticsBuild.target_loss_weighting != null ||
    diagnosticsBuild.target_loss_cap != null ||
    buildManifest.target_loss_weighting != null ||
    buildManifest.target_loss_cap != null
  ) {
    return "normalized_target_loss";
  }
  return "raw_optimizer_objective";
}

// A zero benchmark is a structural zero, not an epsilon denominator. Numerical
// noise at or below this tolerance is an exact fit; any substantive nonzero
// estimate is the maximum 100% error used by the Chronicle harness.
const ZERO_BENCHMARK_ABSOLUTE_TOLERANCE = 1e-4;

function relativeError(estimate: number | null, target: number | null): number | null {
  if (estimate == null || target == null) return null;
  if (target === 0) {
    if (Math.abs(estimate) <= ZERO_BENCHMARK_ABSOLUTE_TOLERANCE) return 0;
    return estimate < 0 ? -1 : 1;
  }
  return (estimate - target) / Math.abs(target);
}

type ParsedTarget = ParsedLegacyTarget;

interface TargetBreakdownDimension {
  key: string;
  label: string;
  value: string;
  source_key?: string;
  raw_value?: string;
  rank?: number;
}

interface ChronicleFilter {
  key: string;
  label: string;
  value: string;
  raw_value?: string;
}

interface ChronicleFactFields {
  fact_key: string | null;
  source_record_id: string | null;
  semantic_fact_key: string | null;
  aggregate_fact_key: string | null;
  legacy_fact_key: string | null;
  period_type: string | null;
  source_period: string | null;
  target_period: string | null;
  geography_level: string | null;
  geography_id: string | null;
  geography_vintage: string | null;
  domain: string | null;
  entity_name: string | null;
  entity_role: string | null;
  measure_concept: string | null;
  source_concept: string | null;
  concept_relation: string | null;
  concept_authority: string | null;
  measure_unit: string | null;
  value_operation: string | null;
  layout_record_set_id: string | null;
  layout_groupby_dimension: string | null;
  layout_groupby_value_id: string | null;
  layout_measure_id: string | null;
  dimension_set_key: string | null;
  universe_constraint_set_key: string | null;
  universe_constraint_count: number | null;
  filters: ChronicleFilter[];
}

// Deprecated upstream identifiers: Microcosm calibration diagnostics still
// serialize Chronicle provenance with the former `ledger_*` metadata prefix.

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readableToken(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ");
}

function titleCase(value: string): string {
  return value
    .replace(/[_:./#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function dimensionKey(label: string): string {
  return `bd_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
}

function addDimension(
  dimensions: TargetBreakdownDimension[],
  label: string,
  value: string | null,
  sourceKey?: string,
  rawValue?: string | null,
) {
  if (!value) return;
  const normalized = value.trim();
  if (!normalized) return;
  const key = dimensionKey(label);
  if (dimensions.some((dim) => dim.key === key && dim.value === normalized)) return;
  dimensions.push({
    key,
    label,
    value: normalized,
    source_key: sourceKey,
    raw_value: rawValue ?? undefined,
  });
}

function qualifyingChildrenFromCount(value: string | null): string | null {
  if (value == null) return null;
  if (value === "0") return "no qualifying children";
  if (value === "1") return "one qualifying child";
  if (value === "2") return "two qualifying children";
  if (value === "3" || value === "3+" || value === "3plus") {
    return "three or more qualifying children";
  }
  return readableToken(value);
}

function qualifyingChildrenFromSourceMeasure(variable: string | null, value: string | null): string | null {
  if (variable !== "eitc" || !value) return null;
  if (/^eitc_(amount|claims|returns|total)$/.test(value)) return "all qualifying children";
  if (/^eitc_no_children_/.test(value)) return "no qualifying children";
  if (/^eitc_one_child_/.test(value)) return "one qualifying child";
  if (/^eitc_two_children_/.test(value)) return "two qualifying children";
  if (/^eitc_three_or_more_children_/.test(value)) {
    return "three or more qualifying children";
  }
  return null;
}

function measureFromName(value: string | null): string | null {
  if (!value) return null;
  if (/_amount$|_total$|_collections$|_projected_amount$/.test(value)) return "total";
  if (/_returns$|_claims$|_count$/.test(value)) return "count";
  return null;
}

function measureFromMetadata(metadata: JsonObject): string | null {
  const sourceMeasure = stringValue(metadata.source_measure_id);
  const namedMeasure = measureFromName(sourceMeasure);
  if (namedMeasure) return namedMeasure;
  const unit = stringValue(metadata.ledger_measure_unit);
  if (stringValue(metadata.count) === "true" || unit === "count") return "count";
  if (unit === "usd") return "total";
  return null;
}

function dimensionLabel(value: string | null): string {
  if (!value) return "Breakdown";
  if (value === "us:statutes/26/62#adjusted_gross_income") return "Income band";
  if (value === "census_stc.item") return "Item";
  if (value === "hhs_acf_tanf.spending_category") return "Spending category";
  if (value.startsWith("cms_medicaid.")) return titleCase(value.replace(/^cms_medicaid\./, ""));
  const hash = value.split("#").at(-1);
  const last = hash?.split(".").at(-1) ?? value;
  return titleCase(last);
}

function filterDimensionLabel(key: string): string {
  const suffix = key.replace(/^ledger_filter_/, "");
  if (suffix === "income_range") return "Income band";
  if (suffix === "filing_status") return "Filing status";
  if (suffix === "eitc_child_count") return "Qualifying children";
  return dimensionLabel(suffix);
}

function isGeographyLayoutDimension(value: string | null): boolean {
  return [
    "geography",
    "state",
    "cms_medicaid.state_abbreviation",
  ].includes(value ?? "");
}

function isRedundantGeographyValue(metadata: JsonObject, value: string | null): boolean {
  if (!value) return false;
  const geography = stateFromGeoId(stringValue(metadata.ledger_geography_id));
  return Boolean(geography && value.toLowerCase() === geography.toLowerCase());
}

function readableDimensionValue(value: string | null): string | null {
  if (!value) return null;
  if (value === "all") return "All";
  if (value === "total") return "Total";
  return readableToken(value);
}

function readableFilterValue(key: string, value: string | null): string | null {
  if (key === "ledger_filter_eitc_child_count") {
    return qualifyingChildrenFromCount(value);
  }
  return readableDimensionValue(value);
}

function chronicleFilters(metadata: JsonObject): ChronicleFilter[] {
  return Object.entries(metadata)
    .filter(([key, raw]) => key.startsWith("ledger_filter_") && stringValue(raw))
    .map(([key, raw]) => {
      const rawValue = stringValue(raw)!;
      return {
        key,
        label: filterDimensionLabel(key),
        value: readableFilterValue(key, rawValue) ?? rawValue,
        raw_value: rawValue,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

function chronicleFactFields(metadata: JsonObject): ChronicleFactFields {
  return {
    fact_key: stringValue(metadata.ledger_fact_key),
    source_record_id: stringValue(metadata.ledger_source_record_id),
    semantic_fact_key: stringValue(metadata.ledger_semantic_fact_key),
    aggregate_fact_key: stringValue(metadata.ledger_aggregate_fact_key),
    legacy_fact_key: stringValue(metadata.ledger_legacy_fact_key),
    period_type: stringValue(metadata.ledger_period_type),
    source_period: stringValue(metadata.source_period),
    target_period: stringValue(metadata.target_period),
    geography_level: stringValue(metadata.ledger_geography_level),
    geography_id: stringValue(metadata.ledger_geography_id),
    geography_vintage: stringValue(metadata.ledger_geography_vintage),
    domain: stringValue(metadata.ledger_domain),
    entity_name: stringValue(metadata.ledger_entity_name),
    entity_role: stringValue(metadata.ledger_entity_role),
    measure_concept: stringValue(metadata.ledger_measure_concept),
    source_concept: stringValue(metadata.ledger_source_concept),
    concept_relation: stringValue(metadata.ledger_concept_relation),
    concept_authority: stringValue(metadata.ledger_concept_authority),
    measure_unit: stringValue(metadata.ledger_measure_unit),
    value_operation: stringValue(metadata.ledger_value_operation),
    layout_record_set_id: stringValue(metadata.ledger_layout_record_set_id),
    layout_groupby_dimension: stringValue(metadata.ledger_layout_groupby_dimension),
    layout_groupby_value_id: stringValue(metadata.ledger_layout_groupby_value_id),
    layout_measure_id: stringValue(metadata.ledger_layout_measure_id),
    dimension_set_key: stringValue(metadata.ledger_dimension_set_key),
    universe_constraint_set_key: stringValue(metadata.ledger_universe_constraint_set_key),
    universe_constraint_count: numberOrNull(metadata.ledger_universe_constraint_count),
    filters: chronicleFilters(metadata),
  };
}

function isDuplicateDimension(
  dimensions: TargetBreakdownDimension[],
  label: string,
  value: string | null,
): boolean {
  if (!value) return false;
  const key = dimensionKey(label);
  return dimensions.some((dim) => dim.key === key && dim.value === value);
}

function sourceMeasureDetail(metadata: JsonObject): string | null {
  const variable = stringValue(metadata.variable);
  const sourceMeasure = stringValue(metadata.source_measure_id);
  if (!variable || !sourceMeasure) return null;
  const variablePrefix = variable.replace(/\s+/g, "_").toLowerCase();
  const measure = sourceMeasure.toLowerCase();
  if (!measure.startsWith(`${variablePrefix}_`)) return null;
  const detail = measure
    .slice(variablePrefix.length + 1)
    .replace(/_(amount|returns|claims|count|total|collections|projected_amount)$/, "");
  if (!detail || MEASURES.has(detail)) return null;
  if (["amount", "returns", "claims", "count", "total", "collections", "projected_amount"].includes(detail)) {
    return null;
  }
  return readableToken(detail);
}

function metadataDimensions(row: TargetRow): TargetBreakdownDimension[] | null {
  const metadata = asObject(row.metadata);
  if (!Object.keys(metadata).length) return null;
  const dimensions: TargetBreakdownDimension[] = [];
  const layoutDimension = stringValue(metadata.ledger_layout_groupby_dimension);
  const layoutValue = stringValue(metadata.ledger_layout_groupby_value_id);
  if (
    layoutValue &&
    !isGeographyLayoutDimension(layoutDimension) &&
    !isRedundantGeographyValue(metadata, layoutValue)
  ) {
    addDimension(
      dimensions,
      dimensionLabel(layoutDimension),
      readableDimensionValue(layoutValue),
      "ledger_layout_groupby_value_id",
      layoutValue,
    );
  }
  for (const [key, raw] of Object.entries(metadata)) {
    if (!key.startsWith("ledger_filter_")) continue;
    const rawValue = stringValue(raw);
    if (!rawValue) continue;
    const label = filterDimensionLabel(key);
    const value = readableFilterValue(key, rawValue);
    if (isDuplicateDimension(dimensions, label, value)) continue;
    addDimension(dimensions, label, value, key, rawValue);
  }
  addDimension(
    dimensions,
    "Qualifying children",
    qualifyingChildrenFromCount(stringValue(metadata.ledger_filter_eitc_child_count)) ??
      qualifyingChildrenFromRecordSet(stringValue(metadata.ledger_layout_record_set_id)) ??
      qualifyingChildrenFromSourceMeasure(
        stringValue(metadata.variable),
        stringValue(metadata.source_measure_id),
      ),
    stringValue(metadata.ledger_filter_eitc_child_count)
      ? "ledger_filter_eitc_child_count"
      : stringValue(metadata.ledger_layout_record_set_id)
        ? "ledger_layout_record_set_id"
        : "source_measure_id",
    stringValue(metadata.ledger_filter_eitc_child_count) ??
      stringValue(metadata.ledger_layout_record_set_id) ??
      stringValue(metadata.source_measure_id),
  );
  addDimension(dimensions, "Filing status", stringValue(metadata.filing_status));
  const sourceDetail = sourceMeasureDetail(metadata);
  const hasExplicitChildDimension = dimensions.some((dim) => dim.label === "Qualifying children");
  const sourceDetailIsChildDimension = Boolean(sourceDetail && /child|children/.test(sourceDetail));
  if (
    sourceDetail &&
    !(hasExplicitChildDimension && sourceDetailIsChildDimension) &&
    !dimensions.some((dim) => dim.value === sourceDetail)
  ) {
    addDimension(dimensions, "Source measure detail", sourceDetail, "source_measure_id", stringValue(metadata.source_measure_id));
  }
  return dimensions;
}

interface FilterDimensionSpec {
  capture: number;
  label: string;
  role?: "geography";
  valueLabels?: Readonly<Record<string, string>>;
}

interface FilterDecompositionSpec {
  pattern: RegExp;
  geographyLevel: string;
  dimensions: readonly FilterDimensionSpec[];
}

export interface DiagnosticsDimension {
  label: string;
  role?: "geography";
  level?: string;
  values?: Record<string, string>;
  order?: string[];
}

export function diagnosticsDimensions(
  diag: JsonObject,
): Record<string, DiagnosticsDimension> {
  if (!isPlainObject(diag.dimensions)) return {};
  return Object.fromEntries(
    Object.entries(diag.dimensions).flatMap(([id, rawDefinition]) => {
      if (!id || !isPlainObject(rawDefinition)) return [];
      const label = stringValue(rawDefinition.label)?.trim();
      if (!label) return [];
      const role = rawDefinition.role === "geography" ? "geography" : undefined;
      const level = stringValue(rawDefinition.level)?.trim();
      const values = isPlainObject(rawDefinition.values)
        ? Object.fromEntries(
            Object.entries(rawDefinition.values).flatMap(([rawValue, rawLabel]) => {
              if (!rawValue || typeof rawLabel !== "string") return [];
              const valueLabel = rawLabel.trim();
              return valueLabel ? [[rawValue, valueLabel]] : [];
            }),
          )
        : undefined;
      const order = Array.isArray(rawDefinition.order)
        ? rawDefinition.order.flatMap((rawValue) => {
            if (typeof rawValue !== "string") return [];
            const value = rawValue.trim();
            return value ? [value] : [];
          })
        : undefined;
      return [[
        id,
        {
          label,
          ...(role ? { role } : {}),
          ...(level ? { level } : {}),
          ...(values ? { values } : {}),
          ...(order ? { order } : {}),
        },
      ]];
    }),
  );
}

// Legacy artifacts encode some dimensions in a compiled filter name. The
// adapter is selected by the filter pattern, never by country; future artifacts
// should publish structured target dimensions instead.
const FILTER_DECOMPOSITION_SPECS: readonly FilterDecompositionSpec[] = [
  {
    pattern: /^cell_([a-z][a-z0-9-]*)_(male|female)_(\d+_(?:\d+|plus))$/,
    geographyLevel: "region",
    dimensions: [
      {
        capture: 1,
        label: "Region",
        role: "geography",
        valueLabels: {
          be1: "Brussels",
          be2: "Flanders",
          be3: "Wallonia",
        },
      },
      { capture: 2, label: "Sex" },
      { capture: 3, label: "Age band" },
    ],
  },
];

interface DecomposedTargetFilter {
  geography: string;
  level: string;
  dimensions: TargetBreakdownDimension[];
}

interface DecomposedStructuredDimensions {
  geography: string | null;
  level: string | null;
  dimensions: TargetBreakdownDimension[];
}

function dimensionValue(
  label: string,
  rawValue: string,
  valueLabels?: Readonly<Record<string, string>>,
): string {
  const explicit =
    valueLabels && Object.hasOwn(valueLabels, rawValue)
      ? valueLabels[rawValue]
      : undefined;
  if (explicit) return explicit;
  if (label.toLowerCase() === "age band") {
    const range = /^(\d+)_(\d+)$/.exec(rawValue);
    if (range) return `${range[1]}–${range[2]}`;
    const openEnded = /^(\d+)_plus$/.exec(rawValue);
    if (openEnded) return `${openEnded[1]}+`;
  }
  return titleCase(rawValue);
}

function filterDimensionValue(spec: FilterDimensionSpec, rawValue: string): string {
  return dimensionValue(spec.label, rawValue, spec.valueLabels);
}

function decomposeStructuredDimensions(
  values: JsonObject,
  definitions: Record<string, DiagnosticsDimension>,
): DecomposedStructuredDimensions {
  let geography: string | null = null;
  let level: string | null = null;
  const dimensions: TargetBreakdownDimension[] = [];
  for (const [id, raw] of Object.entries(values)) {
    const rawValue = stringValue(raw)?.trim();
    if (!rawValue) continue;
    const definition = definitions[id];
    const label = definition?.label ?? dimensionLabel(id);
    const value = dimensionValue(label, rawValue, definition?.values);
    const rankOrder = definition?.order ??
      (definition?.values ? Object.keys(definition.values) : undefined);
    const rank = rankOrder?.indexOf(rawValue) ?? -1;
    if (definition?.role === "geography") {
      geography ??= value;
      level ??= definition.level ?? "region";
      continue;
    }
    dimensions.push({
      key: dimensionKey(label),
      label,
      value,
      source_key: id,
      raw_value: rawValue,
      ...(rank >= 0 ? { rank } : {}),
    });
  }
  return { geography, level, dimensions };
}

function decomposeTargetFilter(value: unknown): DecomposedTargetFilter | null {
  const filter = stringValue(value);
  if (!filter) return null;
  for (const spec of FILTER_DECOMPOSITION_SPECS) {
    const match = spec.pattern.exec(filter);
    if (!match) continue;
    let geography = "";
    const dimensions: TargetBreakdownDimension[] = [];
    for (const dimension of spec.dimensions) {
      const rawValue = match[dimension.capture];
      if (!rawValue) continue;
      const valueLabel = filterDimensionValue(dimension, rawValue);
      if (dimension.role === "geography") {
        geography = valueLabel;
        continue;
      }
      dimensions.push({
        key: dimensionKey(dimension.label),
        label: dimension.label,
        value: valueLabel,
        source_key: "filter",
        raw_value: rawValue,
      });
    }
    if (geography) {
      return { geography, level: spec.geographyLevel, dimensions };
    }
  }
  return null;
}

interface StructuredTargetSource {
  id: string | null;
  citation: string | null;
  label: string | null;
  url: string | null;
}

interface StructuredTargetVariable {
  id: string;
  label: string | null;
  measure: string | null;
}

function structuredTargetSource(value: unknown): StructuredTargetSource | null {
  if (!isPlainObject(value)) return null;
  return {
    id: stringValue(value.id)?.trim() ?? null,
    citation: stringValue(value.citation)?.trim() ?? null,
    label: stringValue(value.label)?.trim() ?? null,
    url: stringValue(value.url)?.trim() ?? null,
  };
}

function structuredTargetVariable(value: unknown): StructuredTargetVariable | null {
  if (!isPlainObject(value)) return null;
  const id = stringValue(value.id)?.trim();
  if (!id) return null;
  return {
    id,
    label: stringValue(value.label)?.trim() ?? null,
    measure: stringValue(value.measure)?.trim() ?? null,
  };
}

function variableKeyOf(parsed: ParsedTarget): string {
  return [parsed.source, parsed.variable].filter(Boolean).join(" / ");
}

function splitBreakdown(breakdown: string): string[] {
  const raw = breakdown ? breakdown.split(" · ").filter(Boolean) : [];
  const out: string[] = [];
  for (const token of raw) {
    if (FILING_MODIFIERS.has(token) && out.length) {
      out[out.length - 1] = `${out[out.length - 1]} · ${token}`;
    } else {
      out.push(token);
    }
  }
  return out;
}

function classifyDimension(values: string[]): string {
  const v = values.filter(Boolean);
  if (!v.length) return "Breakdown";
  const all = (pred: (s: string) => boolean) => v.every(pred);
  const firstStatus = (s: string) => s.split(" · ")[0];
  if (all((s) => s.startsWith("AGI in "))) return "Income band";
  if (all((s) => RETURN_TYPES.has(s))) return "Return type";
  if (all((s) => FILING_STATUSES.has(firstStatus(s)))) return "Filing status";
  if (all((s) => QUALIFYING_CHILDREN.has(s))) return "Qualifying children";
  if (all((s) => /^\d+$/.test(s))) return "Age";
  if (all((s) => MEASURES.has(s))) return "Measure";
  return "Breakdown";
}

function parseAmount(token: string): number {
  const normalized = token.trim().toLowerCase().replace(/,/g, "");
  if (/^-?inf(?:inity)?$/.test(normalized)) return normalized.startsWith("-") ? -Infinity : Infinity;
  const negative = normalized.startsWith("-");
  const magnitude = parseFloat(normalized);
  if (!Number.isFinite(magnitude)) return 0;
  const mult = /k$/.test(normalized) ? 1e3 : /m$/.test(normalized) ? 1e6 : 1;
  return (negative ? -1 : 1) * Math.abs(magnitude) * mult;
}

function totalDimensionRank(value: string): number {
  return /^(all|total|all returns)$/i.test(value.trim()) ? 0 : 1;
}

function numericRange(value: string): { lower: number; upper: number } | null {
  const body = value
    .replace(/^AGI in\s+/i, "")
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\s+/g, " ");
  const amount = "-?\\d+(?:\\.\\d+)?[km]?";

  let match = new RegExp(`^under (${amount})$`).exec(body);
  if (match) return { lower: -Infinity, upper: parseAmount(match[1]) };

  match = new RegExp(`^(${amount}) plus$`).exec(body);
  if (match) return { lower: parseAmount(match[1]), upper: Infinity };

  match = new RegExp(`^(${amount}) to (${amount})$`).exec(body);
  if (match) return { lower: parseAmount(match[1]), upper: parseAmount(match[2]) };

  match = new RegExp(`^(${amount})-(${amount}|inf|infinity)$`).exec(body);
  if (match) return { lower: parseAmount(match[1]), upper: parseAmount(match[2]) };

  match = new RegExp(`^(${amount})$`).exec(body);
  if (match) {
    const point = parseAmount(match[1]);
    return { lower: point, upper: point };
  }

  return null;
}

function compareNumericRangesDescending(a: string, b: string): number {
  const totalRank = totalDimensionRank(a) - totalDimensionRank(b);
  if (totalRank !== 0) return totalRank;

  const ar = numericRange(a);
  const br = numericRange(b);
  if (ar || br) {
    if (!ar) return 1;
    if (!br) return -1;
    return br.lower - ar.lower || br.upper - ar.upper || a.localeCompare(b);
  }

  return a.localeCompare(b);
}

function sortDimensionValues(label: string, values: string[]): string[] {
  if (label === "Income band") return [...values].sort(compareNumericRangesDescending);
  if (label === "Age") return [...values].sort(compareNumericRangesDescending);
  if (label === "Qualifying children") {
    const rank = (value: string) =>
      [
        "all qualifying children",
        "three or more qualifying children",
        "two qualifying children",
        "one qualifying child",
        "no qualifying children",
      ].indexOf(value);
    return [...values].sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar >= 0 || br >= 0) return (ar >= 0 ? ar : 99) - (br >= 0 ? br : 99);
      return compareNumericRangesDescending(a, b);
    });
  }
  return [...values].sort(compareNumericRangesDescending);
}

function rowFacetValue(row: TargetRow, key: string): string | undefined {
  if (key === "geography") return (row.geography as string) || undefined;
  if (key === "level") return (row.level as string) || undefined;
  const targetDimensions = row.target_dimensions as TargetBreakdownDimension[] | undefined;
  const targetDimension = targetDimensions?.find((dim) => dim.key === key);
  if (targetDimension) return targetDimension.value;
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return (row.dims as string[] | undefined)?.[Number(dim[1])];
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function sortFacetValues(label: string, values: string[]): string[] {
  if (label === "Geography") {
    return [...values].sort((a, b) =>
      a === "United States" ? -1 : b === "United States" ? 1 : a.localeCompare(b),
    );
  }
  return sortDimensionValues(label, values);
}

export interface TargetDimension {
  key: string;
  label: string;
  values: string[];
}

function computeDimensions(rows: TargetRow[]): TargetDimension[] {
  const geographyLabel =
    rows.length > 0 && rows.every((row) => row.level === "region")
      ? "Region"
      : "Geography";
  const candidates: { key: string; label?: string }[] = [
    { key: "geography", label: geographyLabel },
  ];
  const seenDimensionKeys = new Set<string>();
  for (const row of rows) {
    const targetDimensions = row.target_dimensions as TargetBreakdownDimension[] | undefined;
    for (const dim of targetDimensions ?? []) {
      if (seenDimensionKeys.has(dim.key)) continue;
      seenDimensionKeys.add(dim.key);
      candidates.push({ key: dim.key, label: dim.label });
    }
  }
  const facets: TargetDimension[] = [];
  for (const candidate of candidates) {
    const values = [
      ...new Set(
        rows.map((row) => rowFacetValue(row, candidate.key)).filter((v): v is string => Boolean(v)),
      ),
    ];
    if (values.length <= 1) continue;
    const label = candidate.label ?? classifyDimension(values);
    const ranks = new Map<string, number>();
    let everyValueRanked = candidate.key !== "geography";
    for (const value of values) {
      const matchingDimensions = rows.flatMap((row) =>
        ((row.target_dimensions as TargetBreakdownDimension[] | undefined) ?? [])
          .filter((dimension) =>
            dimension.key === candidate.key && dimension.value === value,
          ),
      );
      if (
        !matchingDimensions.length ||
        matchingDimensions.some((dimension) => typeof dimension.rank !== "number")
      ) {
        everyValueRanked = false;
        break;
      }
      ranks.set(
        value,
        Math.min(...matchingDimensions.map((dimension) => dimension.rank as number)),
      );
    }
    const sortedValues = everyValueRanked
      ? [...values].sort(
          (a, b) =>
            (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0) || a.localeCompare(b),
        )
      : sortFacetValues(label, values);
    facets.push({ key: candidate.key, label, values: sortedValues });
  }
  return facets;
}

function deriveFamily(
  name: string,
  parsed: ParsedTarget,
  usesArtifactFamily: boolean,
): string {
  if (usesArtifactFamily) {
    return [parsed.source, parsed.variable].filter(Boolean).join("/");
  }
  const parts = name.split("/");
  if (parts.length < 2) return name;
  const [geo, second] = parts;
  if (/^[A-Z]{2}$/.test(second)) return "state_distribution";
  if (/^US\d{2}$/.test(geo)) return second;
  return `${geo}/${second}`;
}

function deriveState(name: string): string | null {
  const parts = name.split("/");
  return parts.length >= 2 && /^[A-Z]{2}$/.test(parts[1]) ? parts[1] : null;
}

function skippedTargetReasons(skipped: unknown[]): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const entry of skipped) {
    if (typeof entry === "string") {
      reasons.set(entry, "Skipped by calibration.");
      continue;
    }
    const row = asObject(entry);
    const name = stringValue(row.name) ?? stringValue(row.target_name);
    if (!name) continue;
    reasons.set(name, stringValue(row.reason) ?? "Skipped by calibration.");
  }
  return reasons;
}

function targetNames(row: TargetRow, fullName: string, baseName: string): string[] {
  const names = [
    fullName,
    baseName,
    stringValue(row.name),
    stringValue(row.target_name),
    stringValue(asObject(row.metadata).ledger_source_record_id),
  ];
  return [...new Set(names.filter((name): name is string => Boolean(name)))];
}

function calibrationStatus(
  row: TargetRow,
  names: string[],
  skippedByName: Map<string, string>,
  droppedTargetNames: Set<string>,
): {
  calibration_status: "included" | "skipped" | "not_materialized";
  calibration_status_label: string;
  calibration_status_reason: string | null;
} {
  const skippedName = names.find((name) => skippedByName.has(name));
  if (skippedName) {
    return {
      calibration_status: "skipped",
      calibration_status_label: "Skipped",
      calibration_status_reason: skippedByName.get(skippedName) ?? "Skipped by calibration.",
    };
  }
  const droppedName = names.find((name) => droppedTargetNames.has(name));
  if (droppedName) {
    return {
      calibration_status: "not_materialized",
      calibration_status_label: "Not materialized",
      calibration_status_reason: "The target was declared but no model column/filter was materialized for it.",
    };
  }
  if (numberOrNull(row.initial_estimate) == null && numberOrNull(row.final_estimate) == null) {
    return {
      calibration_status: "not_materialized",
      calibration_status_label: "No estimate",
      calibration_status_reason: "The diagnostics row has no initial or final estimate.",
    };
  }
  return {
    calibration_status: "included",
    calibration_status_label: "Included",
    calibration_status_reason: null,
  };
}

// Enrich a raw target row. Schema v2 publishes the canonical registry fields
// (source citation, entity, aggregation, measure, period, target_name); we keep
// the parsed geography/source/variable/breakdown for navigation and surface the
// published metadata alongside. v1 rows simply lack those extra fields.
function enrichTargetRow(
  rawRow: TargetRow,
  skippedByName: Map<string, string>,
  droppedTargetNames: Set<string>,
  artifactCountry: ArtifactCountry,
  publisherLabels: Record<string, string>,
  dimensionDefinitions: Record<string, DiagnosticsDimension>,
  targetRepresentation: TargetRepresentation,
): TargetRow {
  const nationalGeography = artifactCountry.geography_label;
  const metadata = normalizeChronicleMetadata(rawRow.metadata);
  const row: TargetRow = { ...rawRow, metadata };
  const fullName = String(row.name ?? "");
  // v2 carries target_name (no @period); else strip any @period from the name.
  const baseName = String(row.target_name ?? fullName.split("@")[0]);
  const status = calibrationStatus(
    row,
    targetNames(row, fullName, baseName),
    skippedByName,
    droppedTargetNames,
  );
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const errorKind = "relative";
  // Published diagnostics may carry a raw absolute miss in `relative_error`
  // for a zero target. Recompute that case so all releases use the structural-
  // zero rule consistently.
  const rawFinalError = target === 0
    ? relativeError(final, target)
    : numberOrNull(row.relative_error) ?? relativeError(final, target);
  const rawInitialError = relativeError(initial, target);
  const initialMiss = initial != null && target != null ? initial - target : null;
  const finalMiss = final != null && target != null ? final - target : null;
  const absInitialMiss = initialMiss == null ? null : Math.abs(initialMiss);
  const absFinalMiss = finalMiss == null ? null : Math.abs(finalMiss);
  const absoluteImprovement =
    absInitialMiss == null || absFinalMiss == null
      ? null
      : absInitialMiss - absFinalMiss;
  const initialError = rawInitialError;
  const finalError = rawFinalError;
  const absFinalError = finalError == null ? null : Math.abs(finalError);
  const improvement =
    initialError == null || finalError == null
      ? null
      : Math.abs(initialError) - Math.abs(finalError);
  const structuredIdentity = targetRepresentation === "structured"
    ? readStructuredTarget(row, dimensionDefinitions, nationalGeography)
    : null;
  const permitsCompatibilityFields = targetRepresentation === "mixed";
  const publishedSource = permitsCompatibilityFields
    ? structuredTargetSource(row.source)
    : null;
  const publishedVariable = permitsCompatibilityFields
    ? structuredTargetVariable(row.variable)
    : null;
  const structuredDecomposition = permitsCompatibilityFields && isPlainObject(row.dimensions)
    ? decomposeStructuredDimensions(row.dimensions, dimensionDefinitions)
    : null;
  const filterDecomposition = structuredIdentity || structuredDecomposition
    ? null
    : decomposeTargetFilter(row.filter);
  const dimensionAdapter = structuredIdentity || structuredDecomposition
    ? "structured"
    : filterDecomposition
      ? "legacy_filter"
      : "legacy_name";
  const publisher =
    structuredIdentity?.source ??
    chroniclePublisherFromMetadata(metadata) ??
    publishedSource?.id ??
    null;
  const legacyParsed = structuredIdentity
    ? null
    : readLegacyTarget(
        baseName,
        row,
        nationalGeography,
        filterDecomposition,
      );
  const parsed: ParsedTarget = structuredIdentity
    ? {
        geography: structuredIdentity.geography,
        level: structuredIdentity.level,
        source: structuredIdentity.source,
        variable: structuredIdentity.variable,
        breakdown: structuredIdentity.breakdown,
      }
    : {
        ...legacyParsed!,
        geography:
          structuredDecomposition?.geography ??
          legacyParsed!.geography,
        level:
          structuredDecomposition?.level ??
          legacyParsed!.level,
        source: publisher ?? legacyParsed!.source,
        variable: publishedVariable?.id ?? legacyParsed!.variable,
        breakdown: structuredDecomposition
          ? structuredDecomposition.dimensions
              .map((dimension) => dimension.value)
              .join(" · ")
          : legacyParsed!.breakdown,
      };
  const hasGeography = Boolean(parsed.geography.trim());
  const geography = hasGeography ? parsed.geography : nationalGeography;
  const level = hasGeography ? parsed.level : DEFAULT_GEOGRAPHY_LEVEL;
  const measureCol = asObject(row.measure);
  const metadataTargetDimensions =
    structuredIdentity?.dimensions ??
    structuredDecomposition?.dimensions ??
    filterDecomposition?.dimensions ??
    metadataDimensions(row);
  const targetDimensions =
    metadataTargetDimensions ??
    splitBreakdown(parsed.breakdown).map((value, index) => ({
      key: `dim${index}`,
      label: classifyDimension([value]),
      value,
    }));
  const dims = targetDimensions.map((dim) => dim.value);
  const breakdown = metadataTargetDimensions ? dims.join(" · ") : parsed.breakdown;
  const sourceMeasureId = stringValue(metadata.source_measure_id);
  const targetRole = stringValue(metadata.target_role);
  const policyengineVariables = policyengineVariablesFromMetadata(metadata);
  // The first breakdown token is the measure (total / count / mean / …). Many
  // IRS variables publish both a total (dollar amount) and a count (number of
  // returns), so the measure is part of the variable's identity, not a
  // breakdown within it — fold it into variable_key so they're distinct things.
  const measure =
    structuredIdentity?.measure ??
    (structuredIdentity
      ? null
      : publishedVariable?.measure ??
        (dims[0] && MEASURES.has(dims[0])
          ? dims[0]
          : measureFromMetadata(metadata)));
  const variableKey =
    variableKeyOf(parsed) + (measure ? ` · ${measure}` : "");
  // Underscore identifiers and filter-decomposed targets use the structured
  // publisher/variable identity supplied by the artifact. Dotted identifiers
  // without filter dimensions retain their legacy family so US/UK releases do
  // not regroup merely because they also carry Chronicle record IDs.
  const usesArtifactFamily =
    structuredIdentity != null ||
    publishedSource?.id != null ||
    publishedVariable != null ||
    structuredDecomposition != null ||
    filterDecomposition != null ||
    (publisher != null && !baseName.includes("/") && !baseName.includes("."));
  return {
    ...row,
    name: fullName,
    base_name: baseName,
    family: deriveFamily(baseName, parsed, usesArtifactFamily),
    state: structuredIdentity
      ? null
      : stateFromGeoId(stringValue(metadata.ledger_geography_id)) ?? deriveState(baseName),
    geography,
    level,
    source: parsed.source,
    source_label:
      (Object.hasOwn(publisherLabels, parsed.source)
        ? publisherLabels[parsed.source]
        : undefined) ??
      structuredIdentity?.sourceLabel ??
      publishedSource?.label ??
      sourceAuthorityLabel(parsed.source),
    variable: parsed.variable,
    variable_label:
      structuredIdentity?.variableLabel ??
      publishedVariable?.label ??
      null,
    measure,
    target_role: targetRole,
    source_measure_id: sourceMeasureId,
    policyengine_variables: policyengineVariables.length
      ? policyengineVariables
      : fallbackPolicyengineVariables(metadata),
    policyengine_map_to: stringValue(metadata.count_map_to) ?? fallbackPolicyengineMapTo(metadata),
    policyengine_filter_variable: stringValue(metadata.count_filter_variable) ?? fallbackPolicyengineFilterVariable(metadata),
    materializer: stringValue(metadata.materializer),
    measure_mode: stringValue(metadata.measure_mode) ?? fallbackMeasureMode(metadata),
    error_kind: errorKind,
    initial_error: initialError,
    final_error: finalError,
    initial_miss: initialMiss,
    final_miss: finalMiss,
    abs_final_miss: absFinalMiss,
    absolute_improvement: absoluteImprovement,
    abs_error: absFinalError,
    breakdown,
    dims,
    target_dimensions: targetDimensions,
    dimension_adapter: dimensionAdapter,
    variable_key: variableKey,
    // v2 published metadata (null on v1).
    source_citation:
      structuredIdentity?.sourceCitation ??
      (typeof row.source === "string"
        ? (row.source as string)
        : publishedSource?.citation ?? null),
    source_url:
      structuredIdentity?.sourceUrl ??
      publishedSource?.url ??
      null,
    entity: typeof row.entity === "string" ? (row.entity as string) : null,
    aggregation: typeof row.aggregation === "string" ? (row.aggregation as string) : null,
    measure_name: typeof measureCol.name === "string" ? (measureCol.name as string) : null,
    period: numberOrNull(row.period),
    chronicle: chronicleFactFields(metadata),
    relative_error: finalError,
    initial_relative_error: initialError,
    abs_relative_error: absFinalError,
    improvement,
    direction: finalError == null ? null : finalError > 0 ? "over" : finalError < 0 ? "under" : "exact",
    ...status,
  };
}

function estimateScopeKey(row: TargetRow): string | null {
  if (row.filter != null || row.dimensions != null) return null;
  const metadata = asObject(row.metadata);
  const recordSet = stringValue(metadata.ledger_layout_record_set_id);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  if (!recordSet || initial == null || final == null) return null;
  return [
    row.source,
    row.period,
    metadata.ledger_geography_id,
    metadata.ledger_layout_groupby_dimension,
    metadata.ledger_layout_groupby_value_id,
    metadata.ledger_layout_measure_id,
    metadata.source_measure_id,
    metadata.variable,
    initial,
    final,
  ].join("||");
}

function estimateScopeWarning(row: TargetRow): string {
  const metadata = asObject(row.metadata);
  const childGroup = qualifyingChildrenFromRecordSet(
    stringValue(metadata.ledger_layout_record_set_id),
  );
  if (childGroup) {
    return "This Chronicle fact is for a qualifying-children slice, but the calibration diagnostics did not include a compiled model filter for that child-count slice. The estimate may reflect the broader EITC aggregate instead of this exact slice.";
  }
  return "This Chronicle fact is one slice of a target family, but the calibration diagnostics did not include a compiled model filter for this slice and sibling slices share the same estimate. The estimate may reflect a broader aggregate than this exact fact.";
}

function addEstimateScopeWarnings(rows: TargetRow[]): TargetRow[] {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = estimateScopeKey(row);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }

  const flagged = new Set<TargetRow>();
  for (const group of groups.values()) {
    const recordSets = new Set(
      group
        .map((row) => stringValue(asObject(row.metadata).ledger_layout_record_set_id))
        .filter((value): value is string => Boolean(value)),
    );
    const targets = new Set(group.map((row) => numberOrNull(row.target)));
    if (recordSets.size <= 1 || targets.size <= 1) continue;
    for (const row of group) flagged.add(row);
  }

  if (!flagged.size) return rows;
  return rows.map((row) =>
    flagged.has(row)
      ? {
          ...row,
          estimate_warning: estimateScopeWarning(row),
        }
      : row,
  );
}

function stringParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitVariableList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap(splitVariableList)
      .filter((variable, index, all) => all.indexOf(variable) === index);
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((variable) => variable.trim())
    .filter(Boolean);
}

function policyengineVariablesFromMetadata(metadata: JsonObject): string[] {
  const variables = [
    ...splitVariableList(metadata.base_variables),
    ...splitVariableList(metadata.base_variable),
  ];
  return variables.filter((variable, index) => variables.indexOf(variable) === index);
}

function fallbackPolicyengineVariables(metadata: JsonObject): string[] {
  const targetRole = stringValue(metadata.target_role);
  const sourceMeasureId = stringValue(metadata.source_measure_id);
  if (
    targetRole === "aca_spending" ||
    targetRole === "aca_ptc_recipients" ||
    sourceMeasureId === "premium_tax_credit_amount" ||
    sourceMeasureId === "premium_tax_credit_returns"
  ) {
    return ["assigned_aca_ptc"];
  }
  if (targetRole === "aca_enrollment") {
    return ["has_marketplace_health_coverage_at_interview"];
  }
  if (targetRole === "medicaid_spending") {
    return ["medicaid"];
  }
  if (targetRole === "medicaid_enrollment") {
    return ["medicaid_enrolled"];
  }
  if (targetRole === "medicaid_chip_enrollment") {
    return ["medicaid_enrolled", "chip_enrolled"];
  }
  if (targetRole === "medicare_part_b_premium_total") {
    return ["gross_medicare_part_b_premium"];
  }
  return [];
}

function fallbackPolicyengineMapTo(metadata: JsonObject): string | null {
  return stringValue(metadata.target_role) === "aca_ptc_recipients" ? "person" : null;
}

function fallbackPolicyengineFilterVariable(metadata: JsonObject): string | null {
  return stringValue(metadata.target_role) === "aca_ptc_recipients"
    ? "is_aca_ptc_eligible"
    : null;
}

function fallbackMeasureMode(metadata: JsonObject): string | null {
  const targetRole = stringValue(metadata.target_role);
  if (
    targetRole === "aca_enrollment" ||
    targetRole === "aca_ptc_recipients" ||
    targetRole === "medicaid_enrollment" ||
    targetRole === "medicaid_chip_enrollment"
  ) {
    return "positive_count";
  }
  if (
    targetRole === "aca_spending" ||
    targetRole === "medicaid_spending" ||
    targetRole === "medicare_part_b_premium_total"
  ) {
    return "sum";
  }
  return null;
}

function booleanParam(value: string | null): boolean | null {
  if (value == null || value === "") return null;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  return null;
}

function matchesSearch(row: TargetRow, search: string): boolean {
  const haystack = [
    row.name, row.variable, row.source, row.breakdown, row.geography, row.state,
    row.source_citation,
  ]
    .filter((v) => v != null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

const HEALTHCARE_TARGET_ROLES = new Set([
  "aca_spending",
  "aca_enrollment",
  "aca_ptc_recipients",
  "aca_bronze_aptc_consumers",
  "medicaid_spending",
  "medicaid_enrollment",
  "medicaid_chip_enrollment",
  "medicare_part_b_premium_total",
]);

function isHealthcareTarget(row: TargetRow): boolean {
  const metadata = asObject(row.metadata);
  const targetRole = stringValue(metadata.target_role);
  if (targetRole && HEALTHCARE_TARGET_ROLES.has(targetRole)) return true;

  const haystack = [
    row.name,
    row.family,
    row.source,
    row.variable,
    row.variable_key,
    metadata.source_measure_id,
    metadata.ledger_measure_concept,
    metadata.ledger_domain,
  ]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("cms_aca") ||
    haystack.includes("cms_medicaid") ||
    haystack.includes("cms_medicare") ||
    haystack.includes("medicaid") ||
    haystack.includes("chip") ||
    haystack.includes("medicare") ||
    haystack.includes("premium tax credit") ||
    haystack.includes("aca_ptc")
  );
}

function withinToleranceCount(rows: TargetRow[]): number {
  return rows.filter((row) => row.within_tolerance === true).length;
}

export function microcosmTargetFamilies(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.family ?? "")))].sort();
}

export function microcosmTargetSources(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.source ?? "")))].filter(Boolean).sort();
}

export function microcosmTargetLevels(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.level ?? "")))].filter(Boolean).sort();
}

export function microcosmTargetGeographies(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.geography ?? "")))]
    .filter(Boolean)
    .sort((a, b) =>
      a === "United States" ? -1 : b === "United States" ? 1 : a.localeCompare(b),
    );
}

export function microcosmVariableSummary(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = String(row.variable_key ?? "");
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  return [...groups.entries()]
    .map(([variable_key, group]) => {
      const first = group[0];
      const absErrors = group
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((v): v is number => v != null);
      const policyengineVariables = [
        ...new Set(
          group.flatMap((row) =>
            Array.isArray(row.policyengine_variables)
              ? row.policyengine_variables.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
          ),
        ),
      ];
      const uniqueString = (key: string) => {
        const values = [
          ...new Set(
            group
              .map((row) => row[key])
              .filter(
                (value): value is string =>
                  typeof value === "string" && value.length > 0,
              ),
          ),
        ];
        return values.length === 1 ? values[0] : null;
      };
      return {
        variable_key,
        source: String(first.source ?? ""),
        source_label: String(
          first.source_label ?? sourceAuthorityLabel(String(first.source ?? "")),
        ),
        variable: String(first.variable ?? ""),
        variable_label: uniqueString("variable_label"),
        measure: first.measure ? String(first.measure) : null,
        level: String(first.level ?? ""),
        policyengine_variables: policyengineVariables,
        policyengine_map_to: uniqueString("policyengine_map_to"),
        policyengine_filter_variable: uniqueString("policyengine_filter_variable"),
        materializer: uniqueString("materializer"),
        measure_mode: uniqueString("measure_mode"),
        n_targets: group.length,
        within_10pct: group.filter((r) => (numberOrNull(r.abs_relative_error) ?? Infinity) <= 0.1).length,
        within_tolerance: group.filter((r) => r.within_tolerance === true).length,
        mean_abs_relative_error: absErrors.length
          ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length
          : null,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

function familyFitSummary(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const family = String(row.family ?? "");
    (groups.get(family) ?? groups.set(family, []).get(family)!).push(row);
  }
  return [...groups.entries()]
    .map(([family, group]) => {
      const absErrors = group
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((v): v is number => v != null);
      return {
        family,
        n_targets: group.length,
        within_tolerance: withinToleranceCount(group),
        within_10pct: group.filter((r) => (numberOrNull(r.abs_relative_error) ?? Infinity) <= 0.1).length,
        mean_abs_relative_error: absErrors.length ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length : null,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

// --- calibration map (treemap) ----------------------------------------------

export type TreemapBreakdown = "program" | "geography";

export interface TreemapFilters {
  program?: string;
  geography?: string;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TreemapLeaf {
  key: string;
  source: string;
  variable: string;
  label: string | null;
  measure: string | null;
  measure_counts: { measure: string | null; n_targets: number }[];
  filters: TreemapFilters;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
}

export interface TreemapGroup {
  source: string;
  label: string;
  n_targets: number;
  within_10pct: number;
  scored: number;
  loss: number;
  mean_abs_relative_error: number | null;
  median_abs_relative_error: number | null;
  children: TreemapLeaf[];
}

export interface TreemapData {
  release_id: string;
  loss_attribution_available: boolean;
  total_targets: number;
  total_within_10pct: number;
  total_scored: number;
  total_loss: number;
  groups: TreemapGroup[];
}

function targetProgramKey(row: TargetRow): string {
  const variableKey = String(row.variable_key ?? "").trim();
  if (variableKey) return variableKey.replace(/\s+·\s+(count|total|amount|mean)$/i, "");
  const source = String(row.source ?? "").trim();
  const variable = String(row.variable ?? "").trim();
  if (source && variable) return `${source} / ${variable}`;
  return String(row.name ?? row.target_name ?? "unknown");
}

function targetGeographyKey(row: TargetRow): string {
  const geography = String(row.geography ?? "").trim();
  return geography || DEFAULT_GEOGRAPHY;
}

function measureCounts(rows: TargetRow[]): { measure: string | null; n_targets: number }[] {
  const counts = new Map<string, { measure: string | null; n_targets: number }>();
  for (const row of rows) {
    const measure = String(row.measure ?? "").trim() || null;
    const key = measure ?? "__missing__";
    const current = counts.get(key) ?? { measure, n_targets: 0 };
    current.n_targets += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => {
    const rank = (value: string | null) =>
      value === "total" || value == null ? 0 : value === "count" ? 1 : 2;
    return (
      rank(a.measure) - rank(b.measure) ||
      String(a.measure ?? "").localeCompare(String(b.measure ?? ""))
    );
  });
}

function treemapRows(
  rows: TargetRow[],
  breakdown: TreemapBreakdown,
): Map<string, Map<string, TargetRow[]>> {
  const groups = new Map<string, Map<string, TargetRow[]>>();
  for (const row of rows) {
    const source =
      breakdown === "geography"
        ? "geography"
        : String(row.source ?? "").trim() || "other";
    const key =
      breakdown === "geography" ? targetGeographyKey(row) : targetProgramKey(row);
    const byLeaf = groups.get(source) ?? groups.set(source, new Map()).get(source)!;
    (byLeaf.get(key) ?? byLeaf.set(key, []).get(key)!).push(row);
  }
  return groups;
}

// Build the source → variable hierarchy that powers the calibration map.
// Each leaf carries both "how much we calibrate to it" (n_targets) and "how
// much weighted capped target error lands here. Loss is the sum of normalized
// per-target final_loss_contribution values produced by the artifact adapter;
// relative-error metrics remain separate fit diagnostics.
export function microcosmTargetTreemap(
  rows: TargetRow[],
  releaseId: string,
  breakdown: TreemapBreakdown = "program",
  lossAttributionAvailable = rows.length > 0 && rows.every(
    (row) => numberOrNull(row.final_loss_contribution) != null,
  ),
): TreemapData {
  const groups = treemapRows(rows, breakdown);

  const leafOf = (source: string, key: string, group: TargetRow[]): TreemapLeaf => {
    const absErrors = group
      .map((row) => numberOrNull(row.abs_relative_error))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const first = group[0];
    const variableLabels = [
      ...new Set(
        group
          .map((row) => stringValue(row.variable_label)?.trim())
          .filter((label): label is string => Boolean(label)),
      ),
    ];
    const filters: TreemapFilters =
      breakdown === "geography"
        ? { geography: key }
        : { program: key };
    return {
      key,
      source,
      variable:
        breakdown === "geography"
          ? key
          : String(first.variable ?? key),
      label:
        breakdown === "geography" || variableLabels.length !== 1
          ? null
          : variableLabels[0],
      measure: null,
      measure_counts: measureCounts(group),
      filters,
      n_targets: group.length,
      scored: absErrors.length,
      within_10pct: absErrors.filter((v) => v <= 0.1).length,
      loss: group.reduce(
        (sum, row) => sum + (numberOrNull(row.final_loss_contribution) ?? 0),
        0,
      ),
      mean_abs_relative_error: absErrors.length
        ? absErrors.reduce((s, v) => s + v, 0) / absErrors.length
        : null,
      median_abs_relative_error: median(absErrors),
    };
  };

  const groupList: TreemapGroup[] = [...groups.entries()]
    .map(([source, byVar]) => {
      const children = [...byVar.entries()]
        .map(([key, group]) => leafOf(source, key, group))
        .sort((a, b) => b.n_targets - a.n_targets);
      const allErrors = [...byVar.values()]
        .flat()
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((v): v is number => v != null && Number.isFinite(v));
      const n_targets = children.reduce((s, c) => s + c.n_targets, 0);
      const scored = children.reduce((s, c) => s + c.scored, 0);
      const within_10pct = children.reduce((s, c) => s + c.within_10pct, 0);
      const loss = children.reduce((s, c) => s + c.loss, 0);
      const rowSourceLabel = [...byVar.values()]
        .flat()
        .map((row) => stringValue(row.source_label))
        .find((label): label is string => label != null);
      return {
        source,
        label:
          source === "geography"
            ? "Geography"
            : rowSourceLabel ?? sourceAuthorityLabel(source),
        n_targets,
        scored,
        within_10pct,
        loss,
        mean_abs_relative_error: allErrors.length
          ? allErrors.reduce((s, v) => s + v, 0) / allErrors.length
          : null,
        median_abs_relative_error: median(allErrors),
        children,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);

  return {
    release_id: releaseId,
    loss_attribution_available: lossAttributionAvailable,
    total_targets: groupList.reduce((s, g) => s + g.n_targets, 0),
    total_within_10pct: groupList.reduce((s, g) => s + g.within_10pct, 0),
    total_scored: groupList.reduce((s, g) => s + g.scored, 0),
    total_loss: groupList.reduce((s, g) => s + g.loss, 0),
    groups: groupList,
  };
}

// --- the calibration source (one release) -----------------------------------
export interface TargetSchema {
  diagnostics_schema_version: number | null;
  structured_dimensions: boolean;
  target_representation: TargetRepresentation;
}

export interface Calibration {
  source: "huggingface_live";
  country: MicrocosmCountry;
  // Typed `release_manifest.country` merged over the registration.
  country_info: ArtifactCountry;
  presentation: ArtifactPresentation | null;
  publisher_labels: Record<string, string>;
  target_schema: TargetSchema;
  description: string | null;
  diagnostics_status: DiagnosticsStatus;
  release_id: string;
  updated_at: string | null;
  schema_version: unknown;
  weight_entity: unknown;
  options: JsonObject;
  l0_lambda: number | null;
  n_nonzero: number | null;
  n_records: number | null;
  initial_loss: number | null;
  final_loss: number | null;
  loss_kind: CalibrationLossKind;
  fraction_within_10pct: number | null;
  loss_trajectory: number[];
  skipped: unknown[];
  declared_targets: number | null;
  compiled_candidate_targets: number | null;
  dropped_target_names: string[];
  included_target_count: number;
  diagnostics_build: JsonObject;
  diagnostic_warnings: TargetLossDiagnosticWarning[];
  target_loss_basis: JsonObject | null;
  target_loss_attribution: FinalTargetLossAttribution;
  build_manifest: JsonObject;
  release_manifest: JsonObject;
  // demographics.json geography_coverage: unweighted household-record counts
  // by state / congressional district (the release's sub-national resolution
  // floor). Null for releases published before the section existed.
  geography_coverage: JsonObject | null;
  rows: TargetRow[];
}

interface ReleaseCacheEntry {
  expiresAt: number;
  promise: Promise<Calibration>;
}

interface TargetDiagnosticsMetadata {
  sources: string[];
  levels: string[];
  geographies: string[];
  variables: ReturnType<typeof microcosmVariableSummary>;
  // Targets per named scope (the `scope` query parameter); a scope with no
  // targets in the release has nothing to focus on.
  scope_counts: { healthcare: number };
}

interface InvestigationSignal {
  tone: "critical" | "warning" | "neutral" | "positive";
  label: string;
  detail: string;
}

interface InvestigationSearch {
  label: string;
  query: string;
  url: string;
}

const releaseCache = new Map<string, ReleaseCacheEntry>();
const targetDiagnosticsMetadataCache = new WeakMap<TargetRow[], TargetDiagnosticsMetadata>();

// Whether this release's per-target diagnostics could be read at all. "ok" is
// the normal case; "empty" is a diagnostics file that declares no targets; and
// "incompatible" is a diagnostics file that has target rows we cannot read as
// calibration fit under any known schema. The dashboard renders an explicit
// state for the last two so a release never silently shows "0 targets".
export type DiagnosticsStatus = "ok" | "empty" | "incompatible";

// The national release pipeline writes each target row with canonical fit
// fields (`target`, `final_estimate`, `initial_estimate`). Some non-default
// artifacts are built by custom drivers that name the same quantities
// `value`/`estimate` instead — the Build L ACS local-area release is the first
// (microcosm#398: non-default artifacts route around the national pipeline).
// Its rows carry no `target`/`final_estimate`, so every downstream reader —
// inclusion status, fit, improvement — read them as "no estimate" and the
// dashboard reported zero calibrated targets for a release with 742 of them.
// Map the aliases onto the canonical names so one schema flows downstream,
// regardless of which driver wrote the file (a copy is made only when a row
// actually needs it, and an existing canonical value is never overwritten).
const DIAGNOSTICS_FIELD_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["target", "value"],
  ["final_estimate", "estimate"],
  ["initial_estimate", "initial_value"],
];

function normalizeDiagnosticsRow(row: TargetRow): TargetRow {
  let normalized: TargetRow | null = null;
  for (const [canonical, alias] of DIAGNOSTICS_FIELD_ALIASES) {
    if (numberOrNull(row[canonical]) != null) continue;
    const aliased = numberOrNull(row[alias]);
    if (aliased == null) continue;
    normalized ??= { ...row };
    normalized[canonical] = aliased;
  }
  return normalized ?? row;
}

function diagnosticsStatus(diag: JsonObject, rows: TargetRow[]): DiagnosticsStatus {
  if (!Array.isArray(diag.targets)) return "incompatible";
  if (rows.length === 0) return "empty";
  // Rows are present but not one carries a usable target value or estimate under
  // any known schema: the diagnostics exist but cannot be read as fit.
  const anyUsable = rows.some(
    (row) => numberOrNull(row.target) != null || numberOrNull(row.final_estimate) != null,
  );
  return anyUsable ? "ok" : "incompatible";
}

export interface ArtifactPresentation {
  overview_intro?: string;
  targets_intro?: string;
}

function presentationText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 600) : null;
}

export function releasePresentation(
  releaseManifest: JsonObject,
): ArtifactPresentation | null {
  const block = asObject(releaseManifest.presentation);
  const overviewIntro = presentationText(block.overview_intro);
  const targetsIntro = presentationText(block.targets_intro);
  if (!overviewIntro && !targetsIntro) return null;
  return {
    ...(overviewIntro ? { overview_intro: overviewIntro } : {}),
    ...(targetsIntro ? { targets_intro: targetsIntro } : {}),
  };
}

export function releasePublisherLabels(
  releaseManifest: JsonObject,
): Record<string, string> {
  const block = releaseManifest.publisher_labels;
  if (!isPlainObject(block)) return {};
  return Object.fromEntries(
    Object.entries(block).flatMap(([key, value]) => {
      if (!/^[a-z][a-z0-9_]*$/i.test(key) || typeof value !== "string") return [];
      const label = value.trim();
      return label ? [[key, label]] : [];
    }),
  );
}

export interface ReleaseRole {
  dataset_role: string | null;
  is_default: boolean;
  is_local_area: boolean;
}

// Classify a release from its manifest so the dashboard can flag non-default,
// experimental artifacts (microcosm#398). The national default omits
// `dataset_role` and names a `default_datasets.national` artifact; a non-default
// artifact sets `dataset_role` (e.g. "non_default_local_area") and
// `is_default: false`.
export function releaseRole(releaseManifest: JsonObject): ReleaseRole {
  const datasetRole = stringValue(releaseManifest.dataset_role);
  const explicitDefault = releaseManifest.is_default;
  const nationalDefault = asObject(releaseManifest.default_datasets).national;
  const isDefault =
    explicitDefault === true ||
    (explicitDefault == null &&
      datasetRole == null &&
      typeof nationalDefault === "string" &&
      nationalDefault.length > 0);
  return {
    dataset_role: datasetRole,
    is_default: isDefault,
    is_local_area:
      datasetRole != null && (datasetRole === "non_default_local_area" || datasetRole.includes("local_area")),
  };
}

// The country a release presents as, typed: registry defaults, overridden by
// the string fields of `release_manifest.country` when present and well-typed.
// The dashboard is selected by registry, so the artifact cannot re-route it: a
// block whose `code` names another country is ignored whole. Capabilities can
// only narrow what a deployment serves (intersection with the registration),
// never widen it. Unknown keys are ignored.
export interface ArtifactCountry {
  code: MicrocosmCountry;
  label: string;
  geography_id: string | null;
  geography_label: string;
  repository_visibility: RepositoryVisibility;
  capabilities: CountryCapability[];
}

function visibilityValue(value: unknown): RepositoryVisibility | null {
  return value === "public" || value === "private" ? value : null;
}

export function releaseCountry(
  releaseManifest: JsonObject,
  country: MicrocosmCountry,
): ArtifactCountry {
  const registration = countryRegistration(country);
  const defaults: ArtifactCountry = {
    code: country,
    label: registration.label,
    geography_id: registration.geography_id,
    geography_label: registration.geography,
    repository_visibility: registration.visibility,
    capabilities: [...registration.capabilities],
  };
  const block = asObject(releaseManifest.country);
  // Presence, not nullishness: an explicit `code: null` is a malformed block,
  // not an absent field, and must not slip past the whole-block rejection.
  if (
    Object.hasOwn(block, "code") &&
    (typeof block.code !== "string" || block.code.trim().toLowerCase() !== country)
  ) {
    return defaults;
  }
  const capabilities = Array.isArray(block.capabilities)
    ? new Set(block.capabilities.filter(isCountryCapability))
    : null;
  return {
    code: country,
    label: stringValue(block.label)?.trim() ?? defaults.label,
    geography_id: stringValue(block.geography_id)?.trim() ?? defaults.geography_id,
    geography_label: stringValue(block.geography_label)?.trim() ?? defaults.geography_label,
    repository_visibility:
      visibilityValue(block.repository_visibility) ?? defaults.repository_visibility,
    capabilities: capabilities
      ? defaults.capabilities.filter((capability) => capabilities.has(capability))
      : defaults.capabilities,
  };
}

export function buildCalibration(
  diag: JsonObject,
  releaseId: string,
  updatedAt: string | null = null,
  buildManifest: JsonObject = {},
  releaseManifest: JsonObject = {},
  demographics: JsonObject = {},
  country: MicrocosmCountry = "us",
): Calibration {
  const targets = (Array.isArray(diag.targets) ? (diag.targets as TargetRow[]) : []).map(
    normalizeDiagnosticsRow,
  );
  const targetRepresentation = classifyTargetRepresentation(targets);
  const skipped = Array.isArray(diag.skipped) ? (diag.skipped as JsonObject[]) : [];
  const targetCompilation = asObject(asObject(buildManifest.gates).target_compilation);
  const droppedTargetNames = Array.isArray(targetCompilation.dropped_target_names)
    ? targetCompilation.dropped_target_names
        .map((value) => (typeof value === "string" ? value : null))
        .filter((value): value is string => value != null)
    : [];
  const skippedByName = skippedTargetReasons(skipped);
  const dropped = new Set(droppedTargetNames);
  const artifactCountry = releaseCountry(releaseManifest, country);
  const presentation = releasePresentation(releaseManifest);
  const publisherLabels = releasePublisherLabels(releaseManifest);
  const dimensionDefinitions = diagnosticsDimensions(diag);
  const enrichedRows = addEstimateScopeWarnings(
    targets.map((row) =>
      enrichTargetRow(
        row,
        skippedByName,
        dropped,
        artifactCountry,
        publisherLabels,
        dimensionDefinitions,
        targetRepresentation,
      ),
    ),
  );
  const role = releaseRole(releaseManifest);
  const normalizedAttribution = normalizeTargetLossAttribution({
    diagnostics: diag,
    rows: enrichedRows,
    releaseId,
    buildManifest,
    releaseFamily: role.is_local_area ? "local_area" : "national",
  });
  const rows = normalizedAttribution.rows;
  const includedTargetCount = rows.filter((row) => row.calibration_status === "included").length;
  return {
    source: "huggingface_live",
    country,
    country_info: artifactCountry,
    presentation,
    publisher_labels: publisherLabels,
    target_schema: {
      diagnostics_schema_version: numberOrNull(diag.schema_version),
      structured_dimensions: isPlainObject(diag.dimensions),
      target_representation: targetRepresentation,
    },
    description:
      stringValue(diag.description) ??
      stringValue(releaseManifest.description) ??
      stringValue(buildManifest.description),
    diagnostics_status: diagnosticsStatus(diag, rows),
    release_id: String(diag.release_id ?? releaseId),
    updated_at: updatedAt,
    schema_version: diag.schema_version ?? null,
    weight_entity: diag.weight_entity ?? null,
    options: asObject(diag.options),
    l0_lambda: numberOrNull(diag.l0_lambda),
    n_nonzero: numberOrNull(diag.n_nonzero),
    n_records: numberOrNull(diag.n_records),
    initial_loss: numberOrNull(diag.initial_loss),
    final_loss: numberOrNull(diag.final_loss),
    loss_kind: calibrationLossKind(diag, buildManifest),
    fraction_within_10pct: numberOrNull(diag.fraction_within_10pct),
    loss_trajectory: Array.isArray(diag.loss_trajectory) ? (diag.loss_trajectory as number[]) : [],
    skipped,
    declared_targets: numberOrNull(targetCompilation.declared_targets),
    compiled_candidate_targets: numberOrNull(targetCompilation.compiled_candidate_targets),
    dropped_target_names: droppedTargetNames,
    included_target_count: includedTargetCount,
    diagnostics_build: asObject(diag.build),
    diagnostic_warnings: normalizedAttribution.attribution.producer_warnings,
    target_loss_basis: Object.keys(asObject(diag.target_loss_basis)).length
      ? asObject(diag.target_loss_basis)
      : null,
    target_loss_attribution: normalizedAttribution.attribution,
    build_manifest: buildManifest,
    release_manifest: releaseManifest,
    geography_coverage: Object.keys(asObject(demographics.geography_coverage)).length
      ? asObject(demographics.geography_coverage)
      : null,
    rows,
  };
}

// --- HF access --------------------------------------------------------------
export function hfResolveUrl(path: string, country: MicrocosmCountry = "us"): string {
  const { repo, revision } = COUNTRY_REPO[country];
  return `https://huggingface.co/datasets/${repo}/resolve/${revision}/${path}`;
}

// A hung HF request would otherwise block the function for the whole route
// maxDuration and pin the shared in-flight cache promise; cap each fetch.
const HF_FETCH_TIMEOUT_MS = 20_000;

async function hfFetch(url: string, revalidate: number): Promise<Response> {
  return fetch(url, {
    next: { revalidate },
    headers: hfAuthHeaders(),
    signal: AbortSignal.timeout(HF_FETCH_TIMEOUT_MS),
  });
}

async function hfJson(url: string, revalidate: number): Promise<JsonObject> {
  const res = await hfFetch(url, revalidate);
  if (!res.ok) throw new Error(`HF fetch failed ${res.status}: ${url}`);
  return asObject(await res.json());
}

export function releasePublishedAtFromTree(tree: unknown): string | null {
  if (!Array.isArray(tree)) return null;
  const entries = tree
    .map((entry) => asObject(entry))
    .filter((entry) => entry.type === "file" && typeof entry.path === "string");
  const preferred =
    entries.find((entry) => String(entry.path).endsWith("/release_manifest.json")) ??
    entries.find((entry) => String(entry.path).endsWith("/calibration_diagnostics.json")) ??
    entries[0];
  const date = asObject(preferred?.lastCommit).date;
  return typeof date === "string" && date.length > 0 ? date : null;
}

async function loadReleasePublishedAt(
  releaseId: string,
  revalidate: number,
  country: MicrocosmCountry,
): Promise<string | null> {
  const { repo, revision } = COUNTRY_REPO[country];
  const url =
    `https://huggingface.co/api/datasets/${repo}/tree/${revision}/releases/${releaseId}` +
    "?recursive=false&expand=true";
  const res = await hfFetch(url, revalidate);
  if (!res.ok) throw new Error(`HF tree failed ${res.status}: ${url}`);
  return releasePublishedAtFromTree(await res.json());
}

export interface ReleaseEntry {
  release_id: string;
  date: string;
  files: string[];
  has_calibration: boolean;
  dataset_role: string | null;
  is_default: boolean;
  is_local_area: boolean;
}

// Trailing timestamp/date in a build id → a real timestamp for ordering. Ids
// without the trailing YYYYMMDD[THHMMSSZ] sort oldest (rank 0) instead of
// jumping to the top on a lexical whole-id compare.
function releaseSortKey(id: string): number {
  const m = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(id);
  if (!m) return 0;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}

function releaseDate(id: string): string {
  const m = /(\d{8}(?:T\d{6}Z)?)$/.exec(id);
  return m ? m[1] : id;
}

export async function loadReleases(
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<ReleaseEntry[]> {
  const { repo, revision } = COUNTRY_REPO[country];
  const files = new Map<string, Set<string>>();
  // The HF tree endpoint paginates (~1000 entries/page via a Link cursor);
  // follow every page so releases don't silently vanish as the repo grows.
  let url: string | null =
    `https://huggingface.co/api/datasets/${repo}/tree/${revision}/releases?recursive=true`;
  let page = 0;
  while (url && page < 50) {
    const res: Response = await hfFetch(url, revalidate);
    if (!res.ok) throw new Error(`HF tree failed ${res.status}`);
    const tree = await res.json();
    if (Array.isArray(tree)) {
      for (const entry of tree) {
        const item = asObject(entry);
        if (item.type !== "file" || typeof item.path !== "string") continue;
        const match = item.path.match(/^releases\/([^/]+)\/(.+)$/);
        if (!match) continue;
        (files.get(match[1]) ?? files.set(match[1], new Set()).get(match[1])!).add(match[2]);
      }
    }
    const link = res.headers.get("link") ?? "";
    const next = /<([^>]+)>;\s*rel="next"/.exec(link);
    url = next ? next[1] : null;
    page += 1;
  }
  const entries: ReleaseEntry[] = [...files.entries()]
    .map(([release_id, set]) => ({
      release_id,
      date: releaseDate(release_id),
      files: [...set].sort(),
      has_calibration: set.has("calibration_diagnostics.json"),
      dataset_role: null as string | null,
      is_default: true,
      is_local_area: false,
    }))
    .sort((a, b) => releaseSortKey(b.release_id) - releaseSortKey(a.release_id));
  // Classify each release from its manifest so the picker can flag non-default,
  // experimental artifacts (microcosm#398). Best-effort and parallel: only
  // releases that actually publish a release_manifest.json are fetched, and a
  // missing or slow manifest keeps the safe national-default classification
  // rather than blocking or failing the listing.
  await Promise.all(
    entries
      .filter((entry) => entry.files.includes("release_manifest.json"))
      .map(async (entry) => {
        try {
          const manifest = await hfJson(
            hfResolveUrl(`releases/${entry.release_id}/release_manifest.json`, country),
            revalidate,
          );
          Object.assign(entry, releaseRole(manifest));
        } catch {
          // Best-effort: keep the default classification.
        }
      }),
  );
  return entries;
}

export async function loadPointerReleaseId(
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<{ release_id: string; updated_at: string | null }> {
  const pointer = await hfJson(hfResolveUrl("latest.json", country), revalidate);
  return {
    release_id: String(pointer.release_id ?? ""),
    updated_at: typeof pointer.updated_at === "string" ? pointer.updated_at : null,
  };
}

// Load one release's manifests + calibration diagnostics. releaseId "latest"
// resolves through the pointer.
export async function loadRelease(
  releaseId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
): Promise<Calibration> {
  const cacheKey = `${country}:${releaseId || "latest"}:${revalidate}`;
  const now = Date.now();
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = loadReleaseUncached(releaseId, revalidate, country);
  releaseCache.set(cacheKey, {
    promise,
    expiresAt: now + Math.max(revalidate, 1) * 1000,
  });
  try {
    return await promise;
  } catch (error) {
    releaseCache.delete(cacheKey);
    throw error;
  }
}

async function loadReleaseUncached(
  releaseId: string,
  revalidate: number,
  country: MicrocosmCountry,
): Promise<Calibration> {
  let id = assertSafeReleaseId(releaseId);
  let updatedAt: string | null = null;
  if (releaseId === "latest" || !releaseId) {
    const ptr = await loadPointerReleaseId(revalidate, country);
    id = ptr.release_id;
    updatedAt = ptr.updated_at;
  }
  const prefix = `releases/${id}`;
  const [diag, buildManifest, releaseManifest, demographics, publishedAt] = await Promise.all([
    hfJson(hfResolveUrl(`${prefix}/calibration_diagnostics.json`, country), revalidate),
    hfJson(hfResolveUrl(`${prefix}/build_manifest.json`, country), revalidate).catch(() => ({})),
    hfJson(hfResolveUrl(`${prefix}/release_manifest.json`, country), revalidate).catch(() => ({})),
    hfJson(hfResolveUrl(`${prefix}/demographics.json`, country), revalidate).catch(() => ({})),
    updatedAt
      ? Promise.resolve(updatedAt)
      : loadReleasePublishedAt(id, revalidate, country).catch(() => null),
  ]);
  return buildCalibration(
    diag,
    id,
    updatedAt ?? publishedAt,
    buildManifest,
    releaseManifest,
    demographics,
    country,
  );
}

function targetDiagnosticsMetadata(rows: TargetRow[]): TargetDiagnosticsMetadata {
  const cached = targetDiagnosticsMetadataCache.get(rows);
  if (cached) return cached;
  const metadata = {
    sources: microcosmTargetSources(rows),
    levels: microcosmTargetLevels(rows),
    geographies: microcosmTargetGeographies(rows),
    variables: microcosmVariableSummary(rows),
    scope_counts: { healthcare: rows.filter(isHealthcareTarget).length },
  };
  targetDiagnosticsMetadataCache.set(rows, metadata);
  return metadata;
}

function targetResponseRow(row: TargetRow): TargetRow {
  return {
    name: row.name,
    target: row.target,
    initial_estimate: row.initial_estimate,
    final_estimate: row.final_estimate,
    relative_error: row.relative_error,
    within_tolerance: row.within_tolerance,
    base_name: row.base_name,
    family: row.family,
    state: row.state,
    geography: row.geography,
    level: row.level,
    source: row.source,
    source_label: row.source_label,
    variable: row.variable,
    variable_label: row.variable_label,
    measure: row.measure,
    target_role: row.target_role,
    source_measure_id: row.source_measure_id,
    policyengine_variables: row.policyengine_variables,
    policyengine_map_to: row.policyengine_map_to,
    policyengine_filter_variable: row.policyengine_filter_variable,
    materializer: row.materializer,
    measure_mode: row.measure_mode,
    error_kind: row.error_kind,
    initial_error: row.initial_error,
    final_error: row.final_error,
    initial_miss: row.initial_miss,
    final_miss: row.final_miss,
    abs_final_miss: row.abs_final_miss,
    absolute_improvement: row.absolute_improvement,
    abs_error: row.abs_error,
    breakdown: row.breakdown,
    dims: row.dims,
    target_dimensions: row.target_dimensions,
    dimension_adapter: row.dimension_adapter,
    variable_key: row.variable_key,
    source_citation: row.source_citation,
    source_url: row.source_url,
    entity: row.entity,
    aggregation: row.aggregation,
    measure_name: row.measure_name,
    period: row.period,
    chronicle: row.chronicle,
    estimate_warning: row.estimate_warning,
    calibration_status: row.calibration_status,
    calibration_status_label: row.calibration_status_label,
    calibration_status_reason: row.calibration_status_reason,
    initial_relative_error: row.initial_relative_error,
    abs_relative_error: row.abs_relative_error,
    improvement: row.improvement,
    direction: row.direction,
  };
}

function githubSearchUrl(query: string): string {
  const scoped = `org:PolicyEngine ${query}`;
  return `https://github.com/search?type=code&q=${encodeURIComponent(scoped)}`;
}

function investigationSearches(row: TargetRow): InvestigationSearch[] {
  const chronicle = asObject(row.chronicle);
  const metadata = asObject(row.metadata);
  const terms: [string, string | null][] = [
    ["Source record", stringValue(chronicle.source_record_id)],
    ["Fact key", stringValue(chronicle.fact_key)],
    ["Semantic fact", stringValue(chronicle.semantic_fact_key)],
    ["Aggregate fact", stringValue(chronicle.aggregate_fact_key)],
    ["Legacy fact", stringValue(chronicle.legacy_fact_key)],
    ["Record set", stringValue(chronicle.layout_record_set_id)],
    ["Measure concept", stringValue(chronicle.measure_concept)],
    ["Source concept", stringValue(chronicle.source_concept)],
    ["Source measure", stringValue(metadata.source_measure_id)],
    ["Variable", stringValue(metadata.variable) ?? stringValue(row.variable)],
  ];
  const seen = new Set<string>();
  const nonEmptyTerms: [string, string][] = [];
  for (const [label, value] of terms) {
    if (!value) continue;
    nonEmptyTerms.push([label, value]);
  }
  return nonEmptyTerms
    .filter(([, value]) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map(([label, value]) => ({
      label,
      query: `"${value}"`,
      url: githubSearchUrl(`"${value}"`),
    }));
}

function investigationSignals(row: TargetRow): InvestigationSignal[] {
  const signals: InvestigationSignal[] = [];
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const initialMiss = numberOrNull(row.initial_miss);
  const finalMiss = numberOrNull(row.final_miss);
  const absRel = numberOrNull(row.abs_relative_error);
  const improvement = numberOrNull(row.improvement);
  const absoluteImprovement = numberOrNull(row.absolute_improvement);
  const calibrationStatus = stringValue(row.calibration_status);

  if (calibrationStatus && calibrationStatus !== "included") {
    signals.push({
      tone: "critical",
      label: "Target not included",
      detail: stringValue(row.calibration_status_reason) ?? "The target was not included in calibration.",
    });
  }
  if (stringValue(row.estimate_warning)) {
    signals.push({
      tone: "critical",
      label: "Estimate scope warning",
      detail: stringValue(row.estimate_warning)!,
    });
  }
  if (target === 0 && final != null && Math.abs(final) > 0) {
    signals.push({
      tone: "warning",
      label: "Zero target has non-zero estimate",
      detail: "The dashboard treats a substantive non-zero estimate against a structural-zero target as 100% error.",
    });
  }
  if (absRel != null) {
    const tone = absRel > 1 ? "critical" : absRel > 0.1 ? "warning" : "positive";
    signals.push({
      tone,
      label: "Final fit",
      detail:
        absRel <= 0.1
          ? "The final estimate is within 10% of the target."
          : `The final estimate is ${(absRel * 100).toFixed(absRel > 1 ? 1 : 2)}% away from the target.`,
    });
  }
  if (initialMiss != null && finalMiss != null) {
    const sameDirection = Math.sign(initialMiss) === Math.sign(finalMiss) && Math.sign(finalMiss) !== 0;
    if (sameDirection && improvement != null && improvement <= 0) {
      signals.push({
        tone: "warning",
        label: "Calibration moved away",
        detail: "Initial and final miss have the same sign, and the absolute error did not improve.",
      });
    } else if (sameDirection && absoluteImprovement != null && absoluteImprovement > 0) {
      signals.push({
        tone: absRel != null && absRel > 0.1 ? "warning" : "positive",
        label: "Same-side miss remains",
        detail: "Calibration reduced the miss, but the final estimate remains on the same side of the target.",
      });
    }
  }
  if (initial == null || final == null) {
    signals.push({
      tone: "critical",
      label: "Missing estimate",
      detail: "The published diagnostics do not contain both initial and final estimates for this target.",
    });
  }

  if (!signals.length) {
    signals.push({
      tone: "neutral",
      label: "No artifact-level warnings",
      detail: "The release artifact does not flag this target; investigate source target construction and model aggregate next.",
    });
  }
  return signals;
}

function investigationNextSteps(row: TargetRow): string[] {
  const steps = [
    "Verify the Chronicle fact: source period, target period, geography, unit, measure concept, and every filter/group-by value.",
    "Verify target materialization: confirm the Populus compiler creates a model selector for the exact Chronicle dimensions, not a broader aggregate.",
    "Verify model aggregate mapping: confirm the PolicyEngine variable or aggregate used for the estimate has the same unit, tax unit/person entity, sign convention, and period.",
    "Compare initial versus final miss: if both are badly off in the same direction, inspect source/model scope before tuning calibration weights.",
    "Inspect competing constraints for the same population slice if calibration improved one target while worsening another.",
  ];
  if (row.estimate_warning) {
    steps.unshift("Start with target materialization: the published diagnostics already indicate this estimate may be broader than the Chronicle slice.");
  }
  if (numberOrNull(row.target) === 0) {
    steps.unshift("Start with the Chronicle target value: confirm whether zero means a real zero, suppressed/missing source data, or a target intentionally dropped to zero.");
  }
  if (row.calibration_status !== "included") {
    steps.unshift("Start with the calibration status: the target was not included as an active calibration constraint.");
  }
  return [...new Set(steps)];
}

function targetInvestigationPacket(row: TargetRow, cal: Calibration) {
  const metadata = asObject(row.metadata);
  return {
    release_id: cal.release_id,
    target: targetResponseRow(row),
    source_artifact: {
      hf_repo: microcosmRepo(cal.country),
      hf_revision: microcosmRevision(cal.country),
      calibration_diagnostics_path: `releases/${cal.release_id}/calibration_diagnostics.json`,
      build_manifest_path: `releases/${cal.release_id}/build_manifest.json`,
      release_manifest_path: `releases/${cal.release_id}/release_manifest.json`,
    },
    source_metadata: {
      source_measure_id: stringValue(metadata.source_measure_id),
      variable: stringValue(metadata.variable),
      source_period: stringValue(metadata.source_period),
      target_period: stringValue(metadata.target_period),
    },
    signals: investigationSignals(row),
    next_steps: investigationNextSteps(row),
    repo_searches: investigationSearches(row),
    limits: [
      "The dashboard can prove what is in the release artifacts and Chronicle metadata.",
      "It cannot prove the generated per-record model filter or expression unless Populus exports that compiler trace for the target.",
      "When the artifact warns about scope, treat the estimate as provisional until the Populus materialized target is inspected.",
    ],
  };
}

// --- shaped outputs ---------------------------------------------------------
export function latestMicrocosmCalibrationSummary(cal: Calibration) {
  return {
    available: true,
    country: cal.country_info,
    presentation: cal.presentation,
    target_schema: cal.target_schema,
    description: cal.description,
    diagnostics_status: cal.diagnostics_status,
    ...releaseRole(cal.release_manifest),
    source: cal.source,
    release_id: cal.release_id,
    schema_version: cal.schema_version,
    weight_entity: cal.weight_entity,
    options: cal.options,
    l0_lambda: cal.l0_lambda,
    n_nonzero: cal.n_nonzero,
    n_records: cal.n_records,
    initial_loss: cal.initial_loss,
    final_loss: cal.final_loss,
    loss_kind: cal.loss_kind,
    fraction_within_10pct: cal.fraction_within_10pct,
    loss_trajectory: cal.loss_trajectory,
    skipped: cal.skipped,
    declared_targets: cal.declared_targets,
    compiled_candidate_targets: cal.compiled_candidate_targets,
    dropped_target_count: cal.dropped_target_names.length,
    included_target_count: cal.included_target_count,
    target_loss_attribution: targetLossAttributionSummary(cal.target_loss_attribution),
    total_targets: cal.rows.length,
    within_tolerance_count: withinToleranceCount(cal.rows),
    family_fit: familyFitSummary(cal.rows),
    geography_coverage: cal.geography_coverage,
  };
}

const EXTREME_RELATIVE_ERROR_THRESHOLD = 10; // 1000%; usually tiny-denominator artifacts.

function worstBoundedRelativeFit(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      return error != null && error <= EXTREME_RELATIVE_ERROR_THRESHOLD;
    })
    .sort((a, b) => (numberOrNull(b.abs_relative_error) ?? 0) - (numberOrNull(a.abs_relative_error) ?? 0))
    .slice(0, limit);
}

function extremeRelativeOutliers(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      return error != null && error > EXTREME_RELATIVE_ERROR_THRESHOLD;
    })
    .sort((a, b) => (numberOrNull(b.abs_relative_error) ?? 0) - (numberOrNull(a.abs_relative_error) ?? 0))
    .slice(0, limit);
}

function largestAbsoluteMisses(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => numberOrNull(row.abs_final_miss) != null)
    .sort((a, b) => (numberOrNull(b.abs_final_miss) ?? 0) - (numberOrNull(a.abs_final_miss) ?? 0))
    .slice(0, limit);
}

function biggestRelativeImprovements(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const improvement = numberOrNull(row.improvement);
      const initial = numberOrNull(row.initial_relative_error);
      const final = numberOrNull(row.abs_relative_error);
      return (
        improvement != null &&
        improvement > 0 &&
        initial != null &&
        final != null &&
        Math.abs(initial) <= EXTREME_RELATIVE_ERROR_THRESHOLD &&
        final <= EXTREME_RELATIVE_ERROR_THRESHOLD
      );
    })
    .sort((a, b) => (numberOrNull(b.improvement) ?? 0) - (numberOrNull(a.improvement) ?? 0))
    .slice(0, limit);
}

function biggestAbsoluteImprovements(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => {
      const improvement = numberOrNull(row.absolute_improvement);
      return improvement != null && improvement > 0;
    })
    .sort((a, b) => (numberOrNull(b.absolute_improvement) ?? 0) - (numberOrNull(a.absolute_improvement) ?? 0))
    .slice(0, limit);
}

export function latestMicrocosmCalibrationHighlights(cal: Calibration, limit = 15) {
  const extremeOutliers = extremeRelativeOutliers(cal.rows, limit);
  return {
    worst_fit: worstBoundedRelativeFit(cal.rows, limit),
    biggest_improvements: biggestRelativeImprovements(cal.rows, limit),
    worst_bounded_relative_fit: worstBoundedRelativeFit(cal.rows, limit),
    extreme_relative_outliers: extremeOutliers,
    extreme_relative_outlier_count: cal.rows.filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      return error != null && error > EXTREME_RELATIVE_ERROR_THRESHOLD;
    }).length,
    largest_absolute_misses: largestAbsoluteMisses(cal.rows, limit),
    biggest_relative_improvements: biggestRelativeImprovements(cal.rows, limit),
    biggest_absolute_improvements: biggestAbsoluteImprovements(cal.rows, limit),
  };
}

export function latestMicrocosmTargetDiagnosticsPage(requestUrl: string, cal: Calibration) {
  const rows = cal.rows;
  const url = new URL(requestUrl);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const includeFamilies = url.searchParams.get("include_families") === "1";
  const scope = stringParam(url.searchParams.get("scope")) === "healthcare" ? "healthcare" : null;
  const family = stringParam(url.searchParams.get("family"));
  const variable = stringParam(url.searchParams.get("variable"));
  const program = stringParam(url.searchParams.get("program"));
  const measure = stringParam(url.searchParams.get("measure"));
  const source = stringParam(url.searchParams.get("source"));
  const level = stringParam(url.searchParams.get("level"));
  const geography = stringParam(url.searchParams.get("geography"));
  const state = stringParam(url.searchParams.get("state"));
  const direction = stringParam(url.searchParams.get("direction"));
  const within = booleanParam(url.searchParams.get("within_tolerance"));
  const search = stringParam(url.searchParams.get("search"));
  const sortBy = stringParam(url.searchParams.get("sort_by")) ?? "abs_relative_error";
  const sortDir = stringParam(url.searchParams.get("sort_dir")) === "asc" ? "asc" : "desc";
  const facetFilters = url.searchParams
    .getAll("facet")
    .map((entry) => {
      const sep = entry.indexOf(":");
      return sep < 0 ? null : ([entry.slice(0, sep), entry.slice(sep + 1)] as const);
    })
    .filter((v): v is readonly [string, string] => v != null);
  const scopedRows = scope === "healthcare" ? rows.filter(isHealthcareTarget) : rows;
  const metadata = targetDiagnosticsMetadata(scopedRows);
  const scopedWithin10Pct = scopedRows.filter(
    (row) => (numberOrNull(row.abs_relative_error) ?? Infinity) <= 0.1,
  ).length;

  let filtered = scopedRows;
  if (family) filtered = filtered.filter((row) => row.family === family);
  if (variable) filtered = filtered.filter((row) => row.variable_key === variable);
  if (program) filtered = filtered.filter((row) => targetProgramKey(row) === program);
  if (measure) filtered = filtered.filter((row) => row.measure === measure);
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (level) filtered = filtered.filter((row) => row.level === level);
  if (geography) filtered = filtered.filter((row) => row.geography === geography);
  if (state) filtered = filtered.filter((row) => row.state === state);
  const dimensions = variable ? computeDimensions(filtered) : [];
  for (const [key, value] of facetFilters) {
    filtered = filtered.filter((row) => rowFacetValue(row, key) === value);
  }
  if (direction) filtered = filtered.filter((row) => row.direction === direction);
  // The artifact does not populate row.within_tolerance, so derive the "within
  // 10%" fit from the relative error — consistent with the within_10pct counts
  // and the "% on target" shown elsewhere.
  if (within !== null) {
    filtered = filtered.filter((row) => {
      const error = numberOrNull(row.abs_relative_error);
      const isWithin = error != null && error <= 0.1;
      return isWithin === within;
    });
  }
  if (search) filtered = filtered.filter((row) => matchesSearch(row, search));
  const sortValue = (row: TargetRow) =>
    rowFacetValue(row, sortBy) ?? row[sortBy];
  filtered = [...filtered].sort((a, b) => {
    const aVal = sortValue(a);
    const bVal = sortValue(b);
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp =
      typeof aVal === "number" && typeof bVal === "number"
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
    return sortDir === "asc" ? cmp : -cmp;
  });

  return {
    available: true,
    country: cal.country_info,
    presentation: cal.presentation,
    target_schema: cal.target_schema,
    description: cal.description,
    diagnostics_status: cal.diagnostics_status,
    ...releaseRole(cal.release_manifest),
    source: cal.source,
    release_id: cal.release_id,
    schema_version: cal.schema_version,
    metric: "relative_error",
    families: includeFamilies ? microcosmTargetFamilies(scopedRows) : [],
    sources: metadata.sources,
    levels: metadata.levels,
    geographies: metadata.geographies,
    variables: metadata.variables,
    dimensions,
    scope_counts: metadata.scope_counts,
    summary: {
      diagnostics_status: cal.diagnostics_status,
      total_targets: scopedRows.length,
      within_tolerance_count: withinToleranceCount(scopedRows),
      fraction_within_10pct: scopedRows.length ? scopedWithin10Pct / scopedRows.length : null,
      included_target_count: scopedRows.filter((row) => row.calibration_status === "included").length,
      skipped_target_count: scopedRows.filter((row) => row.calibration_status === "skipped").length,
      dropped_target_count: scopedRows.filter((row) => row.calibration_status === "not_materialized").length,
      declared_targets: cal.declared_targets,
      compiled_candidate_targets: cal.compiled_candidate_targets,
    },
    total_targets: scopedRows.length,
    filtered_total: filtered.length,
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    display_limit: limit,
    targets: filtered.slice(offset, offset + limit).map(targetResponseRow),
    filters: { scope, family, variable, program, measure, source, level, geography, state, direction, within_tolerance: within, search, sort_by: sortBy, sort_dir: sortDir },
  };
}

export function latestMicrocosmTargetInvestigation(requestUrl: string, cal: Calibration) {
  const url = new URL(requestUrl);
  const target = stringParam(url.searchParams.get("target"));
  if (!target) {
    return {
      available: false,
      detail: "Missing target query parameter.",
    };
  }
  const row = cal.rows.find((candidate) => {
    const chronicle = asObject(candidate.chronicle);
    return [
      stringValue(candidate.name),
      stringValue(candidate.base_name),
      stringValue(chronicle.source_record_id),
      stringValue(chronicle.fact_key),
      stringValue(chronicle.semantic_fact_key),
      stringValue(chronicle.aggregate_fact_key),
      stringValue(chronicle.legacy_fact_key),
    ].some((value) => value === target);
  });
  if (!row) {
    return {
      available: false,
      release_id: cal.release_id,
      detail: `Target not found: ${target}`,
    };
  }
  return {
    available: true,
    ...targetInvestigationPacket(row, cal),
  };
}

// --- version-over-version comparison ----------------------------------------
function absRel(row: TargetRow | undefined): number | null {
  return row ? numberOrNull(row.abs_relative_error) : null;
}

function comparableRelative(row: TargetRow | undefined): number | null {
  return row ? numberOrNull(row.final_error) : null;
}

function absoluteMiss(row: TargetRow | undefined): number | null {
  if (!row) return null;
  const estimate = numberOrNull(row.final_estimate);
  const target = numberOrNull(row.target);
  return estimate == null || target == null ? null : estimate - target;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function comparisonVariableRows(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = String(row.variable_key ?? row.variable ?? "unknown");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }
  return [...groups.entries()]
    .map(([variable_key, group]) => {
      const relativeRows = group.filter((row) => row.error_kind === "relative");
      const aErrors = relativeRows
        .map((row) => numberOrNull(row.a_error))
        .filter((value): value is number => value != null)
        .map(Math.abs);
      const bErrors = relativeRows
        .map((row) => numberOrNull(row.b_error))
        .filter((value): value is number => value != null)
        .map(Math.abs);
      const aMeanAbsError = mean(aErrors);
      const bMeanAbsError = mean(bErrors);
      const meanAbsDelta =
        aMeanAbsError == null || bMeanAbsError == null
          ? null
          : bMeanAbsError - aMeanAbsError;
      const sample = group[0] ?? {};
      return {
        variable_key,
        source: sample.source ?? null,
        variable: sample.variable ?? null,
        measure: sample.measure ?? null,
        level: sample.level ?? null,
        common_targets: group.length,
        relative_targets: relativeRows.length,
        improved: relativeRows.filter((row) => (numberOrNull(row.abs_rel_delta) ?? 0) < -1e-9).length,
        regressed: relativeRows.filter((row) => (numberOrNull(row.abs_rel_delta) ?? 0) > 1e-9).length,
        unchanged: relativeRows.filter((row) => numberOrNull(row.abs_rel_delta) === 0).length,
        a_mean_abs_error: aMeanAbsError,
        b_mean_abs_error: bMeanAbsError,
        mean_abs_delta: meanAbsDelta,
      };
    })
    .sort((a, b) => {
      const aDelta = numberOrNull(a.mean_abs_delta);
      const bDelta = numberOrNull(b.mean_abs_delta);
      if (aDelta == null && bDelta == null) return b.common_targets - a.common_targets;
      if (aDelta == null) return 1;
      if (bDelta == null) return -1;
      return Math.abs(bDelta) - Math.abs(aDelta) || b.relative_targets - a.relative_targets;
    });
}

// Diff two releases' calibration by matching targets on name. Common targets
// get a fit delta (|b rel err| - |a rel err|; negative = b fits better);
// targets present in only one release are listed as added/removed. Losses
// across releases are NOT comparable when the surfaces differ — flagged.
export function buildComparison(a: Calibration, b: Calibration) {
  // Match on base_name (the period-stripped name) so v1 and v2 releases align —
  // v2 appends an @<period> suffix the older convention lacks.
  const key = (r: TargetRow) => String(r.base_name ?? r.name);
  const aByName = new Map(a.rows.map((r) => [key(r), r]));
  const bByName = new Map(b.rows.map((r) => [key(r), r]));
  const names = new Set([...aByName.keys(), ...bByName.keys()]);

  const common: TargetRow[] = [];
  let added = 0;
  let removed = 0;
  let improved = 0;
  let regressed = 0;
  for (const name of names) {
    const ar = aByName.get(name);
    const br = bByName.get(name);
    if (ar && br) {
      const aAbs = absRel(ar);
      const bAbs = absRel(br);
      const delta = aAbs != null && bAbs != null ? bAbs - aAbs : null;
      if (delta != null && delta < -1e-9) improved += 1;
      else if (delta != null && delta > 1e-9) regressed += 1;
      const aRelative = comparableRelative(ar);
      const bRelative = comparableRelative(br);
      const errorKind = aRelative != null && bRelative != null ? "relative" : "absolute";
      common.push({
        name,
        target_label: [br.geography ?? ar.geography, br.breakdown ?? ar.breakdown]
          .filter(Boolean)
          .join(" · "),
        source: br.source ?? ar.source,
        variable_key: br.variable_key ?? ar.variable_key,
        variable: br.variable ?? ar.variable,
        measure: br.measure ?? ar.measure,
        level: br.level ?? ar.level,
        breakdown: br.breakdown ?? ar.breakdown,
        dims: br.dims ?? ar.dims,
        target_dimensions: br.target_dimensions ?? ar.target_dimensions,
        geography: br.geography ?? ar.geography,
        a_target: numberOrNull(ar.target),
        b_target: numberOrNull(br.target),
        a_final_estimate: ar.final_estimate ?? null,
        b_final_estimate: br.final_estimate ?? null,
        error_kind: errorKind,
        a_error: errorKind === "relative" ? aRelative : absoluteMiss(ar),
        b_error: errorKind === "relative" ? bRelative : absoluteMiss(br),
        a_relative_error: aRelative,
        b_relative_error: bRelative,
        a_within_tolerance: ar.within_tolerance ?? null,
        b_within_tolerance: br.within_tolerance ?? null,
        abs_rel_delta: delta,
      });
    } else if (ar) {
      removed += 1;
    } else {
      added += 1;
    }
  }
  common.sort(
    (x, y) =>
      Math.abs(numberOrNull(y.abs_rel_delta) ?? 0) -
      Math.abs(numberOrNull(x.abs_rel_delta) ?? 0),
  );

  const surfacesDiffer =
    a.rows.length !== b.rows.length || added > 0 || removed > 0;
  return {
    a: {
      release_id: a.release_id,
      description: a.description,
      total_targets: a.rows.length,
      initial_loss: a.initial_loss,
      final_loss: a.final_loss,
      loss_kind: a.loss_kind,
      fraction_within_10pct: a.fraction_within_10pct,
    },
    b: {
      release_id: b.release_id,
      description: b.description,
      total_targets: b.rows.length,
      initial_loss: b.initial_loss,
      final_loss: b.final_loss,
      loss_kind: b.loss_kind,
      fraction_within_10pct: b.fraction_within_10pct,
    },
    summary: {
      common: common.length,
      added,
      removed,
      improved,
      regressed,
      unchanged: common.length - improved - regressed,
      losses_comparable: !surfacesDiffer && a.loss_kind === b.loss_kind,
      loss_kind: a.loss_kind === b.loss_kind ? a.loss_kind : "mixed",
    },
    variables: comparisonVariableRows(common),
    rows: common,
  };
}

export async function loadComparison(
  aId: string,
  bId: string,
  revalidate: number,
  country: MicrocosmCountry = "us",
) {
  const [a, b] = await Promise.all([
    loadRelease(aId, revalidate, country),
    loadRelease(bId, revalidate, country),
  ]);
  return buildComparison(a, b);
}

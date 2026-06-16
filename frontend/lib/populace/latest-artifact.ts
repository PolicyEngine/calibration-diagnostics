import buildManifestData from "@/data/populace/latest/build_manifest.json";
import releaseManifestData from "@/data/populace/latest/release_manifest.json";
import latestPointerData from "@/data/populace/latest/latest.json";
import calibrationDiagnosticsData from "@/data/populace/latest/calibration_diagnostics.json";

type JsonObject = Record<string, unknown>;
type TargetRow = JsonObject;

// Target names are slash-joined strings under three conventions:
//   state/<source>/<variable>/.../<ABBR>,  nation/<source>/<variable>[/<dims>],
//   US<fips>/<metric>.
// parseTarget (below) reconstructs the structured constraint fields the registry
// knows but the published surface doesn't carry as columns yet — matching
// populace.dev's parse_target so both consumers agree. Declared above TARGET_ROWS
// because that initializer enriches every row at module load (no TDZ).
const FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};
const STATE_ABBRS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "US",
]);

// Breakdown-dimension value sets (hoisted above TARGET_ROWS for the same reason).
const FILING_MODIFIERS = new Set(["Surviving Spouse"]);
const FILING_STATUSES = new Set([
  "All", "Single", "Head of Household", "Married Filing Jointly",
  "Married Filing Separately", "Surviving Spouse",
]);
const RETURN_TYPES = new Set(["taxable", "all returns", "nontaxable"]);
const MEASURES = new Set(["total", "count", "mean", "filers", "nonfilers"]);

const BUILD_MANIFEST = buildManifestData as JsonObject;
const RELEASE_MANIFEST = releaseManifestData as JsonObject;
const LATEST_POINTER = latestPointerData as JsonObject;
const CALIBRATION_DIAGNOSTICS = calibrationDiagnosticsData as JsonObject;

export const LATEST_POPULACE_RELEASE_ID = String(
  BUILD_MANIFEST.build_id ?? LATEST_POINTER.release_id ?? "populace-us",
);
export const POPULACE_HF_REPO = process.env.POPULACE_HF_REPO ?? "policyengine/populace-us";
export const POPULACE_HF_REVISION = process.env.POPULACE_HF_REVISION ?? "main";
export const LATEST_POPULACE_BUILD_MANIFEST_PATH =
  "frontend/data/populace/latest/build_manifest.json";
export const LATEST_POPULACE_RELEASE_MANIFEST_PATH =
  "frontend/data/populace/latest/release_manifest.json";
export const LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH =
  "frontend/data/populace/latest/calibration_diagnostics.json";

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject).map(([key, item]) => [key, scrub(item)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function relativeError(estimate: number | null, target: number | null): number | null {
  if (estimate == null || target == null) return null;
  // The artifact's own convention: relative miss against the target, falling
  // back to the absolute miss when the target is zero (relative is undefined).
  return target === 0 ? estimate - target : (estimate - target) / Math.abs(target);
}

interface ParsedTarget {
  geography: string;
  level: string;
  source: string;
  variable: string;
  breakdown: string;
}

function parseTarget(name: string): ParsedTarget {
  const parts = name.split("/");
  const p0 = parts[0] ?? "";
  const fips = /^US(\d{2})$/.exec(p0);
  if (fips) {
    return {
      geography: FIPS_TO_ABBR[fips[1]] ?? p0,
      level: "state",
      source: "admin",
      variable: parts[1] ?? "",
      breakdown: parts.slice(2).join(" · "),
    };
  }
  if (p0 === "state") {
    const second = parts[1] ?? "";
    // state-keyed ("state/AL/adjusted_gross_income/..."): slot 2 is the state,
    // not a source. Group all states under one synthetic "state" source so the
    // 50 state codes don't masquerade as sources/variables.
    if (STATE_ABBRS.has(second) && second !== "US") {
      return {
        geography: second,
        level: "state",
        source: "state",
        variable: parts[2] ?? "",
        breakdown: parts.slice(3).join(" · "),
      };
    }
    const last = parts[parts.length - 1];
    // source-keyed with a trailing state ("state/census/rent/AK").
    if (parts.length >= 4 && STATE_ABBRS.has(last)) {
      return {
        geography: last,
        level: "state",
        source: parts[1] ?? "",
        variable: parts[2] ?? "",
        breakdown: parts.slice(3, -1).join(" · "),
      };
    }
    return {
      geography: "state",
      level: "state",
      source: parts[1] ?? "",
      variable: parts[2] ?? "",
      breakdown: parts.slice(3).join(" · "),
    };
  }
  if (p0 === "nation" || p0 === "national" || p0 === "us") {
    return {
      geography: "United States",
      level: "national",
      source: parts[1] ?? "",
      variable: parts[2] ?? "",
      breakdown: parts.slice(3).join(" · "),
    };
  }
  return {
    geography: "",
    level: "",
    source: p0,
    variable: parts[1] ?? "",
    breakdown: parts.slice(2).join(" · "),
  };
}

// The "thing" a constraint measures: source + variable (e.g. "irs / adjusted
// gross income"), the grouping key for the by-variable browser. The breakdown
// dimensions (income band, filing status, age, ...) hang off it.
function variableKeyOf(parsed: ParsedTarget): string {
  return [parsed.source, parsed.variable].filter(Boolean).join(" / ");
}

// The breakdown string is several typed dimensions joined by " · " (for AGI:
// measure · income band · return type · filing status). splitBreakdown merges
// filing-status modifiers ("... · Surviving Spouse") back into the status they
// qualify so a row's dimensions stay rectangular. (The value sets are hoisted
// to the top of the module — see near FIPS_TO_ABBR — so module-load enrichment
// can use them without a TDZ.)
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

// Name a dimension from the set of values it takes across a variable's rows.
function classifyDimension(values: string[]): string {
  const v = values.filter(Boolean);
  if (!v.length) return "Breakdown";
  const all = (pred: (s: string) => boolean) => v.every(pred);
  const firstStatus = (s: string) => s.split(" · ")[0];
  if (all((s) => s.startsWith("AGI in "))) return "Income band";
  if (all((s) => RETURN_TYPES.has(s))) return "Return type";
  if (all((s) => FILING_STATUSES.has(firstStatus(s)))) return "Filing status";
  if (all((s) => /^\d+$/.test(s))) return "Age";
  if (all((s) => MEASURES.has(s))) return "Measure";
  return "Breakdown";
}

// Sort a dimension's values: income bands by their lower bound, filing statuses
// with "All" first, everything else naturally.
function parseAmount(token: string): number {
  if (/^-?inf$/i.test(token)) return token.startsWith("-") ? -Infinity : Infinity;
  const negative = token.startsWith("-");
  const magnitude = parseFloat(token);
  if (!Number.isFinite(magnitude)) return 0;
  const mult = /k$/i.test(token) ? 1e3 : /m$/i.test(token) ? 1e6 : 1;
  return (negative ? -1 : 1) * Math.abs(magnitude) * mult;
}

function bandLowerBound(label: string): number {
  const body = label.replace(/^AGI in /, "");
  const match = /^(-?inf|-?\d+(?:\.\d+)?[km]?)-(-?inf|-?\d+(?:\.\d+)?[km]?)$/i.exec(body);
  return match ? parseAmount(match[1]) : 0;
}

function sortDimensionValues(label: string, values: string[]): string[] {
  if (label === "Income band") {
    return [...values].sort((a, b) => bandLowerBound(a) - bandLowerBound(b));
  }
  if (label === "Age") {
    return [...values].sort((a, b) => Number(a) - Number(b));
  }
  return [...values].sort((a, b) => {
    if (a === "All") return -1;
    if (b === "All") return 1;
    return a.localeCompare(b);
  });
}

export interface TargetDimension {
  key: string;
  label: string;
  values: string[];
}

// Resolve a facet key against a row. Keys are "geography", "level", or
// "dim<N>" (the Nth breakdown token).
function rowFacetValue(row: TargetRow, key: string): string | undefined {
  if (key === "geography") return (row.geography as string) || undefined;
  if (key === "level") return (row.level as string) || undefined;
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return (row.dims as string[] | undefined)?.[Number(dim[1])];
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function sortFacetValues(label: string, values: string[]): string[] {
  if (label === "Geography") {
    return [...values].sort((a, b) => {
      if (a === "United States") return -1;
      if (b === "United States") return 1;
      return a.localeCompare(b);
    });
  }
  return sortDimensionValues(label, values);
}

// Every axis along which a variable's targets vary, as filterable facets:
// geography, level, and each breakdown position. A facet is included only if it
// takes more than one value across the rows — a constant (e.g. AGI's "total"
// measure, or a single geography) is not variation, so it stays in the
// canonical detail rather than cluttering the facets.
function computeDimensions(rows: TargetRow[]): TargetDimension[] {
  const maxLen = rows.reduce(
    (max, row) => Math.max(max, (row.dims as string[] | undefined)?.length ?? 0),
    0,
  );
  const candidates: { key: string; label?: string }[] = [
    { key: "geography", label: "Geography" },
    { key: "level", label: "Level" },
  ];
  for (let i = 0; i < maxLen; i += 1) candidates.push({ key: `dim${i}` });

  const facets: TargetDimension[] = [];
  for (const candidate of candidates) {
    const values = [
      ...new Set(
        rows
          .map((row) => rowFacetValue(row, candidate.key))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (values.length <= 1) continue;
    const label = candidate.label ?? classifyDimension(values);
    facets.push({ key: candidate.key, label, values: sortFacetValues(label, values) });
  }
  return facets;
}

// Targets are named hierarchically (e.g. "nation/irs/...", "state/census/...",
// "state/AL/adjusted_gross_income/..."). Derive a coarse source family for
// filtering: national/state sources keep their source segment; the per-state
// distribution targets (2-letter state code in slot 2) collapse to one family.
function deriveFamily(name: string): string {
  const parts = name.split("/");
  if (parts.length < 2) return name;
  const [geo, second] = parts;
  // Per-state distribution targets ("state/AL/...") collapse to one family.
  if (/^[A-Z]{2}$/.test(second)) return "state_distribution";
  // Per-state-FIPS program targets ("US01/snap-cost") collapse to the measure
  // ("snap-cost") so all 51 states form one family, not 51.
  if (/^US\d{2}$/.test(geo)) return second;
  return `${geo}/${second}`;
}

function deriveState(name: string): string | null {
  const parts = name.split("/");
  return parts.length >= 2 && /^[A-Z]{2}$/.test(parts[1]) ? parts[1] : null;
}

function enrichTargetRow(row: TargetRow): TargetRow {
  const name = String(row.name ?? "");
  const target = numberOrNull(row.target);
  const initial = numberOrNull(row.initial_estimate);
  const final = numberOrNull(row.final_estimate);
  const finalRel = numberOrNull(row.relative_error) ?? relativeError(final, target);
  const initialRel = relativeError(initial, target);
  const absFinalRel = finalRel == null ? null : Math.abs(finalRel);
  // Did calibration help? Positive when the calibrated estimate is closer to
  // the target (in relative terms) than the design-weight estimate was.
  const improvement =
    initialRel == null || finalRel == null
      ? null
      : Math.abs(initialRel) - Math.abs(finalRel);
  const parsed = parseTarget(name);
  return {
    ...row,
    family: deriveFamily(name),
    state: deriveState(name),
    geography: parsed.geography,
    level: parsed.level,
    source: parsed.source,
    variable: parsed.variable,
    breakdown: parsed.breakdown,
    dims: splitBreakdown(parsed.breakdown),
    variable_key: variableKeyOf(parsed),
    initial_relative_error: initialRel,
    abs_relative_error: absFinalRel,
    improvement,
    direction:
      finalRel == null ? null : finalRel > 0 ? "over" : finalRel < 0 ? "under" : "exact",
  };
}

function stringParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function booleanParam(value: string | null): boolean | null {
  if (value == null || value === "") return null;
  if (["1", "true", "yes"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no"].includes(value.toLowerCase())) return false;
  return null;
}

function matchesSearch(row: TargetRow, search: string): boolean {
  const haystack = [row.name, row.variable, row.source, row.breakdown, row.geography, row.state]
    .filter((value) => value != null)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
}

// A calibration source — the meta plus the enriched per-target rows — built
// from either the live HF artifact or the committed snapshot, so every
// consumer below works the same on whichever the route resolved.
export interface Calibration {
  source: "huggingface_live" | "deployed_static_snapshot";
  release_id: string;
  schema_version: unknown;
  weight_entity: unknown;
  options: JsonObject;
  l0_lambda: number | null;
  n_nonzero: number | null;
  n_records: number | null;
  initial_loss: number | null;
  final_loss: number | null;
  fraction_within_10pct: number | null;
  loss_trajectory: number[];
  skipped: JsonObject[];
  rows: TargetRow[];
}

export function buildCalibration(
  raw: JsonObject,
  source: Calibration["source"],
): Calibration {
  const targets = Array.isArray(raw.targets) ? (raw.targets as TargetRow[]) : [];
  return {
    source,
    release_id: String(raw.release_id ?? LATEST_POPULACE_RELEASE_ID),
    schema_version: raw.schema_version ?? null,
    weight_entity: raw.weight_entity ?? null,
    options: asObject(raw.options),
    l0_lambda: numberOrNull(raw.l0_lambda),
    n_nonzero: numberOrNull(raw.n_nonzero),
    n_records: numberOrNull(raw.n_records),
    initial_loss: numberOrNull(raw.initial_loss),
    final_loss: numberOrNull(raw.final_loss),
    fraction_within_10pct: numberOrNull(raw.fraction_within_10pct),
    loss_trajectory: Array.isArray(raw.loss_trajectory)
      ? (raw.loss_trajectory as number[])
      : [],
    skipped: Array.isArray(raw.skipped) ? (raw.skipped as JsonObject[]) : [],
    rows: targets.map(enrichTargetRow),
  };
}

const SNAPSHOT_CALIBRATION = buildCalibration(
  CALIBRATION_DIAGNOSTICS,
  "deployed_static_snapshot",
);

export function snapshotCalibration(): Calibration {
  return SNAPSHOT_CALIBRATION;
}

export function hfResolveUrl(path: string): string {
  return `https://huggingface.co/datasets/${POPULACE_HF_REPO}/resolve/${POPULACE_HF_REVISION}/${path}`;
}

// Resolve the current release's calibration_diagnostics.json live via
// latest.json. Returns null on any failure so callers fall back to the
// committed snapshot.
export async function loadLiveCalibration(
  revalidate: number,
): Promise<{
  release_id: string;
  updated_at: unknown;
  paths: JsonObject;
  calibration: Calibration;
} | null> {
  try {
    const pointerRes = await fetch(hfResolveUrl("latest.json"), {
      next: { revalidate },
    });
    if (!pointerRes.ok) return null;
    const pointer = asObject(await pointerRes.json());
    const paths = asObject(pointer.paths);
    const diagPath =
      typeof paths.calibration_diagnostics === "string"
        ? paths.calibration_diagnostics
        : null;
    if (!diagPath) return null;
    const diagRes = await fetch(hfResolveUrl(diagPath), { next: { revalidate } });
    if (!diagRes.ok) return null;
    const diag = asObject(await diagRes.json());
    const calibration = buildCalibration(diag, "huggingface_live");
    // schema v2 carries no top-level release_id — take it from the pointer.
    if (!diag.release_id && pointer.release_id) {
      calibration.release_id = String(pointer.release_id);
    }
    return {
      release_id: String(pointer.release_id ?? ""),
      updated_at: pointer.updated_at ?? null,
      paths,
      calibration,
    };
  } catch {
    return null;
  }
}

export function populaceTargetFamilies(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.family ?? "")))].sort();
}

export function populaceTargetSources(rows: TargetRow[]): string[] {
  return [...new Set(rows.map((row) => String(row.source ?? "")))]
    .filter(Boolean)
    .sort();
}

// The by-variable browser: one row per "thing" (source / variable), with its
// breakdown count and calibration fit — the hierarchical entry point ("AGI"
// then its by-bracket / by-filing-status breakdowns).
export function populaceVariableSummary(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const key = String(row.variable_key ?? "");
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .map(([variable_key, group]) => {
      const first = group[0];
      const absErrors = group
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((value): value is number => value != null);
      return {
        variable_key,
        source: String(first.source ?? ""),
        variable: String(first.variable ?? ""),
        level: String(first.level ?? ""),
        n_targets: group.length,
        within_10pct: group.filter(
          (row) => (numberOrNull(row.abs_relative_error) ?? Infinity) <= 0.1,
        ).length,
        within_tolerance: group.filter((row) => row.within_tolerance === true).length,
        mean_abs_relative_error: absErrors.length
          ? absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length
          : null,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

function withinToleranceCount(rows: TargetRow[]): number {
  return rows.filter((row) => row.within_tolerance === true).length;
}

export function latestPopulaceBuildManifest(): JsonObject {
  return BUILD_MANIFEST;
}

export function latestPopulaceReleaseManifest(): JsonObject {
  return RELEASE_MANIFEST;
}

export function latestPopulacePointer(): JsonObject {
  return LATEST_POINTER;
}

// Per-family calibration fit: how well each source family is reproduced,
// computed from the per-target rows (replaces the eCPS family breakdown the
// retired comparison artifact used to carry).
function familyFitSummary(rows: TargetRow[]) {
  const groups = new Map<string, TargetRow[]>();
  for (const row of rows) {
    const family = String(row.family ?? "");
    const bucket = groups.get(family) ?? [];
    bucket.push(row);
    groups.set(family, bucket);
  }
  return [...groups.entries()]
    .map(([family, group]) => {
      const absErrors = group
        .map((row) => numberOrNull(row.abs_relative_error))
        .filter((value): value is number => value != null);
      const meanAbsError = absErrors.length
        ? absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length
        : null;
      return {
        family,
        n_targets: group.length,
        within_tolerance: withinToleranceCount(group),
        within_10pct: group.filter(
          (row) => (numberOrNull(row.abs_relative_error) ?? Infinity) <= 0.1,
        ).length,
        mean_abs_relative_error: meanAbsError,
      };
    })
    .sort((a, b) => b.n_targets - a.n_targets);
}

export function latestPopulaceCalibrationSummary(cal: Calibration = SNAPSHOT_CALIBRATION) {
  return {
    available: true,
    source: cal.source,
    path: LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH,
    release_id: cal.release_id,
    schema_version: cal.schema_version,
    weight_entity: cal.weight_entity,
    options: cal.options,
    l0_lambda: cal.l0_lambda,
    n_nonzero: cal.n_nonzero,
    n_records: cal.n_records,
    initial_loss: cal.initial_loss,
    final_loss: cal.final_loss,
    fraction_within_10pct: cal.fraction_within_10pct,
    loss_trajectory: cal.loss_trajectory,
    skipped: cal.skipped,
    total_targets: cal.rows.length,
    within_tolerance_count: withinToleranceCount(cal.rows),
    family_fit: familyFitSummary(cal.rows),
  };
}

function worstFit(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => numberOrNull(row.abs_relative_error) != null)
    .sort(
      (a, b) =>
        (numberOrNull(b.abs_relative_error) ?? 0) -
        (numberOrNull(a.abs_relative_error) ?? 0),
    )
    .slice(0, limit);
}

function biggestImprovements(rows: TargetRow[], limit: number): TargetRow[] {
  return [...rows]
    .filter((row) => numberOrNull(row.improvement) != null)
    .sort(
      (a, b) => (numberOrNull(b.improvement) ?? 0) - (numberOrNull(a.improvement) ?? 0),
    )
    .slice(0, limit);
}

export function latestPopulaceCalibrationHighlights(
  cal: Calibration = SNAPSHOT_CALIBRATION,
  limit = 15,
) {
  return {
    worst_fit: worstFit(cal.rows, limit),
    biggest_improvements: biggestImprovements(cal.rows, limit),
  };
}

export function latestPopulaceTargetDiagnosticsPage(
  requestUrl: string,
  cal: Calibration = SNAPSHOT_CALIBRATION,
) {
  const rows = cal.rows;
  const url = new URL(requestUrl);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "100") || 100, 1),
    500,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0") || 0, 0);
  const family = stringParam(url.searchParams.get("family"));
  const variable = stringParam(url.searchParams.get("variable"));
  const source = stringParam(url.searchParams.get("source"));
  const level = stringParam(url.searchParams.get("level"));
  const state = stringParam(url.searchParams.get("state"));
  const direction = stringParam(url.searchParams.get("direction"));
  const within = booleanParam(url.searchParams.get("within_tolerance"));
  const search = stringParam(url.searchParams.get("search"));
  const sortBy = stringParam(url.searchParams.get("sort_by")) ?? "abs_relative_error";
  const sortDir =
    stringParam(url.searchParams.get("sort_dir")) === "asc" ? "asc" : "desc";
  // Facet filters: repeated `facet=<key>:<value>` (key = geography|level|dim<N>).
  const facetFilters = url.searchParams
    .getAll("facet")
    .map((entry) => {
      const sep = entry.indexOf(":");
      return sep < 0 ? null : ([entry.slice(0, sep), entry.slice(sep + 1)] as const);
    })
    .filter((value): value is readonly [string, string] => value != null);

  let filtered = rows;
  if (family) filtered = filtered.filter((row) => row.family === family);
  if (variable) filtered = filtered.filter((row) => row.variable_key === variable);
  if (source) filtered = filtered.filter((row) => row.source === source);
  if (level) filtered = filtered.filter((row) => row.level === level);
  if (state) filtered = filtered.filter((row) => row.state === state);
  // Facets are derived from the variable's rows (before facet/within/direction/
  // search) so every option stays selectable.
  const dimensions = variable ? computeDimensions(filtered) : [];
  for (const [key, value] of facetFilters) {
    filtered = filtered.filter((row) => rowFacetValue(row, key) === value);
  }
  if (direction) filtered = filtered.filter((row) => row.direction === direction);
  if (within !== null)
    filtered = filtered.filter((row) => row.within_tolerance === within);
  if (search) filtered = filtered.filter((row) => matchesSearch(row, search));
  const dimSort = /^dim(\d+)$/.exec(sortBy);
  const sortValue = (row: TargetRow) =>
    dimSort ? (row.dims as string[] | undefined)?.[Number(dimSort[1])] : row[sortBy];
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
    source: cal.source,
    path: LATEST_POPULACE_CALIBRATION_DIAGNOSTICS_PATH,
    release_id: cal.release_id,
    schema_version: cal.schema_version,
    metric: "relative_error",
    families: populaceTargetFamilies(rows),
    sources: populaceTargetSources(rows),
    variables: populaceVariableSummary(rows),
    dimensions,
    summary: {
      total_targets: rows.length,
      within_tolerance_count: withinToleranceCount(rows),
      fraction_within_10pct: cal.fraction_within_10pct,
    },
    total_targets: rows.length,
    filtered_total: filtered.length,
    returned: filtered.slice(offset, offset + limit).length,
    limit,
    offset,
    has_next: offset + limit < filtered.length,
    display_limit: limit,
    targets: filtered.slice(offset, offset + limit),
    filters: {
      family,
      variable,
      source,
      level,
      state,
      direction,
      within_tolerance: within,
      search,
      sort_by: sortBy,
      sort_dir: sortDir,
    },
  };
}

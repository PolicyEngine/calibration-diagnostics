// Reform-coverage board data layer. Three artifacts answer "what inputs does
// this release actually carry, and which reforms score vs silently default":
//
//   us_source_coverage.json   — PUBLISHED on main today. Per source family, the
//                               package aliases the release is required to cover,
//                               which it covers, and which are carried as reviewed
//                               fiscal-refresh exclusions (each naming its issue).
//   input_coverage.json       — populace#369, the per-column eCPS coverage gate.
//                               Not published on today's releases (RED-by-design
//                               until the SCF asset stage lands) — rendered as a
//                               graceful "not published" state until it ships.
//   reform_coverage_smoke.json— populace#368, the pinned reform probes that must
//                               score nonzero where the policy mechanically binds
//                               (first probe: SSI asset limits $10k/$20k, the
//                               scores-$0 failure class). Also not yet published.
//
// Everything reads live from Hugging Face. Missing is an expected state, not a
// transport error, so each loader distinguishes the two.

import {
  asObject,
  assertSafeReleaseId,
  hfResolveUrl,
  loadPointerReleaseId,
  type PopulaceCountry,
} from "./latest-artifact";
import { extractIssueRefs, type IssueRef } from "./issue-links";

type JsonObject = Record<string, unknown>;

export const US_SOURCE_COVERAGE_FILE = "us_source_coverage.json";
export const INPUT_COVERAGE_FILE = "input_coverage.json";
export const REFORM_SMOKE_FILE = "reform_coverage_smoke.json";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

// 404 is "not published for this release" (an expected state); any other
// non-OK is an upstream failure the caller should see.
async function fetchReleaseArtifact(
  releaseId: string,
  filename: string,
  revalidate: number,
  country: PopulaceCountry,
): Promise<JsonObject | null> {
  const url = hfResolveUrl(`releases/${assertSafeReleaseId(releaseId)}/${filename}`, country);
  const res = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HF fetch failed ${res.status}: ${url}`);
  return asObject(await res.json());
}

async function resolveReleaseId(
  releaseId: string,
  revalidate: number,
  country: PopulaceCountry,
): Promise<string> {
  if (releaseId && releaseId !== "latest") return releaseId;
  return (await loadPointerReleaseId(revalidate, country)).release_id;
}

// --- reviewed exclusions ----------------------------------------------------

export interface CoverageExclusion {
  subject: string; // the package alias / column / record the exclusion covers
  reason: string;
  issues: IssueRef[]; // tracking issues parsed from the reason text
}

// A {subject: reason} map into structured exclusions with their linked issues.
export function exclusionsFromMap(map: unknown): CoverageExclusion[] {
  return Object.entries(asObject(map))
    .map(([subject, reason]) => ({
      subject,
      reason: typeof reason === "string" ? reason : String(reason),
      issues: extractIssueRefs(typeof reason === "string" ? reason : ""),
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

// --- us_source_coverage.json (published) ------------------------------------

export type FamilyCoverageState = "covered" | "partial" | "excluded" | "missing";

export interface HardTargetFamily {
  key: string;
  label: string;
  required: string[];
  covered: string[];
  missing: string[];
  reviewed_exclusions: CoverageExclusion[];
  state: FamilyCoverageState;
}

export interface ValidationOnlyFamily {
  key: string;
  label: string;
  required: string[];
  activated: boolean;
}

export interface SourceGapFamily {
  key: string;
  label: string;
  missing_source_packages: string[];
}

export interface SourceCoverage {
  available: true;
  release_id: string;
  schema_version: unknown;
  classification: string | null;
  gate: { name: string | null; passed: boolean | null; failures: string[] };
  ledger_commit: string | null;
  summary: {
    hard_target_families: number;
    required_aliases: number;
    covered_aliases: number;
    missing_aliases: number;
    reviewed_excluded_aliases: number;
    validation_only_families: number;
    validation_only_activated: number;
    source_gap_families: number;
    missing_source_packages: number;
  };
  hard_target_families: HardTargetFamily[];
  validation_only_families: ValidationOnlyFamily[];
  source_gap_families: SourceGapFamily[];
  reviewed_exclusions: CoverageExclusion[];
  fiscal_support_exclusions: CoverageExclusion[];
  artifact: { path: string; url: string };
}

export interface CoverageMissing {
  available: false;
  release_id: string;
  reason: string;
  expected_path: string;
}

function familyState(family: HardTargetFamily): FamilyCoverageState {
  if (family.missing.length > 0) return "missing";
  if (family.reviewed_exclusions.length > 0 && family.covered.length === 0) {
    return "excluded";
  }
  if (family.reviewed_exclusions.length > 0) return "partial";
  return "covered";
}

export function buildSourceCoverage(
  raw: JsonObject,
  releaseId: string,
  country: PopulaceCountry,
): SourceCoverage {
  const summary = asObject(raw.coverage_summary);
  const hardSummary = asObject(summary.hard_target);
  const validationSummary = asObject(summary.validation_only);
  const gapSummary = asObject(summary.source_gap);
  const gate = asObject(raw.gate);

  const hardTargetFamilies: HardTargetFamily[] = Object.entries(
    asObject(raw.hard_target_families),
  )
    .map(([key, value]) => {
      const family = asObject(value);
      const partial: HardTargetFamily = {
        key,
        label: stringOrNull(family.label) ?? key,
        required: stringArray(family.package_aliases),
        covered: stringArray(family.covered_package_aliases),
        missing: stringArray(family.missing_package_aliases),
        reviewed_exclusions: exclusionsFromMap(family.reviewed_exclusions),
        state: "covered",
      };
      return { ...partial, state: familyState(partial) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const validationOnlyFamilies: ValidationOnlyFamily[] = Object.entries(
    asObject(raw.validation_only_families),
  )
    .map(([key, value]) => {
      const family = asObject(value);
      return {
        key,
        label: stringOrNull(family.label) ?? key,
        required: stringArray(family.package_aliases),
        activated: family.activated_as_hard_target === true,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const sourceGapFamilies: SourceGapFamily[] = Object.entries(
    asObject(raw.source_gap_families),
  )
    .map(([key, value]) => {
      const family = asObject(value);
      return {
        key,
        label: stringOrNull(family.label) ?? key,
        missing_source_packages: stringArray(family.missing_source_packages),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const fiscalSupport = Array.isArray(raw.fiscal_target_support_exclusions)
    ? (raw.fiscal_target_support_exclusions as JsonObject[]).map((entry) => {
        const row = asObject(entry);
        const reason = stringOrNull(row.reason) ?? "";
        return {
          subject: stringOrNull(row.source_record_id) ?? "—",
          reason,
          issues: extractIssueRefs(reason),
        };
      })
    : [];

  const path = `releases/${releaseId}/${US_SOURCE_COVERAGE_FILE}`;
  return {
    available: true,
    release_id: releaseId,
    schema_version: raw.schema_version ?? null,
    classification: stringOrNull(raw.classification),
    gate: {
      name: stringOrNull(gate.name),
      passed: typeof gate.passed === "boolean" ? gate.passed : null,
      failures: stringArray(gate.failures),
    },
    ledger_commit: stringOrNull(asObject(raw.source_contract).ledger_commit),
    summary: {
      hard_target_families: numberOrNull(hardSummary.families) ?? hardTargetFamilies.length,
      required_aliases: numberOrNull(hardSummary.package_aliases) ?? 0,
      covered_aliases: numberOrNull(hardSummary.covered_package_aliases) ?? 0,
      missing_aliases: numberOrNull(hardSummary.missing_package_aliases) ?? 0,
      reviewed_excluded_aliases:
        numberOrNull(hardSummary.reviewed_excluded_package_aliases) ?? 0,
      validation_only_families:
        numberOrNull(validationSummary.families) ?? validationOnlyFamilies.length,
      validation_only_activated: numberOrNull(validationSummary.activated_families) ?? 0,
      source_gap_families: numberOrNull(gapSummary.families) ?? sourceGapFamilies.length,
      missing_source_packages: numberOrNull(gapSummary.missing_source_packages) ?? 0,
    },
    hard_target_families: hardTargetFamilies,
    validation_only_families: validationOnlyFamilies,
    source_gap_families: sourceGapFamilies,
    reviewed_exclusions: exclusionsFromMap(raw.reviewed_exclusions),
    fiscal_support_exclusions: fiscalSupport,
    artifact: { path, url: hfResolveUrl(path, country) },
  };
}

export async function loadSourceCoverage(
  releaseId: string,
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<SourceCoverage | CoverageMissing> {
  const id = await resolveReleaseId(releaseId, revalidate, country);
  const raw = await fetchReleaseArtifact(id, US_SOURCE_COVERAGE_FILE, revalidate, country);
  if (!raw) {
    return {
      available: false,
      release_id: id,
      reason: `No ${US_SOURCE_COVERAGE_FILE} published for this release yet.`,
      expected_path: `releases/${id}/${US_SOURCE_COVERAGE_FILE}`,
    };
  }
  return buildSourceCoverage(raw, id, country);
}

// --- input_coverage.json (populace#369, forward-compatible) -----------------

export interface InputColumn {
  column: string;
  present: boolean | null;
  degenerate: boolean | null;
  reason: string | null;
  issues: IssueRef[];
}

export interface InputColumnCoverage {
  available: true;
  release_id: string;
  enforced: boolean | null;
  gate: { passed: boolean | null; failures: string[] };
  summary: { required: number; reviewed_exclusion: number; failing: number };
  required: InputColumn[];
  reviewed_exclusions: InputColumn[];
  artifact: { path: string; url: string };
}

// Permissive normalizer: #369 fixes the exact field names, but the board only
// needs column / present / degenerate / reason, under whichever nesting ships.
function normalizeColumn(value: unknown): InputColumn {
  const row = asObject(value);
  const reason = stringOrNull(row.reason) ?? stringOrNull(row.note);
  return {
    column: stringOrNull(row.column) ?? stringOrNull(row.name) ?? "—",
    present: typeof row.present === "boolean" ? row.present : null,
    degenerate:
      typeof row.degenerate === "boolean"
        ? row.degenerate
        : typeof row.constant_at_default === "boolean"
          ? row.constant_at_default
          : null,
    reason,
    issues: extractIssueRefs(reason ?? ""),
  };
}

export function buildInputColumnCoverage(
  raw: JsonObject,
  releaseId: string,
  country: PopulaceCountry,
): InputColumnCoverage {
  const columns = asObject(raw.columns);
  const requiredRaw = Array.isArray(raw.required)
    ? raw.required
    : Array.isArray(columns.required)
      ? columns.required
      : [];
  const exclusionRaw = Array.isArray(raw.reviewed_exclusions)
    ? raw.reviewed_exclusions
    : Array.isArray(columns.reviewed_exclusion)
      ? columns.reviewed_exclusion
      : [];
  const required = requiredRaw.map(normalizeColumn);
  const reviewed = exclusionRaw.map(normalizeColumn);
  const gate = asObject(raw.gate);
  const failing = required.filter((c) => c.present === false || c.degenerate === true).length;
  const path = `releases/${releaseId}/${INPUT_COVERAGE_FILE}`;
  return {
    available: true,
    release_id: releaseId,
    enforced: typeof raw.enforced === "boolean" ? raw.enforced : null,
    gate: {
      passed: typeof gate.passed === "boolean" ? gate.passed : null,
      failures: stringArray(gate.failures),
    },
    summary: {
      required: required.length,
      reviewed_exclusion: reviewed.length,
      failing,
    },
    required,
    reviewed_exclusions: reviewed,
    artifact: { path, url: hfResolveUrl(path, country) },
  };
}

export async function loadInputColumnCoverage(
  releaseId: string,
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<InputColumnCoverage | CoverageMissing> {
  const id = await resolveReleaseId(releaseId, revalidate, country);
  const raw = await fetchReleaseArtifact(id, INPUT_COVERAGE_FILE, revalidate, country);
  if (!raw) {
    return {
      available: false,
      release_id: id,
      reason: `No ${INPUT_COVERAGE_FILE} published for this release yet (populace#369 — the per-column eCPS coverage gate).`,
      expected_path: `releases/${id}/${INPUT_COVERAGE_FILE}`,
    };
  }
  return buildInputColumnCoverage(raw, id, country);
}

// --- reform_coverage_smoke.json (populace#368, forward-compatible) ----------

export interface ReformProbe {
  name: string;
  reform: string | null;
  scored_value: number | null;
  verdict: "scored" | "zero" | "unknown";
  passed: boolean | null;
  description: string | null;
  issues: IssueRef[];
}

export interface ReformSmoke {
  available: true;
  release_id: string;
  enforced: boolean | null;
  gate: { passed: boolean | null; failures: string[] };
  summary: { probes: number; scored: number; zero: number };
  probes: ReformProbe[];
  artifact: { path: string; url: string };
}

function scoredValueOf(row: JsonObject): number | null {
  return (
    numberOrNull(row.scored_value) ??
    numberOrNull(row.budget_effect) ??
    numberOrNull(row.value) ??
    numberOrNull(row.score) ??
    null
  );
}

function probeVerdict(row: JsonObject, scored: number | null): ReformProbe["verdict"] {
  const explicit = stringOrNull(row.verdict) ?? stringOrNull(row.band) ?? stringOrNull(row.status);
  if (explicit) {
    const v = explicit.toLowerCase();
    if (v.includes("zero") || v.includes("default") || v.includes("fail")) return "zero";
    if (v.includes("scored") || v.includes("nonzero") || v.includes("pass")) return "scored";
  }
  if (typeof row.passed === "boolean") return row.passed ? "scored" : "zero";
  if (scored != null) return Math.abs(scored) > 0 ? "scored" : "zero";
  return "unknown";
}

function normalizeProbe(value: unknown): ReformProbe {
  const row = asObject(value);
  const scored = scoredValueOf(row);
  const description = stringOrNull(row.description) ?? stringOrNull(row.reason);
  const issueText = [description, stringOrNull(row.issue)].filter(Boolean).join(" ");
  return {
    name: stringOrNull(row.name) ?? stringOrNull(row.id) ?? stringOrNull(row.reform) ?? "—",
    reform: stringOrNull(row.reform) ?? stringOrNull(row.id),
    scored_value: scored,
    verdict: probeVerdict(row, scored),
    passed: typeof row.passed === "boolean" ? row.passed : null,
    description,
    issues: extractIssueRefs(issueText),
  };
}

export function buildReformSmoke(
  raw: JsonObject,
  releaseId: string,
  country: PopulaceCountry,
): ReformSmoke {
  const list = Array.isArray(raw.probes)
    ? raw.probes
    : Array.isArray(raw.reforms)
      ? raw.reforms
      : [];
  const probes = list.map(normalizeProbe);
  const gate = asObject(raw.gate);
  const path = `releases/${releaseId}/${REFORM_SMOKE_FILE}`;
  return {
    available: true,
    release_id: releaseId,
    enforced: typeof raw.enforced === "boolean" ? raw.enforced : null,
    gate: {
      passed: typeof gate.passed === "boolean" ? gate.passed : null,
      failures: stringArray(gate.failures),
    },
    summary: {
      probes: probes.length,
      scored: probes.filter((p) => p.verdict === "scored").length,
      zero: probes.filter((p) => p.verdict === "zero").length,
    },
    probes,
    artifact: { path, url: hfResolveUrl(path, country) },
  };
}

export async function loadReformSmoke(
  releaseId: string,
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<ReformSmoke | CoverageMissing> {
  const id = await resolveReleaseId(releaseId, revalidate, country);
  const raw = await fetchReleaseArtifact(id, REFORM_SMOKE_FILE, revalidate, country);
  if (!raw) {
    return {
      available: false,
      release_id: id,
      reason: `No ${REFORM_SMOKE_FILE} published for this release yet (populace#368 — the reform-coverage smoke that fails a bound reform scoring $0).`,
      expected_path: `releases/${id}/${REFORM_SMOKE_FILE}`,
    };
  }
  return buildReformSmoke(raw, id, country);
}

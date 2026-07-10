// Release-delta computation — the consumer-facing "which of my numbers moved,
// by how much, and is that move beyond its declared band" (populace#366's
// question, computed from what is on main today). One pure function feeds three
// surfaces: the Slack alert, the /api/populace/deltas/latest feed, and the
// in-page "since you last looked" banner.
//
// Bands (per metric family) live in delta-bands.json so thresholds are
// configuration, not code. A move beyond its band is what turns the alert loud.

import {
  buildComparison,
  loadPointerReleaseId,
  loadRelease,
  loadReleases,
  type Calibration,
  type PopulaceCountry,
} from "./latest-artifact";
import {
  loadReformValidation,
  type ReformValidation,
  type ReformValidationMissing,
} from "./reforms";
import { buildCertification, type Certification, type SideGateInput } from "./certification";
import { loadSourceCoverage, type SourceCoverage, type CoverageMissing } from "./coverage";
import bandConfig from "./delta-bands.json";

export interface MetricBand {
  family: string;
  abs?: number;
  rel?: number;
}
export type BandConfig = Record<string, MetricBand>;

// The JSON carries a leading _comment key for maintainers; drop it.
export const DELTA_BANDS: BandConfig = Object.fromEntries(
  Object.entries(bandConfig as Record<string, unknown>).filter(
    ([key, value]) => key !== "_comment" && typeof value === "object" && value != null,
  ),
) as BandConfig;

export type BandVerdict = "within" | "beyond" | null;
export type MetricUnit = "loss" | "share" | "count";
export type ImproveDirection = "better" | "worse" | "flat" | null;

export interface MetricDelta {
  key: string;
  label: string;
  family: string | null;
  unit: MetricUnit;
  a: number | null;
  b: number | null;
  abs_delta: number | null;
  rel_delta: number | null;
  improve: ImproveDirection;
  band: BandVerdict;
  threshold: number | null;
  comparable: boolean;
  note: string | null;
}

export interface ReformDelta {
  id: string;
  name: string;
  category: string | null;
  in_sample: boolean;
  a_abs_rel: number | null;
  b_abs_rel: number | null;
  delta: number | null; // b − a change in |error|; negative = improving
  band: BandVerdict;
}

export interface CoverageDelta {
  a_covered: number;
  b_covered: number;
  a_missing: number;
  b_missing: number;
  a_reviewed_excluded: number;
  b_reviewed_excluded: number;
  shrank: boolean;
}

export interface GateChange {
  key: string;
  label: string;
  a_outcome: string;
  b_outcome: string;
  kind: "waived" | "skipped" | "regressed";
}

export interface DeltaReport {
  available: true;
  a_release: string;
  b_release: string;
  a_date: string;
  b_date: string;
  generated_at: string;
  headline: MetricDelta[];
  reforms: ReformDelta[];
  reforms_available: boolean;
  surfaces_differ: boolean;
  surface: { added: number; removed: number; improved: number; regressed: number };
  coverage_delta: CoverageDelta | null;
  gate_changes: GateChange[];
  flags: string[];
  top_movers: MetricDelta[];
  bands: BandConfig;
}

interface HeadlineSpec {
  key: string;
  label: string;
  unit: MetricUnit;
  improveIsLower: boolean | null;
  needsComparable?: boolean;
  get: (cal: Calibration) => number | null;
}

const HEADLINE_SPECS: HeadlineSpec[] = [
  {
    key: "final_loss",
    label: "Calibration loss",
    unit: "loss",
    improveIsLower: true,
    needsComparable: true,
    get: (cal) => cal.final_loss,
  },
  {
    key: "fraction_within_10pct",
    label: "Within 10% of target",
    unit: "share",
    improveIsLower: false,
    get: (cal) => cal.fraction_within_10pct,
  },
  {
    key: "n_nonzero",
    label: "Records kept",
    unit: "count",
    improveIsLower: null,
    get: (cal) => cal.n_nonzero,
  },
  {
    key: "included_target_count",
    label: "Targets included",
    unit: "count",
    improveIsLower: null,
    get: (cal) => cal.included_target_count,
  },
];

const EPSILON = 1e-9;

function relDelta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  if (Math.abs(a) < EPSILON) return null;
  return (b - a) / Math.abs(a);
}

function bandVerdict(
  key: string,
  absDelta: number | null,
  rel: number | null,
  bands: BandConfig,
): { band: BandVerdict; threshold: number | null } {
  const band = bands[key];
  if (!band || absDelta == null) return { band: null, threshold: null };
  const absBeyond = band.abs != null && Math.abs(absDelta) > band.abs;
  const relBeyond = band.rel != null && rel != null && Math.abs(rel) > band.rel;
  const threshold = band.abs ?? band.rel ?? null;
  return { band: absBeyond || relBeyond ? "beyond" : "within", threshold };
}

function improveOf(spec: HeadlineSpec, absDelta: number | null): ImproveDirection {
  if (absDelta == null) return null;
  if (spec.improveIsLower == null) return null;
  if (Math.abs(absDelta) < EPSILON) return "flat";
  const lower = absDelta < 0;
  return spec.improveIsLower === lower ? "better" : "worse";
}

function reformRows(
  validation: ReformValidation | ReformValidationMissing | null | undefined,
): Map<string, { name: string; category: string | null; in_sample: boolean; absRel: number | null }> {
  const map = new Map<
    string,
    { name: string; category: string | null; in_sample: boolean; absRel: number | null }
  >();
  if (!validation || !validation.available) return map;
  for (const row of validation.rows) {
    map.set(row.id, {
      name: row.name,
      category: row.category,
      in_sample: row.in_sample,
      absRel: row.abs_relative_error,
    });
  }
  return map;
}

function computeReformDeltas(
  reformA: ReformValidation | ReformValidationMissing | null | undefined,
  reformB: ReformValidation | ReformValidationMissing | null | undefined,
  bands: BandConfig,
): ReformDelta[] {
  const a = reformRows(reformA);
  const b = reformRows(reformB);
  const band = bands.reform_validation;
  const rows: ReformDelta[] = [];
  for (const [id, br] of b) {
    const ar = a.get(id);
    const delta =
      ar?.absRel != null && br.absRel != null ? br.absRel - ar.absRel : null;
    const verdict: BandVerdict =
      delta == null || !band || band.abs == null
        ? null
        : Math.abs(delta) > band.abs
          ? "beyond"
          : "within";
    rows.push({
      id,
      name: br.name,
      category: br.category,
      in_sample: br.in_sample,
      a_abs_rel: ar?.absRel ?? null,
      b_abs_rel: br.absRel,
      delta,
      band: verdict,
    });
  }
  // Worst regressions first (largest positive delta), then largest movers.
  return rows.sort((x, y) => (y.delta ?? -Infinity) - (x.delta ?? -Infinity));
}

function coverageOf(
  cov: SourceCoverage | CoverageMissing | null | undefined,
): { covered: number; missing: number; reviewed: number } | null {
  if (!cov || !cov.available) return null;
  return {
    covered: cov.summary.covered_aliases,
    missing: cov.summary.missing_aliases,
    reviewed: cov.summary.reviewed_excluded_aliases,
  };
}

function computeCoverageDelta(
  coverageA: SourceCoverage | CoverageMissing | null | undefined,
  coverageB: SourceCoverage | CoverageMissing | null | undefined,
): CoverageDelta | null {
  const a = coverageOf(coverageA);
  const b = coverageOf(coverageB);
  if (!a || !b) return null;
  return {
    a_covered: a.covered,
    b_covered: b.covered,
    a_missing: a.missing,
    b_missing: b.missing,
    a_reviewed_excluded: a.reviewed,
    b_reviewed_excluded: b.reviewed,
    shrank: b.covered < a.covered || b.missing > a.missing,
  };
}

function computeGateChanges(
  certA: Certification | null | undefined,
  certB: Certification | null | undefined,
): GateChange[] {
  if (!certA || !certB) return [];
  const aByKey = new Map(certA.gates.map((g) => [`${g.source}:${g.key}`, g]));
  const changes: GateChange[] = [];
  for (const gate of certB.gates) {
    const prior = aByKey.get(`${gate.source}:${gate.key}`);
    if (!prior) continue;
    if (prior.outcome === gate.outcome) continue;
    // Only surface losses of assurance: a gate that used to pass and is now
    // waived, skipped, or failing.
    if (prior.outcome === "passed" && gate.outcome === "waived") {
      changes.push({ key: gate.key, label: gate.label, a_outcome: prior.outcome, b_outcome: gate.outcome, kind: "waived" });
    } else if (prior.outcome === "passed" && gate.outcome === "skipped") {
      changes.push({ key: gate.key, label: gate.label, a_outcome: prior.outcome, b_outcome: gate.outcome, kind: "skipped" });
    } else if (prior.outcome === "passed" && gate.outcome === "failed") {
      changes.push({ key: gate.key, label: gate.label, a_outcome: prior.outcome, b_outcome: gate.outcome, kind: "regressed" });
    }
  }
  return changes;
}

function moverMagnitude(metric: MetricDelta): number {
  if (metric.unit === "count") return Math.abs(metric.rel_delta ?? 0);
  return Math.abs(metric.abs_delta ?? 0);
}

export interface ComputeDeltaInput {
  a: Calibration;
  b: Calibration;
  reformA?: ReformValidation | ReformValidationMissing | null;
  reformB?: ReformValidation | ReformValidationMissing | null;
  certA?: Certification | null;
  certB?: Certification | null;
  coverageA?: SourceCoverage | CoverageMissing | null;
  coverageB?: SourceCoverage | CoverageMissing | null;
  bands?: BandConfig;
  now?: Date;
}

function releaseDate(id: string): string {
  return id.match(/(\d{8}(?:T\d{6}Z)?)$/)?.[1] ?? "";
}

export function computeReleaseDelta(input: ComputeDeltaInput): DeltaReport {
  const { a, b } = input;
  const bands = input.bands ?? DELTA_BANDS;
  const comparison = buildComparison(a, b);
  const surfacesDiffer =
    a.rows.length !== b.rows.length ||
    comparison.summary.added > 0 ||
    comparison.summary.removed > 0;
  const lossesComparable = comparison.summary.losses_comparable;

  const headline: MetricDelta[] = HEADLINE_SPECS.map((spec) => {
    const av = spec.get(a);
    const bv = spec.get(b);
    const absDelta = av != null && bv != null ? bv - av : null;
    const rel = relDelta(av, bv);
    const comparable = spec.needsComparable ? lossesComparable : true;
    const verdict = comparable
      ? bandVerdict(spec.key, absDelta, rel, bands)
      : { band: null as BandVerdict, threshold: bands[spec.key]?.abs ?? null };
    return {
      key: spec.key,
      label: spec.label,
      family: bands[spec.key]?.family ?? null,
      unit: spec.unit,
      a: av,
      b: bv,
      abs_delta: absDelta,
      rel_delta: rel,
      improve: improveOf(spec, absDelta),
      band: verdict.band,
      threshold: verdict.threshold,
      comparable,
      note:
        spec.needsComparable && !comparable
          ? "Loss is not directly comparable across releases that calibrate to different target surfaces."
          : null,
    };
  });

  const reforms = computeReformDeltas(input.reformA, input.reformB, bands);
  const reformsAvailable =
    !!input.reformA && input.reformA.available && !!input.reformB && input.reformB.available;
  const coverageDelta = computeCoverageDelta(input.coverageA, input.coverageB);
  const gateChanges = computeGateChanges(input.certA, input.certB);

  const flags: string[] = [];
  for (const metric of headline) {
    if (metric.band === "beyond") {
      flags.push(
        `${metric.label} moved ${fmtMetric(metric.a, metric.unit)} → ${fmtMetric(metric.b, metric.unit)} (Δ ${fmtDelta(metric)}), beyond its ${fmtThreshold(metric)} band.`,
      );
    }
  }
  if (surfacesDiffer) {
    flags.push(
      `Target surface changed: +${comparison.summary.added} added, −${comparison.summary.removed} removed — loss not directly comparable.`,
    );
  }
  if (coverageDelta?.shrank) {
    flags.push(
      `Source coverage shrank: covered ${coverageDelta.a_covered} → ${coverageDelta.b_covered}, missing ${coverageDelta.a_missing} → ${coverageDelta.b_missing}.`,
    );
  }
  for (const change of gateChanges) {
    flags.push(`Gate "${change.label}" ${change.a_outcome} → ${change.b_outcome}.`);
  }
  for (const reform of reforms) {
    if (reform.band === "beyond" && reform.delta != null) {
      flags.push(
        `Reform "${reform.name}" |error| ${fmtPct(reform.a_abs_rel)} → ${fmtPct(reform.b_abs_rel)} (Δ ${reform.delta > 0 ? "+" : ""}${fmtPct(reform.delta)}).`,
      );
    }
  }

  const topMovers = [...headline]
    .filter((m) => m.abs_delta != null && Math.abs(m.abs_delta) > EPSILON)
    .sort((x, y) => {
      const beyond = Number(y.band === "beyond") - Number(x.band === "beyond");
      return beyond || moverMagnitude(y) - moverMagnitude(x);
    });

  return {
    available: true,
    a_release: a.release_id,
    b_release: b.release_id,
    a_date: releaseDate(a.release_id),
    b_date: releaseDate(b.release_id),
    generated_at: (input.now ?? new Date()).toISOString(),
    headline,
    reforms,
    reforms_available: reformsAvailable,
    surfaces_differ: surfacesDiffer,
    surface: {
      added: comparison.summary.added,
      removed: comparison.summary.removed,
      improved: comparison.summary.improved,
      regressed: comparison.summary.regressed,
    },
    coverage_delta: coverageDelta,
    gate_changes: gateChanges,
    flags,
    top_movers: topMovers,
    bands,
  };
}

// --- formatting (pure, dependency-free for the CLI/Slack path) --------------

function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function fmtCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

function fmtLoss(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) < 1) return value.toFixed(value < 0.001 ? 6 : 4);
  return value.toExponential(2).replace("e+", "e");
}

function fmtMetric(value: number | null, unit: MetricUnit): string {
  if (unit === "share") return fmtPct(value);
  if (unit === "count") return fmtCount(value);
  return fmtLoss(value);
}

function fmtDelta(metric: MetricDelta): string {
  if (metric.abs_delta == null) return "—";
  const sign = metric.abs_delta > 0 ? "+" : "";
  if (metric.unit === "share") return `${sign}${(metric.abs_delta * 100).toFixed(1)}pp`;
  if (metric.unit === "count") {
    return `${sign}${fmtCount(metric.abs_delta)}${metric.rel_delta != null ? ` (${sign}${(metric.rel_delta * 100).toFixed(1)}%)` : ""}`;
  }
  return `${sign}${fmtLoss(metric.abs_delta)}`;
}

function fmtThreshold(metric: MetricDelta): string {
  if (metric.threshold == null) return "—";
  if (metric.unit === "share") return `${(metric.threshold * 100).toFixed(0)}pp`;
  if (metric.unit === "count") return `${(metric.threshold * 100).toFixed(0)}%`;
  return String(metric.threshold);
}

function padEnd(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}
function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

// A monospace text table for the CLI and the Slack code block.
export function formatDeltaTable(report: DeltaReport): string {
  const lines: string[] = [];
  const bandMark = (band: BandVerdict) => (band === "beyond" ? "  ⚠ beyond" : band === "within" ? "  ok" : "");
  const cols = [22, 12, 12, 16];
  lines.push(
    padEnd("metric", cols[0]) +
      padStart("previous", cols[1]) +
      padStart("latest", cols[2]) +
      padStart("Δ", cols[3]),
  );
  lines.push("-".repeat(cols.reduce((s, c) => s + c, 0) + 10));
  for (const metric of report.headline) {
    lines.push(
      padEnd(metric.label, cols[0]) +
        padStart(fmtMetric(metric.a, metric.unit), cols[1]) +
        padStart(fmtMetric(metric.b, metric.unit), cols[2]) +
        padStart(fmtDelta(metric), cols[3]) +
        (metric.comparable ? bandMark(metric.band) : "  (not comparable)"),
    );
  }
  if (report.reforms_available && report.reforms.length) {
    lines.push("");
    lines.push("reform validation (|error| change, − = improving):");
    for (const reform of report.reforms.slice(0, 8)) {
      lines.push(
        padEnd(`  ${reform.name}`, cols[0] + 2) +
          padStart(fmtPct(reform.a_abs_rel), cols[1]) +
          padStart(fmtPct(reform.b_abs_rel), cols[2]) +
          padStart(reform.delta == null ? "—" : `${reform.delta > 0 ? "+" : ""}${fmtPct(reform.delta)}`, cols[3]) +
          bandMark(reform.band),
      );
    }
  }
  if (report.flags.length) {
    lines.push("");
    lines.push("flags:");
    for (const flag of report.flags) lines.push(`  • ${flag}`);
  } else {
    lines.push("");
    lines.push("flags: none — every tracked metric moved within its band.");
  }
  return lines.join("\n");
}

// Slack incoming-webhook payload (text + blocks). The dashboard URL deep-links
// to the compare view for the two releases.
export function deltaSlackPayload(
  report: DeltaReport,
  opts: { dashboardUrl?: string; country?: string } = {},
): { text: string; blocks: unknown[] } {
  const loud = report.flags.length > 0;
  const country = (opts.country ?? "us").toUpperCase();
  const heading = loud
    ? `:warning: Populace ${country} release delta — ${report.flags.length} flag${report.flags.length === 1 ? "" : "s"}`
    : `:bar_chart: Populace ${country} release delta — all within band`;
  const contextLine = [
    `\`${report.a_release}\``,
    "→",
    `\`${report.b_release}\``,
  ].join(" ");
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${heading}*\n${contextLine}` } },
    { type: "section", text: { type: "mrkdwn", text: "```" + formatDeltaTable(report) + "```" } },
  ];
  if (opts.dashboardUrl) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${opts.dashboardUrl}?a=${encodeURIComponent(report.a_release)}&b=${encodeURIComponent(report.b_release)}|Compare in the calibration dashboard>`,
        },
      ],
    });
  }
  return { text: heading, blocks };
}

// --- report loaders (network) -----------------------------------------------
// One place that assembles a full DeltaReport for a pair of releases, shared by
// the /deltas/latest feed, the HF webhook alert, and the CLI script. Reform
// validation and source coverage are best-effort: a release that never
// published them just drops those sections.

function sideGatesFor(
  coverage: SourceCoverage | CoverageMissing | null,
): SideGateInput[] {
  return [
    {
      key: "us_source_coverage",
      available: !!coverage && coverage.available,
      gate: coverage && coverage.available ? coverage.gate : null,
      enforced:
        coverage && coverage.available ? coverage.classification === "release_gate" : null,
      reviewed_exclusions: coverage && coverage.available ? coverage.reviewed_exclusions : [],
    },
    // Kept present-but-unpublished on both sides so the gate sets align and a
    // spurious "gate skipped" change is never emitted for them.
    { key: "input_coverage", available: false },
    { key: "reform_coverage_smoke", available: false },
  ];
}

export interface DeltaUnavailable {
  available: false;
  reason: string;
  a_release: string | null;
  b_release: string | null;
}

export async function loadReleaseDelta(
  aId: string,
  bId: string,
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<DeltaReport> {
  const [a, b] = await Promise.all([
    loadRelease(aId, revalidate, country),
    loadRelease(bId, revalidate, country),
  ]);
  // Reform validation is US-only (the JCT suite); skip it for UK.
  const wantReforms = country === "us";
  const [reformA, reformB, coverageA, coverageB] = await Promise.all([
    wantReforms ? loadReformValidation(a.release_id, revalidate).catch(() => null) : null,
    wantReforms ? loadReformValidation(b.release_id, revalidate).catch(() => null) : null,
    loadSourceCoverage(a.release_id, revalidate, country).catch(() => null),
    loadSourceCoverage(b.release_id, revalidate, country).catch(() => null),
  ]);
  const certA = buildCertification(a.build_manifest, a.release_id, sideGatesFor(coverageA));
  const certB = buildCertification(b.build_manifest, b.release_id, sideGatesFor(coverageB));
  return computeReleaseDelta({
    a,
    b,
    reformA,
    reformB,
    certA,
    certB,
    coverageA,
    coverageB,
  });
}

// Default target of the alert: the pointer's latest release vs the one before
// it in the registry. Returns an unavailable marker (not a throw) when there
// aren't two calibrated releases to compare.
export async function loadLatestDelta(
  revalidate: number,
  country: PopulaceCountry = "us",
): Promise<DeltaReport | DeltaUnavailable> {
  const [releases, pointer] = await Promise.all([
    loadReleases(revalidate, country),
    loadPointerReleaseId(revalidate, country).catch(() => ({ release_id: "", updated_at: null })),
  ]);
  const calibrated = releases.filter((r) => r.has_calibration);
  if (calibrated.length < 2) {
    return {
      available: false,
      reason: "Need at least two calibrated releases to compute a delta.",
      a_release: calibrated[0]?.release_id ?? null,
      b_release: null,
    };
  }
  // Prefer the pointer's latest; fall back to the newest by date.
  const latestIndex = Math.max(
    calibrated.findIndex((r) => r.release_id === pointer.release_id),
    0,
  );
  const b = calibrated[latestIndex];
  const a = calibrated[latestIndex + 1] ?? calibrated[latestIndex === 0 ? 1 : 0];
  return loadReleaseDelta(a.release_id, b.release_id, revalidate, country);
}

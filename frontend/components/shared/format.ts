import { formatNumber } from "@policyengine/ui-kit";

// Tax/benefit acronyms shown uppercase rather than as words.
const ACRONYMS = new Set([
  "salt", "agi", "eitc", "ctc", "actc", "qbi", "ira", "aca", "ptc", "snap",
  "tanf", "ssi", "oasdi", "fica", "ui", "hsa", "fsa", "amt", "se", "magi",
]);

// Humanize a snake_case identifier (e.g. "salt_deduction_expenditure") into
// readable words ("SALT deduction expenditure"). Names that already use spaces
// (e.g. "adjusted gross income") pass through unchanged.
export function humanizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split("_")
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word))
    .join(" ");
}

// Release build ids carry a trailing date ("…-20260614") or timestamp
// ("…-20260615T201302Z"). Format it for display.
export function formatReleaseDate(date: string | null | undefined): string {
  if (!date) return "";
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}Z)?$/.exec(date);
  if (!m) return date;
  const [, y, mo, d, h, mi] = m;
  return h ? `${y}-${mo}-${d} ${h}:${mi}Z` : `${y}-${mo}-${d}`;
}

// A readable label for a release: "2026-06-14 · f32c2e5".
export function releaseLabel(releaseId: string, date?: string | null): string {
  const sha = releaseId.replace(/^populace-us-\d{4}-/, "").split("-")[0];
  const formatted = formatReleaseDate(date);
  return formatted ? `${formatted} · ${sha}` : sha;
}

export function fmt(
  value: number | null | undefined,
  opts: { pct?: boolean; digits?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (opts.pct) {
    const digits = opts.digits ?? 1;
    return `${(value * 100).toFixed(digits)}%`;
  }
  if (Math.abs(value) >= 1000 || Number.isInteger(value)) {
    return formatNumber(value);
  }
  return value.toFixed(opts.digits ?? 4);
}

export function fmtSigned(
  value: number | null | undefined,
  opts: { pct?: boolean; digits?: number } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt(value, opts)}`;
}

export function fmtCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
}

export function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtMoney(value)}`;
}

export function fmtRatio(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}×`;
}

export function tone(
  value: number | null | undefined,
  improveIsLower = true,
): "positive" | "negative" | "neutral" {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return "neutral";
  }
  return (improveIsLower ? value < 0 : value > 0) ? "positive" : "negative";
}

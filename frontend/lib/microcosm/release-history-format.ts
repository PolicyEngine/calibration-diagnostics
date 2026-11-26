/**
 * How the release history page writes numbers, dates and build names
 * (calibration-diagnostics#224). Pure, so the page and its tests share it.
 */
import type { TimelineBuild, TimelineValue } from "./release-history-store";

export type OutputUnit = "currency" | "count" | "rate" | "ratio";

const MINUS = "−";
const NONE = "—";

/** The currency's short symbol ("£" for GBP), or nothing when the code is unknown. */
export function currencySymbol(currency: string | null): string {
  if (!currency) return "";
  try {
    const parts = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? "";
  } catch {
    return "";
  }
}

function compact(abs: number, decimals: number): string {
  if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)}tn`;
  if (abs >= 1e9) return `${(abs / 1e9).toFixed(decimals)}bn`;
  if (abs >= 1e6) return `${(abs / 1e6).toFixed(decimals)}m`;
  if (abs >= 1e4) return Math.round(abs).toLocaleString("en-GB");
  return abs.toLocaleString("en-GB", { maximumFractionDigits: abs < 10 ? 2 : 0 });
}

/**
 * A value in its unit: money with the currency's symbol, a count, a rate (a share, shown as a
 * percentage) or a ratio (already a percentage).
 */
export function formatValue(
  value: number | null | undefined,
  unit: OutputUnit,
  currency: string | null,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NONE;
  const abs = Math.abs(value);
  let text: string;
  if (unit === "currency") text = `${currencySymbol(currency)}${compact(abs, decimals)}`;
  else if (unit === "count") text = compact(abs, Math.max(decimals, 2));
  else if (unit === "rate") text = `${(abs * 100).toFixed(1)}%`;
  else text = `${abs.toFixed(2)}%`;
  return value < 0 ? `${MINUS}${text}` : text;
}

function signed(text: string, value: number): string {
  if (value < 0) return `${MINUS}${text}`;
  return value > 0 ? `+${text}` : text;
}

/** A signed percentage; a value that rounds to zero is "0%". */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NONE;
  const text = Math.abs(value).toFixed(decimals);
  return Number(text) === 0 ? "0%" : signed(`${text}%`, value);
}

/** A signed difference in percentage points. */
export function formatPoints(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NONE;
  const text = Math.abs(value).toFixed(decimals);
  return Number(text) === 0 ? "0 pp" : signed(`${text} pp`, value);
}

/** Whether a unit's steps are told in percentage points (rates and ratios) or in percent. */
export function stepsInPoints(unit: OutputUnit): boolean {
  return unit === "rate" || unit === "ratio";
}

/**
 * The step to a build from the build before it: "Withheld" beside a withheld cell, a dash when
 * there is no step, percentage points for a rate, and the amount with its percentage otherwise.
 */
export function formatChange(
  value: Pick<TimelineValue, "change" | "relativeChange" | "changePoints" | "changeStatus">,
  unit: OutputUnit,
  currency: string | null,
): string {
  if (value.changeStatus === "withheld") return "Withheld";
  if (value.changeStatus !== "ok" || value.change === null) return NONE;
  if (stepsInPoints(unit)) return formatPoints(value.changePoints);
  const amount = signed(formatValue(Math.abs(value.change), unit, currency, 2), value.change);
  return value.relativeChange === null
    ? amount
    : `${amount} (${formatPercent(value.relativeChange * 100)})`;
}

/** A value as a percentage above or below the output's official figure. */
export function versusOfficial(value: number, official: number): number {
  return ((value - official) / Math.abs(official)) * 100;
}

/** A period's name: 2026 is "2026-27" for a fiscal year, as the producer labels it. */
export function periodLabel(period: number, style: "fiscal_year" | "calendar_year"): string {
  return style === "fiscal_year"
    ? `${period}-${String((period + 1) % 100).padStart(2, "0")}`
    : String(period);
}

function utc(iso: string, options: Intl.DateTimeFormatOptions): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString("en-GB", { ...options, timeZone: "UTC" });
}

/** "19 Oct 2026": publish times are shown as UTC dates, the same for every reader. */
export function dateLong(iso: string): string {
  return utc(iso, { day: "numeric", month: "short", year: "numeric" });
}

/** "19 Oct". */
export function dateShort(iso: string): string {
  return utc(iso, { day: "numeric", month: "short" });
}

/** "19 Oct 2026, 08:33 UTC". */
export function dateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return NONE;
  const date = dateLong(iso);
  const time = utc(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
  return date === iso ? iso : `${date}, ${time} UTC`;
}

/** What every name starts with, cut back to a hyphen so a name is never cut mid-word. */
export function commonPrefix(names: readonly string[]): string {
  if (names.length < 2) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  const cut = prefix.lastIndexOf("-");
  return cut > 0 ? prefix.slice(0, cut + 1) : "";
}

/**
 * Builds of one series share a long prefix: each build's name without it, by build id. The full
 * id stays available as a title.
 */
export function shortBuildNames(builds: ReadonlyArray<Pick<TimelineBuild, "buildId" | "build">>): Map<string, string> {
  const prefix = commonPrefix(builds.map((build) => build.build));
  return new Map(builds.map((build) => [build.buildId, build.build.slice(prefix.length) || build.build]));
}

/** A digest or commit, shortened for display. */
export function shortHash(value: string | null | undefined, length = 10): string {
  return value ? value.slice(0, length) : NONE;
}

/** "policyengine-uk==2.174.1" as "policyengine-uk 2.174.1". */
export function engineLabel(pin: string | null | undefined): string {
  return pin ? pin.replace("==", " ") : "an unnamed engine";
}

// Shields.io-compatible badge payloads for READMEs and papers, e.g.
//   ![](https://img.shields.io/endpoint?url=<dashboard>/api/populace/badge/gates)
// The endpoint schema is { schemaVersion: 1, label, message, color }.

export interface Shield {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  cacheSeconds?: number;
}

export type BadgeMetric = "default-release" | "gates" | "within10";

export const BADGE_METRICS: BadgeMetric[] = ["default-release", "gates", "within10"];

export function isBadgeMetric(value: string): value is BadgeMetric {
  return (BADGE_METRICS as string[]).includes(value);
}

// The build slug that names a release, e.g.
// "populace-us-2024-buildi-sparse-…-20260709T034135Z" → "buildi".
export function releaseBuildSlug(releaseId: string): string {
  const stripped = releaseId.replace(/^populace-[a-z]{2}-\d{4}-/, "");
  const token = stripped.split("-")[0];
  return token || releaseId;
}

export function defaultReleaseBadge(releaseId: string, country: string): Shield {
  return {
    schemaVersion: 1,
    label: `populace-${country.toLowerCase()} default`,
    message: releaseBuildSlug(releaseId),
    color: "blue",
    cacheSeconds: 600,
  };
}

// `ran` is the number of gates that actually executed (total minus skipped), so
// an unpublished side-file gate never drags the badge down.
export function gatesBadge(passed: number, ran: number, failed: number): Shield {
  return {
    schemaVersion: 1,
    label: "gates",
    message: `${passed}/${ran}`,
    color: failed > 0 ? "red" : passed < ran ? "yellow" : "brightgreen",
    cacheSeconds: 600,
  };
}

export function within10Badge(fraction: number | null): Shield {
  if (fraction == null || !Number.isFinite(fraction)) {
    return { schemaVersion: 1, label: "within 10%", message: "unknown", color: "lightgrey", cacheSeconds: 600 };
  }
  const pct = fraction * 100;
  const color = pct >= 85 ? "brightgreen" : pct >= 70 ? "yellow" : "orange";
  return {
    schemaVersion: 1,
    label: "within 10%",
    message: `${pct.toFixed(1)}%`,
    color,
    cacheSeconds: 600,
  };
}

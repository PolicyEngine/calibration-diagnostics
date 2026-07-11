import { NextResponse } from "next/server";

import {
  asObject,
  hfResolveUrl,
  loadPointerReleaseId,
  parseCountry,
  type PopulaceCountry,
} from "@/lib/populace/latest-artifact";
import { loadSourceCoverage } from "@/lib/populace/coverage";
import { buildCertification, type SideGateInput } from "@/lib/populace/certification";
import {
  defaultReleaseBadge,
  gatesBadge,
  isBadgeMetric,
  within10Badge,
  type Shield,
} from "@/lib/populace/badges";

export const revalidate = 600;
export const runtime = "nodejs";
export const maxDuration = 60;

// Fetch just build_manifest.json (small) — never the multi-MB diagnostics — so a
// badge stays cheap. The calibration gate carries fraction_within_10pct too.
async function fetchBuildManifest(
  releaseId: string,
  country: PopulaceCountry,
): Promise<Record<string, unknown>> {
  const url = hfResolveUrl(`releases/${releaseId}/build_manifest.json`, country);
  const res = await fetch(url, { next: { revalidate }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HF fetch failed ${res.status}: ${url}`);
  return asObject(await res.json());
}

const ERROR_SHIELD: Shield = {
  schemaVersion: 1,
  label: "populace",
  message: "unavailable",
  color: "lightgrey",
  cacheSeconds: 120,
};

export async function GET(
  request: Request,
  context: { params: Promise<{ metric: string }> },
) {
  const { metric } = await context.params;
  const country = parseCountry(new URL(request.url).searchParams.get("country"));
  if (!isBadgeMetric(metric)) {
    return NextResponse.json(
      { ...ERROR_SHIELD, message: "unknown badge" },
      { status: 404 },
    );
  }
  try {
    const { release_id: releaseId } = await loadPointerReleaseId(revalidate, country);

    if (metric === "default-release") {
      return NextResponse.json(defaultReleaseBadge(releaseId, country));
    }

    if (metric === "within10") {
      const manifest = await fetchBuildManifest(releaseId, country);
      const calibration = asObject(asObject(manifest.gates).calibration);
      const fraction =
        typeof calibration.fraction_within_10pct === "number"
          ? calibration.fraction_within_10pct
          : null;
      return NextResponse.json(within10Badge(fraction));
    }

    // metric === "gates"
    const [manifest, source] = await Promise.all([
      fetchBuildManifest(releaseId, country),
      loadSourceCoverage(releaseId, revalidate, country),
    ]);
    const sideGates: SideGateInput[] = [
      {
        key: "us_source_coverage",
        available: source.available,
        gate: source.available ? source.gate : null,
        enforced: source.available ? source.classification === "release_gate" : null,
      },
      { key: "input_coverage", available: false },
      { key: "reform_coverage_smoke", available: false },
    ];
    const cert = buildCertification(manifest, releaseId, sideGates);
    const ran = cert.totals.total - cert.totals.skipped;
    return NextResponse.json(gatesBadge(cert.totals.passed, ran, cert.totals.failed));
  } catch {
    // Return a valid shield (200) so a README badge degrades gracefully rather
    // than rendering a broken image.
    return NextResponse.json(ERROR_SHIELD);
  }
}

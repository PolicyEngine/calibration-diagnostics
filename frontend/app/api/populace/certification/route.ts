import { NextResponse } from "next/server";

import {
  classifyApiError,
  hfResolveUrl,
  loadRelease,
  parseCountry,
  scrub,
} from "@/lib/populace/latest-artifact";
import {
  loadInputColumnCoverage,
  loadReformSmoke,
  loadSourceCoverage,
} from "@/lib/populace/coverage";
import { buildCertification, type SideGateInput } from "@/lib/populace/certification";

export const revalidate = 300;
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release") ?? "latest";
  const country = parseCountry(params.get("country"));
  try {
    const cal = await loadRelease(release, revalidate, country);
    const releaseId = cal.release_id;
    const [source, inputColumns, reformSmoke] = await Promise.all([
      loadSourceCoverage(releaseId, revalidate, country),
      loadInputColumnCoverage(releaseId, revalidate, country),
      loadReformSmoke(releaseId, revalidate, country),
    ]);

    const sideGates: SideGateInput[] = [
      {
        key: "us_source_coverage",
        available: source.available,
        gate: source.available ? source.gate : null,
        // classification "release_gate" means this gate blocks publication.
        enforced: source.available ? source.classification === "release_gate" : null,
        reviewed_exclusions: source.available ? source.reviewed_exclusions : [],
      },
      {
        key: "input_coverage",
        available: inputColumns.available,
        gate: inputColumns.available ? inputColumns.gate : null,
        enforced: inputColumns.available ? inputColumns.enforced : null,
      },
      {
        key: "reform_coverage_smoke",
        available: reformSmoke.available,
        gate: reformSmoke.available ? reformSmoke.gate : null,
        enforced: reformSmoke.available ? reformSmoke.enforced : null,
      },
    ];

    const certification = buildCertification(cal.build_manifest, releaseId, sideGates);
    const prefix = `releases/${releaseId}`;
    return NextResponse.json(
      scrub({
        release_id: releaseId,
        updated_at: cal.updated_at,
        certification,
        source_artifacts: [
          { name: "build_manifest", path: `${prefix}/build_manifest.json`, url: hfResolveUrl(`${prefix}/build_manifest.json`, country) },
          { name: "us_source_coverage", path: `${prefix}/us_source_coverage.json`, url: hfResolveUrl(`${prefix}/us_source_coverage.json`, country) },
        ],
      }),
    );
  } catch (error) {
    const { status, body } = classifyApiError(error);
    return NextResponse.json(body, { status });
  }
}

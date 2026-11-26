// Test support: whole release history documents. The document types are generated from the JSON
// Schemas in release_history/schemas/ and require every key a schema lists, so the tests build
// complete documents here and set only what they check.
import type { MeasurementCell, MeasurementDocument } from "../release-history-store";

const ZEROS = "0".repeat(64);

/**
 * A stored point of a file inside the reference model's declared range, measured well inside its
 * runner limits, with no data columns recorded (as a gap has none).
 */
export function measurementDocument(options: {
  country: string;
  panelId: string;
  measurementId: string;
  digest: string;
  status?: MeasurementDocument["status"];
  reason?: string | null;
  cells?: MeasurementCell[];
}): MeasurementDocument {
  return {
    format_version: 1,
    kind: "release_history.measurement",
    country: options.country,
    panel_id: options.panelId,
    measurement_id: options.measurementId,
    status: options.status ?? "ok",
    reason: options.reason ?? null,
    fetched_from: {
      build_id: "test-release/test-build",
      hf_repo: "policyengine/test-release-repo",
      hf_commit: "0".repeat(40),
      release_manifest: {
        path: "releases/test-release/test-build/release_manifest.json",
        sha256: ZEROS,
        json_sha256: ZEROS,
      },
      build_manifest: null,
      dataset: { key: "national", path: "releases/test-release/test-build/national.h5" },
      declared: {
        build: "test-build",
        cut_tag: null,
        migrated_from: null,
        built_at: null,
        built_with_model: null,
        built_with_core: null,
        compatible_models: null,
        reference_model_compatibility: "inside",
        description: null,
        build_provenance: null,
      },
    },
    file: { sha256: options.digest, bytes: 1 },
    data: null,
    periods: [{ period: 2026, label: "2026" }],
    baseline: { status: "ok" },
    reforms: null,
    cells: options.cells ?? [],
    disclosure: { policy: "none", min_source_households: 3, withheld_cells: 0 },
    engine_bundle: null,
    environment: { python: "3.13.0", platform: "test", packages: [], packages_sha256: ZEROS, uv_lock_sha256: null },
    producer: { version: "1", commit: null },
    runtime: {
      started_at: null,
      finished_at: null,
      seconds: null,
      runner: null,
      simulations: [],
      limits: { seconds: null, memory_bytes: null, dataset_bytes: null, warn_at: 0.8 },
      near_limits: [],
    },
  };
}

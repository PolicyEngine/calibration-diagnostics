// Test support: a US fiscal refresh build's staging run as the version 2
// writer stages it (PolicyEngine/microcosm#1135): version 3 documents that
// name the run's country, operation, pipeline, candidate, release and run
// kind, and result files under `artifacts/`, each declared in the run manifest
// with its SHA-256. The digests are of each document's JSON text, as the fake
// collector store records them.
import { fakeDocumentSha256 } from "@/lib/microcosm/test-support/fake-collector-store";

type JsonObject = Record<string, unknown>;

export const US_V2_RUN = "populace-us-2026-v2-run-20261127T010000Z";
export const US_V2_CANDIDATE = "populace-us-2026-v2-candidate-20261127T010000Z";
export const US_V2_RELEASE = "populace-us-2026";
const STARTED_AT = "2026-11-27T01:00:00+00:00";
const UPDATED_AT = "2026-11-27T05:00:00+00:00";

export const US_V2_BUILD_MANIFEST: JsonObject = {
  schema_version: 1,
  build_id: "populace-us-2026-v2-build-20261127T010000Z",
  gates: { target_compilation: { status: "passed", dropped_target_names: [] } },
};

export const US_V2_RELEASE_MANIFEST: JsonObject = {
  schema_version: 1,
  build: {
    schema_version: 1,
    build_id: "populace-us-2026-v2-build-20261127T010000Z",
    built_at: "2026-11-27T05:00:00Z",
    population_year: 2026,
  },
  default_datasets: { national: "populace_us_2026" },
};

/** A reform validation with one out-of-sample reform 5% under its JCT score. */
export function usV2ReformValidation(budgetEffect = -95_000_000_000): JsonObject {
  return {
    schema_version: 1,
    release_id: US_V2_CANDIDATE,
    baseline_period: 2026,
    scoring_window: "FY2025-2034",
    reforms: [
      {
        id: "obbba_salt_cap",
        name: "SALT cap change",
        category: "OBBBA",
        jct: { score: -100_000_000_000, score_type: "conventional", source: "JCX-29-25" },
        microcosm: { budget_effect: budgetEffect },
      },
    ],
  };
}

const IDENTITY = {
  run_id: US_V2_RUN,
  country_code: "US",
  operation_id: "us_fiscal_refresh_build",
  pipeline: { id: "us_fiscal_refresh", version: "2026.11" },
  candidate_id: US_V2_CANDIDATE,
  release_id: US_V2_RELEASE,
  run_kind: "release",
  non_release: false,
  started_at: STARTED_AT,
  updated_at: UPDATED_AT,
  status: "completed",
  current_stage: "complete",
} as const;

const DELIVERY = {
  contract_version: 2,
  enabled: true,
  mode: "local_and_remote",
  run_id: US_V2_RUN,
  configured_repository: "policyengine/populace-us-staging",
  upload_attempts: 3,
  upload_successes: 3,
  read_back: "passed",
  last_error_code: null,
  opt_out_reason: null,
} as const;

function declared(logicalName: string, artifactKind: string, document: JsonObject, classification = "aggregate") {
  return {
    logical_name: logicalName,
    artifact_kind: artifactKind,
    contract_relative_path: `artifacts/${logicalName}.json`,
    media_type: "application/json",
    sha256: fakeDocumentSha256(document),
    classification,
  };
}

export function usV2Progress(): JsonObject {
  return {
    schema_name: "microcosm.staging.progress",
    schema_version: 3,
    ...IDENTITY,
    sample: { mode: "full" },
    delivery: DELIVERY,
    message: "Staging run completed.",
    details: {},
    failure: null,
    block: null,
  };
}

/**
 * The run manifest, declaring the run's diagnostics, its build and release
 * manifests and, unless `reformValidation` is null, its reform validation.
 */
export function usV2RunManifest(options: {
  diagnostics: JsonObject;
  reformValidation?: JsonObject | null;
}): JsonObject {
  const reformValidation =
    options.reformValidation === undefined ? usV2ReformValidation() : options.reformValidation;
  return {
    schema_name: "microcosm.staging.run-manifest",
    schema_version: 3,
    ...IDENTITY,
    sample: { mode: "full" },
    delivery: DELIVERY,
    artifacts: [
      declared("build_manifest", "build_metadata", US_V2_BUILD_MANIFEST, "non_row_level"),
      declared("calibration_diagnostics", "aggregate_diagnostics", options.diagnostics),
      ...(reformValidation ? [declared("reform_validation", "validation_summary", reformValidation)] : []),
      declared("release_manifest", "build_metadata", US_V2_RELEASE_MANIFEST, "non_row_level"),
    ],
    failure: null,
    block: null,
    paths: {
      progress: `runs/${US_V2_RUN}/progress.json`,
      events: `runs/${US_V2_RUN}/events.ndjson`,
      calibration_progress: `runs/${US_V2_RUN}/calibration_progress.json`,
    },
  };
}

export function usV2Events(): string {
  return [
    { stage_id: "created", status: "started", timestamp: STARTED_AT, message: "Staging run created." },
    { stage_id: "calibration", status: "started", timestamp: "2026-11-27T02:00:00+00:00", message: null },
    { stage_id: "calibration", status: "completed", timestamp: "2026-11-27T04:00:00+00:00", message: null },
    { stage_id: "reform_validation", status: "completed", timestamp: "2026-11-27T04:30:00+00:00", message: null },
    { stage_id: "complete", status: "completed", timestamp: UPDATED_AT, message: "Staging run completed." },
  ]
    .map((event, index) =>
      JSON.stringify({
        schema_name: "microcosm.staging.event",
        schema_version: 3,
        sequence: index + 1,
        event_type: "stage",
        run_id: US_V2_RUN,
        details: {},
        ...event,
      }),
    )
    .join("\n");
}

export function usV2CalibrationProgress(): JsonObject {
  const event = (timestamp: string, epoch: number, loss: number) => ({
    timestamp,
    epoch,
    epochs: 100,
    phase: "calibration",
    loss,
    iteration: null,
    budget_search: null,
    budget_iteration: null,
    budget_iters: null,
    l0_lambda: null,
  });
  return {
    schema_name: "microcosm.staging.calibration-progress",
    schema_version: 3,
    run_id: US_V2_RUN,
    candidate_id: US_V2_CANDIDATE,
    updated_at: "2026-11-27T04:00:00+00:00",
    events: [
      event("2026-11-27T02:30:00+00:00", 10, 0.5),
      event("2026-11-27T03:30:00+00:00", 100, 0.0125),
    ],
  };
}

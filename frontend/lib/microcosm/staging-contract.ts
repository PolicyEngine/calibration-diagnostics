/** Explicit version dispatch and UI normalization for Microcosm staging data. */

export type JsonObject = Record<string, unknown>;

export class IncompatibleStagingDataError extends Error {
  constructor(message: string) {
    super(`Incompatible staging data: ${message}`);
    this.name = "IncompatibleStagingDataError";
  }
}

const V2_SCHEMAS = {
  manifest: "microcosm.staging.run-manifest",
  progress: "microcosm.staging.progress",
  calibration: "microcosm.staging.calibration-progress",
  event: "microcosm.staging.event",
} as const;

function objectValue(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IncompatibleStagingDataError(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new IncompatibleStagingDataError(`${label} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value == null ? null : stringValue(value, label);
}

function version(
  payload: JsonObject,
  kind: keyof typeof V2_SCHEMAS,
  options: { allowUnversionedV1?: boolean } = {},
): 1 | 2 {
  if (payload.schema_version === 1) {
    if (payload.schema_name != null) {
      throw new IncompatibleStagingDataError(
        `version 1 ${kind} data must not declare schema_name.`,
      );
    }
    return 1;
  }
  if (payload.schema_version === 2) {
    if (payload.schema_name !== V2_SCHEMAS[kind]) {
      throw new IncompatibleStagingDataError(
        `expected ${V2_SCHEMAS[kind]} version 2, received ${String(payload.schema_name)}.`,
      );
    }
    return 2;
  }
  if (options.allowUnversionedV1 && payload.schema_version == null && payload.schema_name == null) {
    return 1;
  }
  throw new IncompatibleStagingDataError(
    `unsupported ${kind} schema version ${String(payload.schema_version)}.`,
  );
}

export interface ParsedStagingRunSummary {
  run_id: string;
  candidate_release_id: string | null;
  release_id: string | null;
  country_code: string | null;
  run_kind: string | null;
  non_release: boolean | null;
  status: string | null;
  stage: string | null;
  started_at: string | null;
  updated_at: string | null;
  progress_path: string;
  run_manifest_path: string;
  schema_version: 1;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseStagingRunIndex(value: unknown): ParsedStagingRunSummary[] {
  const payload = objectValue(value, "run index");
  if (payload.schema_version !== 1 || payload.schema_name != null) {
    throw new IncompatibleStagingDataError(
      `run index must use schema version 1, received ${String(payload.schema_version)}.`,
    );
  }
  if (!Array.isArray(payload.runs)) {
    throw new IncompatibleStagingDataError("run index runs must be an array.");
  }
  return payload.runs.map((entry, index) => {
    const row = objectValue(entry, `run index row ${index}`);
    const runId = stringValue(row.run_id, `run index row ${index} run_id`);
    const candidate = nullableString(
      row.candidate_release_id,
      `run index row ${index} candidate_release_id`,
    );
    return {
      run_id: runId,
      candidate_release_id: candidate,
      release_id: null,
      country_code: null,
      run_kind: null,
      non_release: null,
      status: optionalString(row.status),
      stage: optionalString(row.stage),
      started_at: optionalString(row.started_at),
      updated_at: optionalString(row.updated_at),
      progress_path:
        optionalString(row.progress_path) ?? `runs/${runId}/progress.json`,
      run_manifest_path:
        optionalString(row.run_manifest_path) ?? `runs/${runId}/run_manifest.json`,
      schema_version: 1,
    };
  });
}

function parseDelivery(value: unknown): JsonObject {
  const delivery = objectValue(value, "version 2 delivery");
  if (delivery.contract_version !== 2) {
    throw new IncompatibleStagingDataError("delivery contract_version must be 2.");
  }
  if (!new Set(["local_and_remote", "local_only", "disabled"]).has(delivery.mode as string)) {
    throw new IncompatibleStagingDataError("delivery mode is unsupported.");
  }
  if (typeof delivery.enabled !== "boolean") {
    throw new IncompatibleStagingDataError("delivery enabled must be boolean.");
  }
  return delivery;
}

export function parseStagingProgress(value: unknown): JsonObject {
  const payload = objectValue(value, "progress");
  const schemaVersion = version(payload, "progress");
  const runId = stringValue(payload.run_id, "progress run_id");
  if (schemaVersion === 1) return { ...payload, run_id: runId };
  const candidateId = stringValue(payload.candidate_id, "progress candidate_id");
  return {
    ...payload,
    run_id: runId,
    candidate_release_id: candidateId,
    stage: stringValue(payload.current_stage, "progress current_stage"),
    delivery: parseDelivery(payload.delivery),
  };
}

const ARTIFACT_KINDS = new Set([
  "aggregate_diagnostics",
  "build_metadata",
  "sampling_receipt",
  "validation_summary",
]);

function parseArtifacts(value: unknown, runId: string): Record<string, JsonObject> {
  if (!Array.isArray(value)) {
    throw new IncompatibleStagingDataError("version 2 artifacts must be an array.");
  }
  const artifacts = new Map<string, JsonObject>();
  for (const [index, entry] of value.entries()) {
    const artifact = objectValue(entry, `artifact ${index}`);
    const name = stringValue(artifact.logical_name, `artifact ${index} logical_name`);
    const path = stringValue(
      artifact.contract_relative_path,
      `artifact ${index} contract_relative_path`,
    );
    if (path !== `artifacts/${name}.json` || path.includes("..") || path.startsWith("/")) {
      throw new IncompatibleStagingDataError(`artifact ${name} has an unsafe path.`);
    }
    if (!ARTIFACT_KINDS.has(String(artifact.artifact_kind))) {
      throw new IncompatibleStagingDataError(`artifact ${name} has an unsupported kind.`);
    }
    if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
      throw new IncompatibleStagingDataError(`artifact ${name} has an invalid digest.`);
    }
    if (
      artifact.media_type !== "application/json" ||
      !new Set(["aggregate", "non_row_level"]).has(String(artifact.classification))
    ) {
      throw new IncompatibleStagingDataError(`artifact ${name} is not reviewed JSON.`);
    }
    if (artifacts.has(name)) {
      throw new IncompatibleStagingDataError(`artifact ${name} appears more than once.`);
    }
    artifacts.set(name, {
      ...artifact,
      path,
      staging_path: `runs/${runId}/${path}`,
    });
  }
  return Object.fromEntries(artifacts);
}

export function parseStagingManifest(value: unknown): JsonObject {
  const payload = objectValue(value, "run manifest");
  const schemaVersion = version(payload, "manifest");
  const runId = stringValue(payload.run_id, "run manifest run_id");
  if (schemaVersion === 1) return { ...payload, run_id: runId };
  const candidateId = stringValue(payload.candidate_id, "run manifest candidate_id");
  const releaseId = nullableString(payload.release_id, "run manifest release_id");
  const countryCode = stringValue(payload.country_code, "run manifest country_code");
  const runKind = stringValue(payload.run_kind, "run manifest run_kind");
  if (typeof payload.non_release !== "boolean") {
    throw new IncompatibleStagingDataError(
      "run manifest non_release must be boolean.",
    );
  }
  if (!new Set(["running", "completed", "failed"]).has(String(payload.status))) {
    throw new IncompatibleStagingDataError("run manifest status is unsupported.");
  }
  const startedAt = stringValue(payload.started_at, "run manifest started_at");
  const updatedAt = stringValue(payload.updated_at, "run manifest updated_at");
  return {
    ...payload,
    run_id: runId,
    candidate_release_id: candidateId,
    release_id: releaseId,
    country_code: countryCode,
    run_kind: runKind,
    non_release: payload.non_release,
    status: payload.status,
    started_at: startedAt,
    updated_at: updatedAt,
    stage: stringValue(payload.current_stage, "run manifest current_stage"),
    delivery: parseDelivery(payload.delivery),
    artifacts: parseArtifacts(payload.artifacts, runId),
  };
}

export function parseStagingCalibrationProgress(value: unknown): JsonObject {
  const payload = objectValue(value, "calibration progress");
  const schemaVersion = version(payload, "calibration");
  if (!Array.isArray(payload.events)) {
    throw new IncompatibleStagingDataError("calibration events must be an array.");
  }
  if (schemaVersion === 1) return payload;
  stringValue(payload.run_id, "calibration progress run_id");
  stringValue(payload.candidate_id, "calibration progress candidate_id");
  return {
    ...payload,
    candidate_release_id: payload.candidate_id,
    events: payload.events.map((entry, index) => {
      const event = objectValue(entry, `calibration event ${index}`);
      return {
        ...event,
        time: stringValue(event.timestamp, `calibration event ${index} timestamp`),
      };
    }),
  };
}

export function parseStagingEvents(text: string | null): JsonObject[] {
  if (!text) return [];
  const events = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let payload: JsonObject;
      try {
        payload = objectValue(JSON.parse(line), `event ${index}`);
      } catch (error) {
        if (error instanceof IncompatibleStagingDataError) throw error;
        throw new IncompatibleStagingDataError(`event ${index} is not valid JSON.`);
      }
      const schemaVersion = version(payload, "event", { allowUnversionedV1: true });
      if (schemaVersion === 1) return payload;
      return {
        ...payload,
        stage: stringValue(payload.stage_id, `event ${index} stage_id`),
        time: stringValue(payload.timestamp, `event ${index} timestamp`),
      };
    });
  const v2 = events.filter((event) => event.schema_version === 2);
  if (
    v2.length &&
    v2.some((event, index) => event.sequence !== index + 1)
  ) {
    throw new IncompatibleStagingDataError("version 2 event sequence is not contiguous.");
  }
  return events;
}

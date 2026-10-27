type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sentenceCaseIdentifier(value: string): string {
  const words = value.replaceAll("_", " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Unknown";
}

export function formatStagingStatus(status: unknown): string {
  const value = stringValue(status);
  if (value === "passed") return "Finished";
  return value ? sentenceCaseIdentifier(value) : "Unknown";
}

export function formatStagingCurrentStatus(progress: JsonObject): string {
  const stage = stringValue(progress.stage);
  if (stage === "calibrating" || stage === "calibration") {
    const calibration = objectValue(progress.calibration);
    const epoch = finiteNumber(calibration.epoch);
    const epochs = finiteNumber(calibration.epochs);
    return epoch != null && epochs != null
      ? `Calibration, epoch ${epoch} of ${epochs}`
      : "Calibration";
  }
  if (stage) return sentenceCaseIdentifier(stage);

  return formatStagingStatus(progress.status);
}

export interface CandidateCurrentStatus {
  status: string | null;
  stage: string | null;
  failure: { stage: string | null; message: string | null } | null;
  calibration: { epoch: number | null; epochs: number | null } | null;
}

// The Candidate tab's "Current status": the stage a failed or refused run
// stopped at, otherwise the current stage as the Hugging Face progress
// document presents it.
export function formatCandidateCurrentStatus(state: CandidateCurrentStatus): string {
  const stoppedAt = stringValue(state.failure?.stage);
  if (state.status === "failed") {
    return stoppedAt ? `Failed during ${sentenceCaseIdentifier(stoppedAt)}` : "Failed";
  }
  if (state.status === "blocked") {
    return stoppedAt ? `Refused at ${sentenceCaseIdentifier(stoppedAt)}` : "Refused";
  }
  return formatStagingCurrentStatus({
    status: state.status,
    stage: state.stage,
    calibration: state.calibration,
  });
}

export function formatStateSource(source: "collector" | "hugging_face"): string {
  return source === "collector" ? "Telemetry collector" : "Hugging Face staging repository";
}

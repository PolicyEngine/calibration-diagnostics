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

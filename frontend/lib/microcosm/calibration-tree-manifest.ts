import { isCountry, type MicrocosmCountry } from "./countries";
import { isHfCommitSha, isSha256 } from "./calibration-tree-artifact";

export const CALIBRATION_TREE_MANIFEST_SCHEMA_VERSION = 2 as const;
export const CALIBRATION_TREE_MANIFEST_PATH = "calibration-trees/latest.json";

export interface CalibrationTreeManifestEntry {
  releaseId: string;
  hfCommitSha: string;
  treeSchemaVersion: 2;
  indexSha256: string;
  indexBytes: number;
  updatedAt: string;
}

export interface CalibrationTreeLatestManifestV2 {
  schemaVersion: typeof CALIBRATION_TREE_MANIFEST_SCHEMA_VERSION;
  countries: Partial<Record<MicrocosmCountry, CalibrationTreeManifestEntry>>;
}

export function emptyCalibrationTreeManifest(): CalibrationTreeLatestManifestV2 {
  return {
    schemaVersion: CALIBRATION_TREE_MANIFEST_SCHEMA_VERSION,
    countries: {},
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseEntry(value: unknown, country: string): CalibrationTreeManifestEntry {
  const entry = record(value, `Calibration tree manifest entry ${country}`);
  if (typeof entry.releaseId !== "string" || !entry.releaseId) {
    throw new Error(`Calibration tree manifest entry ${country} has no release id.`);
  }
  if (typeof entry.hfCommitSha !== "string" || !isHfCommitSha(entry.hfCommitSha)) {
    throw new Error(`Calibration tree manifest entry ${country} has an invalid HF commit SHA.`);
  }
  if (entry.treeSchemaVersion !== 2) {
    throw new Error(`Calibration tree manifest entry ${country} has an unsupported tree schema.`);
  }
  if (typeof entry.indexSha256 !== "string" || !isSha256(entry.indexSha256)) {
    throw new Error(`Calibration tree manifest entry ${country} has an invalid index hash.`);
  }
  if (!Number.isSafeInteger(entry.indexBytes) || (entry.indexBytes as number) <= 0) {
    throw new Error(`Calibration tree manifest entry ${country} has an invalid index byte count.`);
  }
  if (typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) {
    throw new Error(`Calibration tree manifest entry ${country} has an invalid update time.`);
  }
  return entry as unknown as CalibrationTreeManifestEntry;
}

export function parseCalibrationTreeManifest(
  value: unknown,
): CalibrationTreeLatestManifestV2 {
  const manifest = record(value, "Calibration tree manifest");
  if (manifest.schemaVersion !== CALIBRATION_TREE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported calibration tree manifest schema ${String(manifest.schemaVersion)}.`);
  }
  const countries = record(manifest.countries, "Calibration tree manifest countries");
  const parsedCountries: CalibrationTreeLatestManifestV2["countries"] = {};
  for (const [country, entry] of Object.entries(countries)) {
    if (!isCountry(country)) {
      throw new Error(`Calibration tree manifest contains unknown country ${country}.`);
    }
    parsedCountries[country] = parseEntry(entry, country);
  }
  return {
    schemaVersion: CALIBRATION_TREE_MANIFEST_SCHEMA_VERSION,
    countries: parsedCountries,
  };
}

export function serializeCalibrationTreeManifest(
  manifest: CalibrationTreeLatestManifestV2,
): string {
  const parsed = parseCalibrationTreeManifest(manifest);
  const countries = Object.fromEntries(
    Object.entries(parsed.countries).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return `${JSON.stringify({ ...parsed, countries })}\n`;
}

export function calibrationTreeManifestEntry(
  manifest: CalibrationTreeLatestManifestV2,
  country: MicrocosmCountry,
): CalibrationTreeManifestEntry {
  const entry = manifest.countries[country];
  if (!entry) throw new Error(`No published calibration tree exists for ${country}.`);
  return entry;
}

export function withCalibrationTreeManifestEntry(
  manifest: CalibrationTreeLatestManifestV2,
  country: MicrocosmCountry,
  entry: CalibrationTreeManifestEntry,
): CalibrationTreeLatestManifestV2 {
  parseEntry(entry, country);
  return {
    schemaVersion: CALIBRATION_TREE_MANIFEST_SCHEMA_VERSION,
    countries: {
      ...manifest.countries,
      [country]: entry,
    },
  };
}

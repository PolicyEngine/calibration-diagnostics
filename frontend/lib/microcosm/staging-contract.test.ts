import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  IncompatibleStagingDataError,
  parseStagingCalibrationProgress,
  parseStagingEvents,
  parseStagingManifest,
  parseStagingProgress,
  parseStagingRunIndex,
} from "./staging-contract";

const FIXTURES = join(import.meta.dir, "fixtures", "staging-contract");
const MANIFEST_DIGESTS = {
  v1: "165d24caf29b82afdb0ce241b65d088da552abd59d6ddabf4b2183b9a61be75b",
  v2: "0d54c630088152b4fb4a7b7a9853c851233d0be76579f949331ae4bcd7b455e5",
};

function bytes(version: "v1" | "v2", path: string): Buffer {
  return readFileSync(join(FIXTURES, version, path));
}

function json(version: "v1" | "v2", path: string): Record<string, unknown> {
  return JSON.parse(bytes(version, path).toString());
}

for (const version of ["v1", "v2"] as const) {
  test(`${version} fixture files match the Microcosm digest manifest`, () => {
    const manifest = bytes(version, "SHA256SUMS");
    expect(createHash("sha256").update(manifest).digest("hex")).toBe(
      MANIFEST_DIGESTS[version],
    );
    for (const line of manifest.toString().trim().split("\n")) {
      const [expected, path] = line.split("  ", 2);
      expect(createHash("sha256").update(bytes(version, path)).digest("hex")).toBe(
        expected,
      );
    }
  });
}

describe("version 1", () => {
  test("preserves current summaries and unversioned events", () => {
    const runs = parseStagingRunIndex(json("v1", "runs.json"));
    const progress = parseStagingProgress(json("v1", "progress.json"));
    const manifest = parseStagingManifest(json("v1", "run_manifest.json"));
    const calibration = parseStagingCalibrationProgress(
      json("v1", "calibration_progress.json"),
    );
    const events = parseStagingEvents(bytes("v1", "events.ndjson").toString());

    expect(runs[0]).toMatchObject({
      run_id: "v1-us-fixture",
      candidate_release_id: "populace-us-2024-v1-fixture",
      status: "passed",
      stage: "complete",
      schema_version: 1,
    });
    expect(progress.candidate_release_id).toBe("populace-us-2024-v1-fixture");
    expect(manifest.artifacts).toEqual({});
    expect((calibration.events as unknown[]).length).toBe(1);
    expect(events.map((event) => event.stage)).toEqual([
      "created",
      "calibrating",
      "complete",
    ]);
    expect(events.every((event) => event.schema_version == null)).toBe(true);
  });
});

describe("version 2", () => {
  const runRoot = "completed-spine/runs/uk-spine-v2-fixture";

  test("does not accept the removed shared run index contract", () => {
    expect(() =>
      parseStagingRunIndex({
        schema_name: "microcosm.staging.run-index",
        schema_version: 2,
        runs: [],
      }),
    ).toThrow(/run index must use schema version 1/);
  });

  test("normalizes identities, lifecycle, sampling, delivery, and events", () => {
    const progress = parseStagingProgress(json("v2", `${runRoot}/progress.json`));
    const manifest = parseStagingManifest(json("v2", `${runRoot}/run_manifest.json`));
    const events = parseStagingEvents(bytes("v2", `${runRoot}/events.ndjson`).toString());

    expect(manifest).toMatchObject({
      run_id: "uk-spine-v2-fixture",
      candidate_release_id: "uk-spine-v2-fixture",
      release_id: null,
      country_code: "GB",
      run_kind: "smoke",
      non_release: true,
      status: "completed",
      stage: "complete",
      schema_version: 2,
    });
    expect(progress).toMatchObject({
      candidate_release_id: "uk-spine-v2-fixture",
      stage: "complete",
      status: "completed",
      non_release: true,
    });
    expect(progress.delivery).toMatchObject({ mode: "local_only", contract_version: 2 });
    expect(progress.sample).toEqual({ mode: "full" });
    expect(manifest.artifacts).toEqual({});
    expect(events[1]).toMatchObject({
      sequence: 2,
      stage: "input_verification",
      time: "2026-01-02T00:00:01+00:00",
      status: "completed",
    });
  });

  test("normalizes calibration data and preserves sanitized failures", () => {
    const calibration = parseStagingCalibrationProgress(
      json(
        "v2",
        "calibration/runs/uk-calibration-v2-fixture/calibration_progress.json",
      ),
    );
    const failed = parseStagingProgress(
      json("v2", "failed/runs/uk-failed-v2-fixture/progress.json"),
    );
    const event = (calibration.events as Record<string, unknown>[])[0];

    expect(event.time).toBe(event.timestamp);
    expect(calibration.candidate_release_id).toBe("uk-calibration-candidate");
    expect(failed.status).toBe("failed");
    expect(failed.failure).toMatchObject({
      error_code: "BUILD_FAILED",
      error_type: "RuntimeError",
    });
  });

  test("rejects invalid run manifest date-time strings", () => {
    const source = json("v2", `${runRoot}/run_manifest.json`);
    const invalidTimestamps = [
      ["started_at", "not-a-date"],
      ["updated_at", "2026-02-30T00:00:00+00:00"],
      ["updated_at", "2026-01-01 00:00:00"],
      ["updated_at", "2026-01-01T00:00:00"],
    ] as const;

    for (const [field, value] of invalidTimestamps) {
      expect(() => parseStagingManifest({ ...source, [field]: value })).toThrow(
        new RegExp(`${field} must be a valid RFC 3339 date-time string`),
      );
    }
  });

  test("accepts reviewed typed artifacts and rejects unknown artifact kinds", () => {
    const source = json("v2", `${runRoot}/run_manifest.json`);
    const artifact = {
      logical_name: "validation-summary",
      artifact_kind: "validation_summary",
      contract_relative_path: "artifacts/validation-summary.json",
      media_type: "application/json",
      sha256: "a".repeat(64),
      classification: "aggregate",
    };
    expect(
      (parseStagingManifest({ ...source, artifacts: [artifact] }).artifacts as Record<
        string,
        unknown
      >)["validation-summary"],
    ).toMatchObject({
      ...artifact,
      staging_path:
        "runs/uk-spine-v2-fixture/artifacts/validation-summary.json",
    });
    expect(() =>
      parseStagingManifest({
        ...source,
        artifacts: [{ ...artifact, artifact_kind: "population_rows" }],
      }),
    ).toThrow(IncompatibleStagingDataError);
    expect(() =>
      parseStagingManifest({
        ...source,
        artifacts: [artifact, artifact],
      }),
    ).toThrow(/appears more than once/);
    expect(() =>
      parseStagingManifest({
        ...source,
        artifacts: [{ ...artifact, sha256: "not-a-digest" }],
      }),
    ).toThrow(/invalid digest/);
  });

  test("reports unknown versions as incompatible data", () => {
    const cases = json("v2", "contract-cases.json");
    expect(() => parseStagingManifest(cases.unknown_version)).toThrow(
      /Incompatible staging data: unsupported manifest schema version 999/,
    );
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  completeLines,
  discoverLocalRuns,
  loadLocalRunDocuments,
  localRunCountry,
  localRunRoots,
  localRunsEnabled,
} from "./local-build-runs";

let root = "";

async function writeRun(directory: string, runId: string, extraEvent = "") {
  const runDir = path.join(root, directory, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "progress.json"),
    JSON.stringify({
      schema_version: 1,
      run_id: runId,
      candidate_release_id: runId,
      status: "running",
      stage: "target_compilation",
      started_at: "2026-09-26T10:00:00+00:00",
      updated_at: "2026-09-26T10:05:00+00:00",
    }),
  );
  await writeFile(
    path.join(runDir, "events.ndjson"),
    [
      JSON.stringify({ time: "2026-09-26T10:00:00+00:00", type: "stage", status: "running", stage: "created" }),
      JSON.stringify({ time: "2026-09-26T10:05:00+00:00", type: "stage", status: "running", stage: "target_compilation" }),
    ].join("\n") +
      "\n" +
      extraEvent,
  );
  return runDir;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "build-monitor-"));
  await writeRun("release-a/staging/runs", "run-a");
  // A partial last line, as when the build is mid-write.
  await writeRun("release-b/staging/runs", "run-b", '{"time": "2026-09-26T10:06');
  await mkdir(path.join(root, "release-a/checkpoints/runs/hidden"), { recursive: true });
  await writeFile(path.join(root, "release-a/checkpoints/runs/hidden/progress.json"), "{}");
  await writeFile(path.join(root, "release-a/checkpoints/runs/hidden/events.ndjson"), "");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local run discovery", () => {
  test("is off unless the environment names a directory", () => {
    expect(localRunsEnabled({})).toBe(false);
    expect(localRunRoots({ MICROCOSM_LOCAL_RUNS_DIR: ` /a${path.delimiter}/b ` })).toEqual(["/a", "/b"]);
  });

  test("finds run folders and skips checkpoint trees", async () => {
    const runs = await discoverLocalRuns([root]);
    expect(runs.map((run) => run.run_id).sort()).toEqual(["run-a", "run-b"]);
  });

  test("reads a run and drops a partially written event", async () => {
    const [runB] = (await discoverLocalRuns([root])).filter((run) => run.run_id === "run-b");
    const documents = await loadLocalRunDocuments(runB, "us");
    expect(documents.source).toBe("local");
    expect(documents.events).toHaveLength(2);
    expect(localRunCountry(documents)).toBe("us");
  });

  test("keeps only complete lines", () => {
    expect(completeLines("a\nb\n")).toBe("a\nb\n");
    expect(completeLines("a\nb")).toBe("a\n");
    expect(completeLines("partial")).toBe("");
    expect(completeLines(null)).toBeNull();
  });
});

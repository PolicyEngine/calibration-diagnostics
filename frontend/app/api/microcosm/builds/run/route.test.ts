import { expect, test } from "bun:test";

import type { loadBuildRun } from "@/lib/microcosm/build-runs";
import { InvalidReleaseIdError } from "@policyengine/calibration-tree/latest-artifact";
import { createBuildRunHandler } from "./route";

// The loaders check a run ID against the run ID allowlist before reading a
// source, and throw for an ID that fails it.
const loadRunCheckingIds = (async () => {
  throw new InvalidReleaseIdError("Invalid run id");
}) as typeof loadBuildRun;

function runDetailUrl(runId: string): string {
  return `http://localhost/api/microcosm/builds/run?country=us&source=staging&id=${encodeURIComponent(runId)}`;
}

test("a run ID that cannot name any run is not found, so the page gives way to the default run", async () => {
  const handler = createBuildRunHandler(loadRunCheckingIds);

  // A pasted link's closing bracket, and an ID longer than any run ID.
  for (const runId of ["populace-us-2024-65671e1-9434c504ba2a-20261103T095117Z)", `run-${"x".repeat(130)}`]) {
    const response = await handler(new Request(runDetailUrl(runId)));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ detail: `Run ${runId} was not found.` });
  }
});

test("a run ID only the collector's wider ID rule allows still opens", async () => {
  // The collector accepts colons and IDs up to 192 characters, which the
  // Hugging Face allowlist does not; the loader finds such a run in the
  // collector's list.
  const runId = "populace-us-2024:smoke-20261109T120000Z";
  const requested: string[] = [];
  const loadRunFromCollector = (async (_source, _country, id) => {
    requested.push(id);
    return { run: { run_id: id } };
  }) as typeof loadBuildRun;
  const handler = createBuildRunHandler(loadRunFromCollector);

  const response = await handler(new Request(runDetailUrl(runId)));
  expect(response.status).toBe(200);
  expect(requested).toEqual([runId]);
});

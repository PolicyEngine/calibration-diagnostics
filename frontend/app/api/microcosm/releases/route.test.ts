import { expect, test } from "bun:test";

import { emptyCalibrationTreeManifest } from "@policyengine/calibration-tree/calibration-tree-manifest";
import type { ReleaseEntry } from "@policyengine/calibration-tree/latest-artifact";
import { createMicrocosmReleasesHandler } from "./route";

// Synthetic Microcosm line (microcosm#823): a folder on main and its cuts.
const LINE = "microcosm-uk-2024-25-national";
const CUT = `${LINE}-20261019T083323Z-0a1b2c3d`;
const DENSE_CUT = "microcosm-uk-2024-25-dense-20261019T000432Z-4e5f6a7b";

function release(id: string, date: string, extra: Partial<ReleaseEntry> = {}): ReleaseEntry {
  return {
    release_id: id,
    date,
    files: [],
    has_calibration: true,
    dataset_role: null,
    is_default: true,
    is_local_area: false,
    ...extra,
  };
}

const FOLDERS = [
  release("populace-uk-2023-test-20260619T023711Z", "20260619T023711Z"),
  release(LINE, LINE),
];

function handler(options: { manifestFails?: boolean } = {}) {
  return createMicrocosmReleasesHandler({
    loadReleases: async () => FOLDERS,
    loadPointerReleaseId: async () => ({
      release_id: CUT,
      updated_at: "2026-10-19T10:21:22.000Z",
    }),
    readManifest: async () => {
      if (options.manifestFails) throw new Error("Blob unavailable");
      return { manifest: emptyCalibrationTreeManifest(), etag: '"manifest"' };
    },
    loadPublishedCutReleases: async () => [
      release(CUT, "20261019T083323Z", { release_directory: LINE }),
      release(DENSE_CUT, "20261019T000432Z", {
        release_directory: "microcosm-uk-2024-25-dense",
        dataset_role: "non_default_local_area",
        is_default: false,
        is_local_area: true,
      }),
    ],
  });
}

test("the release inventory lists published cuts and defaults to the latest cut", async () => {
  const response = await handler()(
    new Request("https://dashboard.example/api/microcosm/releases?country=uk"),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  // The deployment smoke check requires the default to be listed.
  expect(body.default_release_id).toBe(CUT);
  expect(body.latest_release_id).toBe(CUT);
  expect(body.releases.map((entry: ReleaseEntry) => entry.release_id)).toEqual([
    CUT,
    DENSE_CUT,
    "populace-uk-2023-test-20260619T023711Z",
  ]);
  expect(body.releases[1]).toMatchObject({ is_local_area: true, is_default: false });
});

test("without the dashboard manifest the inventory keeps the folder listing", async () => {
  const response = await handler({ manifestFails: true })(
    new Request("https://dashboard.example/api/microcosm/releases?country=uk"),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.releases.map((entry: ReleaseEntry) => entry.release_id)).toEqual(
    FOLDERS.map((entry) => entry.release_id),
  );
});

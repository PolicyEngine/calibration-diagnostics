import { expect, test } from "bun:test";

import {
  finalizeCountry,
  type ManifestCountry,
  type MeasurementDocument,
  type PanelSummary,
  type PlannedPoint,
  type ReleaseHistoryManifest,
  type SeriesBuild,
  type SeriesRecord,
} from "./release-history-store";
import {
  defaultPanelId,
  panelPresentation,
  releaseHistorySummary,
} from "./release-history-summary";
import { readCountryFixture } from "./test-support/release-history-fixture-store";
import { measurementDocument } from "./test-support/release-history-documents";

const LINE = "zz-national";
const EARLIER = "a".repeat(64);
const NEWER = "b".repeat(64);
const OFF_BRANCH = "c".repeat(64);
const file = (index: number) => index.toString(16).padStart(64, "0");

function build(index: number): SeriesBuild {
  return {
    build_id: `${LINE}/b${index}`,
    release: LINE,
    build: `b${index}`,
    release_directory: `${LINE}/b${index}`,
    published_at: `2026-11-${String(index).padStart(2, "0")}T00:00:00Z`,
    withdrawn: false,
    current: false,
    in_default_release: true,
    role: "national",
    digest: file(index),
    dataset_path: `releases/${LINE}/b${index}/zz.h5`,
    release_manifest_sha256: "f".repeat(64),
    listing_status: "ok",
    listing_reason: null,
  };
}

const SERIES: SeriesRecord = {
  format_version: 1,
  kind: "release_history.series",
  country: "zz",
  release_repo: "policyengine/zz",
  rule: { releases: [LINE], since: null },
  revision: "main",
  commit: "1".repeat(40),
  listed_at: "2026-11-12T00:00:00Z",
  record: { present: true, sha256: "d".repeat(64), default: LINE },
  lines: [{ release: LINE, present: true, role: "national" }],
  builds: [build(1), build(2), build(3)],
};

function point(panelId: string, index: number): MeasurementDocument {
  return measurementDocument({ country: "zz", panelId, measurementId: `${index}`.padStart(64, "9"), digest: file(index) });
}

function panel(panelId: string, version: string, spec = "s".repeat(64)): PanelSummary {
  return {
    panelId,
    engine: { policyengine: "6.16.1", model: `policyengine-zz==${version}`, core: "policyengine-core==3.33.3" },
    specSha256: spec,
    producerVersion: "1",
  };
}

function planned(index: number): PlannedPoint {
  return {
    build_id: `${LINE}/b${index}`,
    release_directory: `${LINE}/b${index}`,
    hf_repo: "policyengine/zz",
    hf_commit: "1".repeat(40),
    digest: file(index),
    attempt: 1,
    last_attempt: false,
  };
}

/** The earlier engine's panel, complete, pinned and served. */
function afterFirstBackfill(): ManifestCountry {
  return finalizeCountry({
    entry: undefined,
    panel: panel(EARLIER, "1.0.0"),
    series: SERIES,
    mode: "backfill",
    planned: [],
    stored: [1, 2, 3].map((index) => point(EARLIER, index)),
    pin: true,
    at: "2026-11-05T00:00:00Z",
  });
}

/** An engine bump whose first top-up stored two of three files; the third is retrying. */
function midBump(): ManifestCountry {
  return finalizeCountry({
    entry: afterFirstBackfill(),
    panel: panel(NEWER, "1.1.0"),
    series: SERIES,
    mode: "topup",
    planned: [planned(1), planned(2), planned(3)],
    stored: [1, 2].map((index) => point(NEWER, index)),
    pin: true,
    at: "2026-11-10T00:00:00Z",
  });
}

function manifest(entry: ManifestCountry): ReleaseHistoryManifest {
  return { formatVersion: 1, updatedAt: "2026-11-10T00:00:00Z", countries: { zz: entry } };
}

test("a country with one complete panel opens it", () => {
  const summary = releaseHistorySummary("zz", manifest(afterFirstBackfill()));
  expect(summary).toMatchObject({
    country: "zz",
    available: true,
    defaultPanelId: EARLIER,
    pinnedPanelId: EARLIER,
    servedPanelId: EARLIER,
  });
  expect(summary.panels).toHaveLength(1);
  expect(summary.panels[0]).toMatchObject({
    panelId: EARLIER,
    engine: { policyengine: "6.16.1", model: "policyengine-zz==1.0.0", core: "policyengine-core==3.33.3" },
    pinned: true,
    served: true,
    complete: true,
    sameDefinitionAsDefault: true,
    coverage: { builds: 3, files: 3, measured: 3, missing: 0 },
  });
});

test("after an engine bump the page opens the served panel until the pinned one is complete", () => {
  const filling = midBump();
  expect(filling.pinnedPanelId).toBe(NEWER);
  expect(filling.currentPanelId).toBe(EARLIER);
  const summary = releaseHistorySummary("zz", manifest(filling));
  expect(summary.defaultPanelId).toBe(EARLIER);
  // The default panel is first; the pinned one follows, with what it holds so far.
  expect(summary.panels.map((listed) => [listed.panelId, listed.pinned, listed.served, listed.complete])).toEqual([
    [EARLIER, false, true, true],
    [NEWER, true, false, false],
  ]);
  expect(summary.panels[1].coverage).toMatchObject({ files: 3, measured: 2, retrying: 1 });

  // The next top-up stores the third file: the pinned panel is complete and the page moves.
  const complete = finalizeCountry({
    entry: filling,
    panel: panel(NEWER, "1.1.0"),
    series: SERIES,
    mode: "topup",
    planned: [{ ...planned(3), attempt: 2 }],
    stored: [1, 2, 3].map((index) => point(NEWER, index)),
    pin: true,
    at: "2026-11-17T00:00:00Z",
  });
  const moved = releaseHistorySummary("zz", manifest(complete));
  expect(moved.defaultPanelId).toBe(NEWER);
  expect(moved.panels.map((listed) => listed.panelId)).toEqual([NEWER, EARLIER]);
});

test("a first panel that is still filling opens once it holds a measured file", () => {
  const filling = finalizeCountry({
    entry: undefined,
    panel: panel(EARLIER, "1.0.0"),
    series: SERIES,
    mode: "backfill",
    planned: [planned(1), planned(2), planned(3)],
    stored: [point(EARLIER, 1)],
    pin: true,
    at: "2026-11-05T00:00:00Z",
  });
  expect(filling.currentPanelId).toBeNull();
  expect(defaultPanelId(filling)).toBe(EARLIER);

  // A panel that holds no measured file is not a history yet.
  const nothing = finalizeCountry({
    entry: undefined,
    panel: panel(EARLIER, "1.0.0"),
    series: SERIES,
    mode: "backfill",
    planned: [planned(1)],
    stored: [],
    pin: true,
    at: "2026-11-05T00:00:00Z",
  });
  expect(releaseHistorySummary("zz", manifest(nothing))).toMatchObject({
    available: false,
    defaultPanelId: null,
    panels: [],
  });
});

test("a panel a run from another ref filled is listed, never opened by default, and says when its definition differs", () => {
  const entry = finalizeCountry({
    entry: afterFirstBackfill(),
    panel: panel(OFF_BRANCH, "0.9.0", "t".repeat(64)),
    series: SERIES,
    mode: "release",
    planned: [planned(2)],
    stored: [point(OFF_BRANCH, 2)],
    pin: false,
    at: "2026-11-11T00:00:00Z",
  });
  const summary = releaseHistorySummary("zz", manifest(entry));
  expect(summary.defaultPanelId).toBe(EARLIER);
  expect(summary.panels.map((listed) => [listed.panelId, listed.pinnedAt, listed.sameDefinitionAsDefault])).toEqual([
    [EARLIER, "2026-11-05T00:00:00Z", true],
    [OFF_BRANCH, null, false],
  ]);
  expect(summary.panels[1].coverage).toMatchObject({ measured: 1, missing: 2 });
});

test("a country the manifest does not hold has no history, and never another country's", () => {
  const stored = manifest(afterFirstBackfill());
  expect(releaseHistorySummary("uk", stored)).toEqual({
    country: "uk",
    available: false,
    updatedAt: "2026-11-10T00:00:00Z",
    defaultPanelId: null,
    pinnedPanelId: null,
    servedPanelId: null,
    panels: [],
  });
  expect(releaseHistorySummary("uk", null)).toMatchObject({ available: false, updatedAt: null });
  // A country code that names a property every object has is still no country.
  expect(releaseHistorySummary("constructor", stored).available).toBe(false);
});

test("the summary carries no per-file entry of the manifest", () => {
  const text = JSON.stringify(releaseHistorySummary("zz", manifest(midBump())));
  expect(text).not.toContain("points");
  expect(text).not.toContain("lastError");
  for (const index of [1, 2, 3]) expect(text).not.toContain(file(index));
});

test("each country's panel.json gives the page its currency, periods, order and kinds", async () => {
  const uk = panelPresentation((await readCountryFixture("uk")).panel);
  expect(uk).toMatchObject({
    currency: "GBP",
    periodLabel: "fiscal_year",
    periods: [2026],
    // panel.json holds the hashed spec with its keys sorted, so a map's order is alphabetical;
    // the lists (baseline items, reforms) keep the spec's order.
    povertyMeasures: ["absolute_ahc", "absolute_bhc", "relative_ahc", "relative_bhc"],
    groups: ["all", "children"],
    disclosure: { policy: "source_household_small_cells", minSourceHouseholds: 3 },
  });
  expect(uk.baseline.slice(0, 2)).toEqual([
    { id: "income_tax", kind: "tax", stat: "sum", byDecile: false },
    { id: "national_insurance", kind: "tax", stat: "sum", byDecile: false },
  ]);
  expect(uk.baseline.at(-1)).toEqual({ id: "household_net_income_mean", kind: "income", stat: "mean", byDecile: true });
  expect(uk.reforms[0]).toBe("basic_rate_plus_1p");
  expect(uk.reforms).toHaveLength(7);

  const us = panelPresentation((await readCountryFixture("us")).panel);
  expect(us).toMatchObject({ currency: "USD", periodLabel: "calendar_year", disclosure: { policy: "none" } });

  // No panel.json, or one with another shape: empty lists, never a throw.
  expect(panelPresentation(null)).toEqual({
    currency: null,
    periodLabel: "calendar_year",
    periods: [],
    baseline: [],
    reforms: [],
    povertyMeasures: [],
    groups: [],
    disclosure: { policy: null, minSourceHouseholds: null },
  });
});

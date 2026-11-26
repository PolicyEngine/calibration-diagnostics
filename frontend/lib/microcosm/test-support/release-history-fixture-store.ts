// Test support: an in-memory release history store filled from the producer's committed
// fixtures (release_history/tests/fixtures/<country>/, each country's spec on a synthetic world),
// laid out and finalized as a run of the default branch would leave it.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  countryFilePath,
  encodeDocument,
  finalizeCountry,
  memoryStore,
  panelPrefix,
  updateManifestCountry,
  type MeasurementDocument,
  type PanelDocument,
  type PanelSummary,
  type SeriesRecord,
  type Timeline,
} from "../release-history-store";

const RELEASE_HISTORY = join(import.meta.dir, "..", "..", "..", "..", "release_history");
export const RELEASE_HISTORY_FIXTURES = join(RELEASE_HISTORY, "tests", "fixtures");
export const FIXTURE_FINALIZED_AT = "2026-11-12T00:00:00Z";

async function readFixture<T>(...parts: string[]): Promise<T> {
  return JSON.parse(await readFile(join(...parts), "utf8")) as T;
}

/** A panel's manifest summary, as `scripts/release-history.ts` writes it at finalize. */
export function manifestPanelSummary(panel: PanelDocument): PanelSummary {
  return {
    panelId: panel.panel_id,
    engine: {
      policyengine: panel.engine.policyengine,
      model: `${panel.engine.model.name}==${panel.engine.model.version}`,
      core: `${panel.engine.core.name}==${panel.engine.core.version}`,
    },
    specSha256: panel.spec_sha256,
    producerVersion: panel.producer_version,
  };
}

export interface CountryFixture {
  panel: PanelDocument;
  series: SeriesRecord;
  points: MeasurementDocument[];
  timeline: Timeline;
}

export async function readCountryFixture(country: string): Promise<CountryFixture> {
  const folder = join(RELEASE_HISTORY_FIXTURES, country);
  const points: MeasurementDocument[] = [];
  for (const name of (await readdir(join(folder, "points"))).sort()) {
    points.push(await readFixture<MeasurementDocument>(folder, "points", name));
  }
  return {
    panel: await readFixture<PanelDocument>(folder, "panel.json"),
    series: await readFixture<SeriesRecord>(folder, "series.json"),
    points,
    timeline: await readFixture<Timeline>(folder, "timeline.json"),
  };
}

/** The store after one backfill of each country on the default branch. */
export async function fixtureStore(countries: readonly string[] = ["uk", "us"]) {
  const store = memoryStore();
  const fixtures: Record<string, CountryFixture> = {};
  for (const country of countries) {
    const fixture = await readCountryFixture(country);
    fixtures[country] = fixture;
    const folder = join(RELEASE_HISTORY_FIXTURES, country);
    const write = (path: string, document: unknown) =>
      store.write(path, encodeDocument(document), "replace", false);
    await write(countryFilePath(country, "series"), fixture.series);
    await write(countryFilePath(country, "labels"), await readFixture(folder, "labels.json"));
    await write(
      countryFilePath(country, "references"),
      await readFixture(RELEASE_HISTORY, "countries", country, "references.lock.json"),
    );
    const prefix = panelPrefix(country, fixture.panel.panel_id);
    await write(`${prefix}panel.json`, fixture.panel);
    for (const point of fixture.points) await write(`${prefix}${point.measurement_id}.json`, point);
    await write(`${prefix}timeline.json`, fixture.timeline);
    await updateManifestCountry(store, country, (entry) =>
      finalizeCountry({
        entry,
        panel: manifestPanelSummary(fixture.panel),
        series: fixture.series,
        mode: "backfill",
        planned: [],
        stored: fixture.points,
        pin: true,
        at: FIXTURE_FINALIZED_AT,
      }), FIXTURE_FINALIZED_AT);
  }
  return { store, fixtures };
}

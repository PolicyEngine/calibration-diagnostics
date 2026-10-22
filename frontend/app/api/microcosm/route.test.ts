import { expect, test } from "bun:test";
import fc from "fast-check";

import diagnosticsFixture from "@/lib/microcosm/fixtures/zz-release/calibration_diagnostics.json";
import releaseManifestFixture from "@/lib/microcosm/fixtures/zz-release/release_manifest.json";
import {
  calibrationTreeCountryManifest,
  emptyCalibrationTreeManifest,
} from "@policyengine/calibration-tree/calibration-tree-manifest";
import {
  COUNTRY_REGISTRY,
  DEFAULT_COUNTRY,
  isSelectableCountry,
  type MicrocosmCountry,
} from "@policyengine/calibration-tree/countries";
import {
  buildCalibration,
  microcosmRepo,
  type Calibration,
} from "@policyengine/calibration-tree/latest-artifact";
import { createMicrocosmHandler } from "./route";

// One release per published country, each built by the production builder
// from the same diagnostics, so the response can only carry the requested
// country's identity if the route asked for that country.
function release(country: MicrocosmCountry, releaseManifest: object): Calibration {
  return buildCalibration(
    diagnosticsFixture,
    `microcosm-${country}-route-fixture`,
    "2026-10-20T00:00:00Z",
    {},
    releaseManifest as Record<string, unknown>,
    {},
    country,
  );
}

// Belgium is registered but unpublished here: a newly registered country
// before its first publication. The UK release's manifest claims to be the
// US one; the country block cannot re-route a release.
const PUBLISHED: Partial<Record<MicrocosmCountry, Calibration>> = {
  us: release("us", releaseManifestFixture),
  uk: release("uk", { ...releaseManifestFixture, country: { code: "us", label: "United States" } }),
};

function handler(calls: MicrocosmCountry[] = []) {
  return createMicrocosmHandler({
    loadRelease: async (_release, _revalidate, country = DEFAULT_COUNTRY) => {
      calls.push(country);
      const calibration = PUBLISHED[country];
      // The production lookup: a country the dashboard manifest has no entry
      // for raises the not-configured error.
      if (!calibration) calibrationTreeCountryManifest(emptyCalibrationTreeManifest(), country);
      return calibration as Calibration;
    },
  });
}

function microcosmRequest(country: string | null): Request {
  const url = new URL("https://dashboard.example/calibration/dashboard/api/microcosm");
  if (country != null) url.searchParams.set("country", country);
  return new Request(url);
}

test("a known-but-unconfigured country is not configured and never another country's release", async () => {
  const calls: MicrocosmCountry[] = [];
  const response = await handler(calls)(microcosmRequest("nz"));

  expect(response.status).toBe(404);
  const body = await response.json();
  expect(body).toEqual({
    error: "country_not_configured",
    requested_country: "nz",
    reason: "unknown_country",
    detail: 'No Microcosm calibration release is configured for country "nz".',
  });
  expect(body.release_id).toBeUndefined();
  expect(body.source_repo).toBeUndefined();
  // Refused before any release is read.
  expect(calls).toEqual([]);
});

test("a registered country without a published release is not configured", async () => {
  const response = await handler()(microcosmRequest("be"));

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: "country_not_configured",
    requested_country: "be",
    reason: "no_published_release",
    detail: "No Microcosm calibration release has been published for Belgium yet.",
  });
});

test("a published country is served its own release", async () => {
  const response = await handler()(microcosmRequest("uk"));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.release_id).toBe("microcosm-uk-route-fixture");
  expect(body.source_repo).toBe(microcosmRepo("uk"));
  expect(body.calibration.country.code).toBe("uk");
});

// Invariant: for every requested code, the response is that country's own
// release (calibration.country.code, release id and repository all match), or
// an explicit not-configured state naming the code. No parameter selects the
// default country.
async function assertOwnReleaseOrNotConfigured(requested: string | null): Promise<void> {
  const response = await handler()(microcosmRequest(requested));
  const body = await response.json();
  const expected = requested == null || requested === "" ? DEFAULT_COUNTRY : requested;
  if (response.status === 200) {
    expect(isSelectableCountry(expected)).toBe(true);
    expect(body.calibration.country.code).toBe(expected);
    expect(body.release_id).toBe(`microcosm-${expected}-route-fixture`);
    expect(body.source_repo).toBe(microcosmRepo(expected as MicrocosmCountry));
    return;
  }
  expect(response.status).toBe(404);
  expect(body.error).toBe("country_not_configured");
  expect(body.requested_country).toBe(expected);
  expect(body.release_id).toBeUndefined();
  expect(body.calibration).toBeUndefined();
}

test("every two-letter code gets its own release or a not-configured state", async () => {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const served: string[] = [];
  for (const first of letters) {
    for (const second of letters) {
      for (const code of [`${first}${second}`, `${first}${second}`.toUpperCase()]) {
        await assertOwnReleaseOrNotConfigured(code);
        if (PUBLISHED[code as MicrocosmCountry]) served.push(code);
      }
    }
  }
  expect(served.sort()).toEqual(["uk", "us"]);
  await assertOwnReleaseOrNotConfigured(null);
  await assertOwnReleaseOrNotConfigured("");
});

test("property: any requested string gets its own release or a not-configured state", async () => {
  const registered = Object.keys(COUNTRY_REGISTRY);
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.string(),
        fc.stringMatching(/^[A-Za-z]{2,3}$/),
        fc.constantFrom(...registered, ...registered.map((code) => code.toUpperCase())),
      ),
      assertOwnReleaseOrNotConfigured,
    ),
    { numRuns: 500 },
  );
});

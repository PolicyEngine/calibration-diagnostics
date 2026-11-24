import { expect, test } from "bun:test";

import type { CalibrationReleaseLocation } from "@policyengine/calibration-tree/calibration-release-locator";
import type { MicrocosmCountry } from "@policyengine/calibration-tree/countries";

import { maxDuration as releaseRouteMaxDuration } from "../route";
import { createParentBuildHandler, maxDuration } from "./route";

// A US compatibility recertification in its own build folder, the build
// whose calibration it copies, and that build's staging run. The run name is
// the US certified-build tool's own (`populace-us-build-<time>-<hex>`), which
// differs from the build ID.
const RECERTIFIED_BUILD =
  "microcosm-us-2024-national/populace-us-2024-b5db384-recert-pe-us-2.90.4-r085672fa9";
const PARENT_BUILD = "populace-us-2024-b5db384-8b0c1950b65f-20261024T083103Z";
const PARENT_RUN = "populace-us-build-20261024T083103Z-1a2b3c4d";
const COMMIT = "1234567890abcdef1234567890abcdef12345678";

const LOCATION: CalibrationReleaseLocation = {
  buildArtifactId: "a".repeat(64),
  releaseId: RECERTIFIED_BUILD,
  releaseDirectory: RECERTIFIED_BUILD,
  hfCommitSha: COMMIT,
  updatedAt: "2026-11-15T22:20:07.000Z",
};

interface CopyRead {
  buildArtifactId: string;
  country: MicrocosmCountry;
}

function handlerReading(payload: Record<string, unknown> | null) {
  const reads: CopyRead[] = [];
  const resolved: { country: MicrocosmCountry; release: string }[] = [];
  const handler = createParentBuildHandler({
    resolveRelease: async (country, release) => {
      resolved.push({ country, release });
      return LOCATION;
    },
    loadParentManifest: async (location, country) => {
      reads.push({ buildArtifactId: location.buildArtifactId, country });
      return payload;
    },
  });
  return { handler, reads, resolved };
}

function request(query: string): Request {
  return new Request(`https://dashboard.example/api/microcosm/parent-build?${query}`);
}

const RECERTIFIED_QUERY = `country=us&release=${encodeURIComponent(RECERTIFIED_BUILD)}`;

test("reads the parent's staging run from the store's copy of the build's parent build manifest", async () => {
  const { handler, reads, resolved } = handlerReading({
    build_id: PARENT_BUILD,
    staging: { enabled: true, run_id: PARENT_RUN, uploads_succeeded: 711 },
  });

  const response = await handler(request(RECERTIFIED_QUERY));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    release_id: RECERTIFIED_BUILD,
    parent_build_id: PARENT_BUILD,
    staging_run_id: PARENT_RUN,
  });
  expect(resolved).toEqual([{ country: "us", release: RECERTIFIED_BUILD }]);
  expect(reads).toEqual([{ buildArtifactId: LOCATION.buildArtifactId, country: "us" }]);
  expect(response.headers.get("vercel-cdn-cache-control")).toContain("max-age=");
});

test("a parent built without staging has no staging run", async () => {
  const { handler } = handlerReading({
    build_id: PARENT_BUILD,
    staging: { enabled: false, reason: "local build" },
  });

  const response = await handler(request(RECERTIFIED_QUERY));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    release_id: RECERTIFIED_BUILD,
    parent_build_id: PARENT_BUILD,
    staging_run_id: null,
  });
});

test("a build without a parent build manifest names no parent and no staging run", async () => {
  const { handler } = handlerReading(null);

  const response = await handler(request(RECERTIFIED_QUERY));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    release_id: RECERTIFIED_BUILD,
    parent_build_id: null,
    staging_run_id: null,
  });
});

test("requires a valid release and reads nothing without one", async () => {
  const { handler, reads, resolved } = handlerReading({ build_id: PARENT_BUILD });

  expect((await handler(request("country=us"))).status).toBe(400);
  expect((await handler(request("country=us&release=..%2Fsecrets"))).status).toBe(400);
  expect(resolved).toEqual([]);
  expect(reads).toEqual([]);
});

test("refuses an unselectable country without reading anything", async () => {
  const { handler, reads, resolved } = handlerReading({ build_id: PARENT_BUILD });

  const response = await handler(
    request(`country=zz&release=${encodeURIComponent(RECERTIFIED_BUILD)}`),
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: "country_not_configured" });
  expect(resolved).toEqual([]);
  expect(reads).toEqual([]);
});

test("a release the tree manifest does not hold is not found", async () => {
  const handler = createParentBuildHandler({
    resolveRelease: async () => {
      throw new Error("No matching calibration build exists for us.");
    },
    loadParentManifest: async () => {
      throw new Error("must not be read");
    },
  });

  const response = await handler(request(RECERTIFIED_QUERY));

  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("a store failure is reported as unavailable and not cached", async () => {
  const handler = createParentBuildHandler({
    resolveRelease: async () => LOCATION,
    loadParentManifest: async () => {
      throw new Error("Vercel Blob: Failed to fetch blob: 500");
    },
  });

  const response = await handler(request(RECERTIFIED_QUERY));

  expect(response.status).toBe(502);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

// The store read can be as slow as the release route's; a route limit no
// longer than that ends a slow read with the platform's timeout instead of
// this route's uncached 502.
test("allows as long as the release route, which reads the same store", () => {
  expect(maxDuration).toBeGreaterThanOrEqual(releaseRouteMaxDuration);
});

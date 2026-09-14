// Child-process fixture for reviewed-repository-import.test.ts. It reports what
// importing the server data layer and the routes that read a country repository
// does under a given deployment environment, so the test can observe
// module-import behaviour: `bun test` shares one module registry across every
// test file, so an in-process dynamic import would only ever see whichever
// environment the first importing file happened to set.

import {
  microcosmCountryGeography,
  microcosmRepo,
  microcosmRevision,
} from "./latest-artifact";
import { IncompatibleProductionReleaseError } from "./production-release";

// Collecting page data imports every route, so one country's refused selection
// must not break any of these imports.
const ROUTES: Record<string, () => Promise<unknown>> = {
  "hf-webhook": () => import("../../app/api/hf-webhook/route"),
  microcosm: () => import("../../app/api/microcosm/route"),
  releases: () => import("../../app/api/microcosm/releases/route"),
  variable: () => import("../../app/api/microcosm/variable/route"),
  microcosm_variable: () => import("../../app/api/microcosm_variable/route"),
};

function attempt(read: () => string): string {
  try {
    return `ok:${read()}`;
  } catch (error) {
    if (error instanceof IncompatibleProductionReleaseError) {
      return `refused:${error.status}`;
    }
    return `threw:${error instanceof Error ? error.message : String(error)}`;
  }
}

const routeImports: Record<string, string> = {};
for (const [name, load] of Object.entries(ROUTES)) {
  try {
    await load();
    routeImports[name] = "ok";
  } catch (error) {
    routeImports[name] = `threw:${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

// A release tag on one country's repository, through the real webhook handler.
async function releaseTag(repo: string): Promise<string> {
  const route = (await ROUTES["hf-webhook"]()) as {
    POST: (request: Request) => Promise<Response>;
  };
  const response = await route.POST(
    new Request("https://fixture.example/api/hf-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-secret": process.env.HF_WEBHOOK_SECRET ?? "",
      },
      body: JSON.stringify({
        repo: { name: repo },
        updatedRefs: [
          { ref: "refs/tags/fixture-release", oldSha: null, newSha: "fixture" },
        ],
      }),
    }),
  );
  return `${response.status}:${JSON.stringify(await response.json())}`;
}

console.log(
  JSON.stringify({
    imported: true,
    us_repo: attempt(() => microcosmRepo("us")),
    us_revision: attempt(() => microcosmRevision("us")),
    uk_repo: attempt(() => microcosmRepo("uk")),
    be_repo: attempt(() => microcosmRepo("be")),
    be_revision: attempt(() => microcosmRevision("be")),
    be_geography: attempt(() => microcosmCountryGeography("be")),
    route_imports: routeImports,
    reviewed_us_tag: await releaseTag("policyengine/populace-us"),
    uk_tag: await releaseTag("policyengine/populace-uk-private"),
  }),
);

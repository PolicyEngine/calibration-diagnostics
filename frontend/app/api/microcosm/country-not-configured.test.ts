import { afterAll, beforeAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Every dashboard API route that takes `?country=` must answer a code with no
// configured release with the explicit not-configured response, before any
// other validation and before reading any artifact. Production answered
// `?country=nz` with the US release on 2026-10-20.

type RouteModule = { GET: (request: Request) => Promise<Response> };

const COUNTRY_ROUTES: Record<string, () => Promise<RouteModule>> = {
  "microcosm": () => import("./route"),
  "microcosm/builds": () => import("./builds/route"),
  "microcosm/builds/run": () => import("./builds/run/route"),
  "microcosm/compare": () => import("./compare/route"),
  "microcosm/comparison-tree": () => import("./comparison-tree/route"),
  "microcosm/comparison-tree/target-detail": () =>
    import("./comparison-tree/target-detail/route"),
  "microcosm/cross-dataset": () => import("./cross-dataset/route"),
  "microcosm/deployments": () => import("./deployments/route"),
  "microcosm/releases": () => import("./releases/route"),
  "microcosm/staging/compare": () => import("./staging/compare/route"),
  "microcosm/staging/run": () => import("./staging/run/route"),
  "microcosm/staging/runs": () => import("./staging/runs/route"),
  "microcosm/staging/target-change-tree": () => import("./staging/target-change-tree/route"),
  "microcosm/staging/target-diagnostics": () => import("./staging/target-diagnostics/route"),
  "microcosm/staging/target-tree": () => import("./staging/target-tree/route"),
  "microcosm/target-diagnostics": () => import("./target-diagnostics/route"),
  "microcosm/target-investigation": () => import("./target-investigation/route"),
  "microcosm/target-treemap": () => import("./target-treemap/route"),
  "microcosm/tree": () => import("./tree/route"),
  "microcosm/tree-manifest": () => import("./tree-manifest/route"),
};

// Every other parameter a route validates, so the country is the only
// problem with the request.
const OTHER_PARAMETERS = {
  id: "run-1",
  run: "run-1",
  a: "a".repeat(64),
  b: "b".repeat(64),
  build: "c".repeat(64),
  release: "microcosm-us-2024",
  part: "index",
  mode: "reported",
  target: "0",
};

const NOT_CONFIGURED_CODES = ["nz", "NZ", "fr", "US", "zz", "am", " us", "us,uk"];

let fetchCalls: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input instanceof Request ? input.url : input));
    throw new Error("A not-configured country must not reach the network.");
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function routeRequest(path: string, country: string): Request {
  const url = new URL(`https://dashboard.example/calibration/dashboard/api/${path}`);
  for (const [name, value] of Object.entries(OTHER_PARAMETERS)) {
    url.searchParams.set(name, value);
  }
  url.searchParams.set("country", country);
  return new Request(url);
}

for (const [path, load] of Object.entries(COUNTRY_ROUTES)) {
  test(`/api/${path} refuses a country with no configured release before reading anything`, async () => {
    const { GET } = await load();
    for (const country of NOT_CONFIGURED_CODES) {
      fetchCalls = [];
      const response = await GET(routeRequest(path, country));
      expect({ country, status: response.status }).toEqual({ country, status: 404 });
      const body = await response.json();
      expect(body).toMatchObject({
        error: "country_not_configured",
        requested_country: country,
        reason: "unknown_country",
      });
      expect(typeof body.detail).toBe("string");
      expect(fetchCalls).toEqual([]);
    }
  });
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

test("every API route that reads a country goes through the shared resolver", () => {
  const apiRoot = join(import.meta.dir, "..");
  const usesResolver: string[] = [];
  for (const file of routeFiles(apiRoot)) {
    const source = readFileSync(file, "utf8");
    const route = relative(apiRoot, file).replace(/\/?route\.ts$/, "");
    // A route reading the parameter itself could fall back to a default.
    expect({ route, readsCountryDirectly: /get\(\s*["']country["']\s*\)/.test(source) }).toEqual({
      route,
      readsCountryDirectly: false,
    });
    if (/\b(requestedCountry|requiredCountry)\(/.test(source)) usesResolver.push(route);
  }
  expect(usesResolver.sort()).toEqual(Object.keys(COUNTRY_ROUTES).sort());
});

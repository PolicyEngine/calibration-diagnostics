import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GET as unifiedGet } from "./route";
import { GET as nativeGet } from "../../microcosm_variable/route";
import { HOSTED_US_RELEASE } from "@/lib/microcosm/production-release";

const fixtureKeys = [
  "VERCEL",
  "VERCEL_GIT_COMMIT_SHA",
  "MICROCOSM_CALCULATION_URL",
  "MICROCOSM_MODAL_KEY",
  "MICROCOSM_MODAL_SECRET",
  "MICROCOSM_BACKEND_SOURCE_COMMIT",
] as const;

const savedEnvironment: Partial<Record<(typeof fixtureKeys)[number], string>> = {};
beforeEach(() => {
  for (const key of fixtureKeys) savedEnvironment[key] = process.env[key];
});
afterEach(() => {
  for (const key of fixtureKeys) {
    if (savedEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnvironment[key];
  }
});

for (const [path, get] of [
  ["/api/microcosm/variable", unifiedGet],
  ["/api/microcosm_variable", nativeGet],
] as const) {
  for (const selection of ["metadata=1", "variable=snap"]) {
    test(`${path} never forwards runtime_audit with ${selection} and private backend auth`, async () => {
      process.env.VERCEL = "1";
      process.env.MICROCOSM_CALCULATION_URL = "https://fixture--calibration.modal.run";
      process.env.MICROCOSM_MODAL_KEY = "synthetic-fixture-key";
      process.env.MICROCOSM_MODAL_SECRET = "synthetic-fixture-secret";
      process.env.MICROCOSM_BACKEND_SOURCE_COMMIT = "fixture-source";
      delete process.env.VERCEL_GIT_COMMIT_SHA;
      const calls: URL[] = [];
      const mockFetch = Object.assign(async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
        const url = new URL(String(input));
        calls.push(url);
        const headers = new Headers(init?.headers);
        expect(headers.get("Modal-Key")).toBe("synthetic-fixture-key");
        expect(headers.get("Modal-Secret")).toBe("synthetic-fixture-secret");
        expect(url.pathname).toBe("/api/microcosm_variable");
        expect(url.searchParams.has("runtime_audit")).toBe(false);
        if (selection === "metadata=1") {
          expect(url.searchParams.toString()).toBe("metadata=1");
        } else {
          expect([...url.searchParams.entries()]).toEqual([
            ["period", String(HOSTED_US_RELEASE.data_year)],
            ["release", HOSTED_US_RELEASE.release_id],
            ["variables", "snap"],
          ]);
        }
        return Response.json({ detail: "Fixture backend unavailable" }, { status: 503 });
      }, { preconnect: globalThis.fetch.preconnect });
      const fetch = spyOn(globalThis, "fetch").mockImplementation(mockFetch);
      try {
        const response = await get(new Request(`https://public.example${path}?${selection}&runtime_audit=fixture-nonce-012345`));
        expect(response.status).toBe(503);
        expect(calls).toHaveLength(1);
        expect(await response.json()).toEqual({ detail: "Fixture backend unavailable" });
      } finally {
        fetch.mockRestore();
      }
    });
  }
}

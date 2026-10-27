import { afterEach, expect, test } from "bun:test";

import type { CountryNotConfiguredBody } from "@policyengine/calibration-tree/countries";

import { ApiError, apiGet, countryNotConfiguredError } from "./client";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respondWith(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the request to fail.");
}

test("a not-configured response surfaces as a typed error the views can recognize", async () => {
  const body: CountryNotConfiguredBody = {
    error: "country_not_configured",
    requested_country: "nz",
    reason: "unknown_country",
    detail: 'No Microcosm calibration release is configured for country "nz".',
  };
  respondWith(404, body);

  const error = await rejection(apiGet("/microcosm", { country: "nz" }));

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(404);
  expect((error as ApiError).message).toBe(body.detail);
  expect(countryNotConfiguredError(error)).toEqual(body);
});

test("any other failure keeps its detail and is not a not-configured state", async () => {
  respondWith(502, { detail: "HF fetch failed 500" });

  const error = await rejection(apiGet("/microcosm", { country: "us" }));

  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).message).toBe("HF fetch failed 500");
  expect(countryNotConfiguredError(error)).toBeNull();
  expect(countryNotConfiguredError(new Error("plain"))).toBeNull();
});

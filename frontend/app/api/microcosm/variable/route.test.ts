import { afterEach, expect, test } from "bun:test";
import { GET } from "./route";

const savedVercel = process.env.VERCEL;
afterEach(() => {
  if (savedVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
});

for (const query of ["variable=snap&period=", "variable=snap&release="]) {
  test(`unified route preserves explicit blank rejection: ${query}`, async () => {
    process.env.VERCEL = "1";
    const response = await GET(
      new Request(`https://example.test/api/microcosm/variable?${query}`),
    );
    expect(response.status).toBe(400);
  });
}

for (const query of [
  "variable=snap&period=2026",
  "variable=snap&release=latest",
]) {
  test(`unified route rejects incompatible selections: ${query}`, async () => {
    process.env.VERCEL = "1";
    const response = await GET(
      new Request(`https://example.test/api/microcosm/variable?${query}`),
    );
    expect(response.status).toBe(409);
  });
}

test("native alias uses the same metadata boundary", async () => {
  const { GET: nativeGet } = await import("../../microcosm_variable/route");
  expect(nativeGet).toBe(GET);
  // Missing backend configuration is reported after metadata parsing, rather
  // than the 'enter a variable' 400 that the former Node boundary produced.
  const response = await nativeGet(
    new Request("https://example.test/api/microcosm_variable?metadata=1"),
  );
  expect(response.status).toBe(503);
});

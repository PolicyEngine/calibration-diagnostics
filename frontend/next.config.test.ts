import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import config from "./next.config";

// Initialize Next's Node globals before its test utility creates async stores.
if (!("AsyncLocalStorage" in globalThis)) Object.assign(globalThis, { AsyncLocalStorage });
const {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} = await import("next/experimental/testing/server");

test("the bare domain root redirects to the mounted dashboard", async () => {
  const prefix = config.basePath ?? "";
  const redirects = await config.redirects!();
  if (prefix) {
    expect(redirects).toContainEqual({
      source: "/",
      destination: `${prefix}/microcosm`,
      basePath: false,
      permanent: false,
    });
  } else {
    expect(redirects.some((redirect) => redirect.source === "/")).toBe(false);
  }
});

test("Next.js compiles the calibration tree package, which ships TypeScript source", () => {
  expect(config.transpilePackages ?? []).toContain("@policyengine/calibration-tree");
});

test("legacy Microcosm API URLs retain redirects at root and mounted paths", async () => {
  const prefix = config.basePath ?? "";
  const redirects = await config.redirects!();
  for (const sourcePrefix of prefix ? ["", prefix] : [""]) {
    for (const [source, target] of [
      ["/api/populace_variable", "/api/microcosm_variable"], // compat: populace alias, remove after 0.2.0
      ["/api/populace/:path*", "/api/microcosm/:path*"], // compat: populace alias, remove after 0.2.0
    ]) {
      expect(redirects).toContainEqual({
        source: `${sourcePrefix}${source}`,
        destination: `${prefix}${target}`,
        basePath: false,
        permanent: false,
      });
      for (const suffix of source.includes(":path*") ? ["", "/us/calibration"] : [""]) {
        for (const query of ["", "?country=uk&release=reviewed"]) {
          const response = await unstable_getResponseFromNextConfig({
            url: `https://example.com${sourcePrefix}${source.replace("/:path*", suffix)}${query}`,
            nextConfig: config,
          });
          expect(response.status).toBe(307);
          expect(getRedirectUrl(response)).toBe(
            `https://example.com${prefix}${target.replace("/:path*", suffix)}${query}`,
          );
        }
      }
    }
  }
});

test.skipIf(!config.basePath)("legacy Microcosm UI URLs use the mount once and retain suffixes", async () => {
  const prefix = config.basePath!;
  for (const sourcePrefix of ["", prefix]) {
    for (const suffix of ["", "/us/builds/2026"]) {
      const source = `${sourcePrefix}/populace${suffix}`; // compat: populace alias, remove after 0.2.0
      for (const query of ["", "?country=uk&release=reviewed"]) {
        const response = await unstable_getResponseFromNextConfig({
          url: `https://example.com${source}${query}`,
          nextConfig: config,
        });
        expect(response.status).toBe(307);
        expect(getRedirectUrl(response)).toBe(
          `https://example.com${prefix}/microcosm${suffix}${query}`,
        );
      }
    }
  }
});

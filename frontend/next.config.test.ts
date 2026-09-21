import { expect, test } from "bun:test";
import config from "./next.config";

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

test("former Populace API URLs retain redirects at root and mounted paths", async () => {
  const prefix = config.basePath ?? "";
  const redirects = await config.redirects!();
  for (const sourcePrefix of prefix ? ["", prefix] : [""]) {
    for (const [source, target] of [
      ["/api/populace_variable", "/api/microcosm_variable"],
      ["/api/populace/:path*", "/api/microcosm/:path*"],
    ]) {
      expect(redirects).toContainEqual({
        source: `${sourcePrefix}${source}`,
        destination: `${prefix}${target}`,
        basePath: false,
        permanent: false,
      });
    }
  }
});

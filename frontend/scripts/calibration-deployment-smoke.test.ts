import { expect, test } from "bun:test";

import { verifyCalibrationDeployment } from "./calibration-deployment-smoke";
import { hasCapability, selectableCountries } from "../lib/microcosm/countries";

type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;

function healthyResponse(url: URL): Response {
  const country = url.searchParams.get("country")!;
  const release = `${country}-published-release`;
  if (url.pathname.endsWith("/staging/runs")) {
    return Response.json({ available: true, runs: [] });
  }
  if (url.pathname.endsWith("/releases")) {
    return Response.json({
      default_release_id: release,
      latest_release_id: release,
      releases: [{ release_id: release, has_calibration: true }],
    });
  }
  return Response.json({
    release_id: release,
    calibration: {
      available: true,
      country: { code: country },
      total_targets: 2,
    },
  });
}

test("qualifies every registered release country and its available staging view", async () => {
  const requests: URL[] = [];
  const fetcher: Fetcher = async (input, options) => {
    const url = new URL(input);
    requests.push(url);
    expect(options?.headers).toEqual({
      "x-vercel-protection-bypass": "test-bypass",
    });
    expect(options?.cache).toBe("no-store");
    expect(options?.redirect).toBe("error");
    return healthyResponse(url);
  };

  const receipts = await verifyCalibrationDeployment({
    url: "https://candidate.vercel.app/calibration/dashboard/",
    bypassSecret: "test-bypass",
    fetcher,
  });
  const countries = selectableCountries().filter((country) =>
    hasCapability(country, "calibration"),
  );
  expect(receipts.map((receipt) => receipt.country)).toEqual(countries);
  for (const country of countries) {
    const paths = requests
      .filter((url) => url.searchParams.get("country") === country)
      .map((url) => url.pathname);
    expect(paths).toContain("/calibration/dashboard/api/microcosm");
    expect(paths).toContain("/calibration/dashboard/api/microcosm/releases");
    expect(
      paths.includes("/calibration/dashboard/api/microcosm/staging/runs"),
    ).toBe(hasCapability(country, "staging"));
  }
  expect(
    requests.some((url) =>
      ["zz", "am"].includes(url.searchParams.get("country")!),
    ),
  ).toBe(false);
});

for (const country of ["uk", "be"]) {
  test(`rejects ${country} upstream authentication failures even when US works`, async () => {
    const fetcher: Fetcher = async (input) => {
      const url = new URL(input);
      if (url.searchParams.get("country") === country) {
        return Response.json(
          { detail: "HF fetch failed 401" },
          { status: 502 },
        );
      }
      return healthyResponse(url);
    };
    await expect(
      verifyCalibrationDeployment({
        url: "https://candidate.vercel.app/calibration/dashboard",
        fetcher,
      }),
    ).rejects.toThrow(`HTTP 502`);
  });
}

test("rejects a failed release picker after the summary succeeds", async () => {
  const fetcher: Fetcher = async (input) => {
    const url = new URL(input);
    return url.pathname.endsWith("/releases")
      ? Response.json({ detail: "HF tree failed 401" }, { status: 502 })
      : healthyResponse(url);
  };
  await expect(
    verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      fetcher,
    }),
  ).rejects.toThrow("release inventory");
});

test("rejects unavailable staging despite HTTP 200", async () => {
  const fetcher: Fetcher = async (input) => {
    const url = new URL(input);
    return url.pathname.endsWith("/staging/runs")
      ? Response.json({ available: false, runs: [] })
      : healthyResponse(url);
  };
  await expect(
    verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      fetcher,
    }),
  ).rejects.toThrow("staging is unavailable");
});

test("rejects a different country or an empty calibration response", async () => {
  for (const calibration of [
    { available: true, country: { code: "wrong" }, total_targets: 2 },
    { available: true, country: { code: "us" }, total_targets: 0 },
    { available: false, country: { code: "us" }, total_targets: 2 },
  ]) {
    await expect(
      verifyCalibrationDeployment({
        url: "https://candidate.vercel.app/calibration/dashboard",
        fetcher: async () =>
          Response.json({ release_id: "release", calibration }),
      }),
    ).rejects.toThrow("calibration summary");
  }
});

test("rejects a default release missing from the inventory", async () => {
  const fetcher: Fetcher = async (input) => {
    const url = new URL(input);
    return url.pathname.endsWith("/releases")
      ? Response.json({
          default_release_id: "us-published-release",
          releases: [],
        })
      : healthyResponse(url);
  };
  await expect(
    verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      fetcher,
    }),
  ).rejects.toThrow("release inventory");
});

test("rejects an authentication page with HTTP 200", async () => {
  await expect(
    verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      fetcher: async () =>
        new Response("Sign in", {
          headers: { "Content-Type": "text/html" },
        }),
    }),
  ).rejects.toThrow("JSON");
});

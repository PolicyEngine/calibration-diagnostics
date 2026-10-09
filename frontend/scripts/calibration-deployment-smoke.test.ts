import { expect, spyOn, test } from "bun:test";

import { verifyCalibrationDeployment } from "./calibration-deployment-smoke";
import { hasCapability, selectableCountries } from "../lib/microcosm/countries";

type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;
const noSleep = async (_milliseconds: number) => {};

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
        sleep: noSleep,
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
      sleep: noSleep,
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

test("retries a network failure and a 5xx with increasing backoff and fresh 60s timeouts", async () => {
  const backoffs: number[] = [];
  const timeouts: number[] = [];
  const signals: AbortSignal[] = [];
  let attempts = 0;
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
    (milliseconds) => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    },
  );
  try {
    const receipts = await verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      sleep: async (milliseconds) => {
        backoffs.push(milliseconds);
      },
      fetcher: async (input, options) => {
        signals.push(options!.signal!);
        const url = new URL(input);
        if (
          url.searchParams.get("country") === "us" &&
          url.pathname.endsWith("/microcosm")
        ) {
          attempts += 1;
          if (attempts === 1)
            throw new DOMException("Timed out", "TimeoutError");
          if (attempts === 2)
            return Response.json(
              { detail: "Transient outage" },
              { status: 503 },
            );
        }
        return healthyResponse(url);
      },
    });
    expect(receipts.length).toBeGreaterThan(0);
    expect(attempts).toBe(3);
    expect(backoffs).toEqual([1000, 2000]);
    expect(timeouts.every((milliseconds) => milliseconds === 60_000)).toBe(
      true,
    );
    expect(new Set(signals).size).toBe(signals.length);
  } finally {
    timeout.mockRestore();
  }
});

test("stops after two network retries without exposing fetch exception text", async () => {
  let attempts = 0;
  const backoffs: number[] = [];
  await expect(
    verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      sleep: async (milliseconds) => {
        backoffs.push(milliseconds);
      },
      fetcher: async () => {
        attempts += 1;
        throw new Error("Authorization: Bearer secret-network-error");
      },
    }),
  ).rejects.toThrow(
    "us calibration summary failed after 3 attempts due to a network error.",
  );
  expect(attempts).toBe(3);
  expect(backoffs).toEqual([1000, 2000]);
});

test("stops after two 5xx retries and preserves bounded JSON detail", async () => {
  let attempts = 0;
  const backoffs: number[] = [];
  await expect(
    verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      sleep: async (milliseconds) => {
        backoffs.push(milliseconds);
      },
      fetcher: async () => {
        attempts += 1;
        return Response.json(
          { detail: "HF fetch failed 401" },
          { status: 502 },
        );
      },
    }),
  ).rejects.toThrow("returned HTTP 502: HF fetch failed 401");
  expect(attempts).toBe(3);
  expect(backoffs).toEqual([1000, 2000]);
});

for (const status of [400, 401, 403, 404, 429]) {
  test(`does not retry HTTP ${status}`, async () => {
    let attempts = 0;
    const backoffs: number[] = [];
    await expect(
      verifyCalibrationDeployment({
        url: "https://candidate.vercel.app/calibration/dashboard",
        sleep: async (milliseconds) => {
          backoffs.push(milliseconds);
        },
        fetcher: async () => {
          attempts += 1;
          return Response.json(
            { detail: "Credential is not permitted" },
            { status },
          );
        },
      }),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(attempts).toBe(1);
    expect(backoffs).toEqual([]);
  });
}

test("invalid and HTML 5xx bodies do not prevent retries", async () => {
  for (const contentType of ["application/json", "text/html"]) {
    let attempts = 0;
    const backoffs: number[] = [];
    await verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      sleep: async (milliseconds) => {
        backoffs.push(milliseconds);
      },
      fetcher: async (input) => {
        attempts += 1;
        if (attempts === 1)
          return new Response("not JSON <secret>", {
            status: 503,
            headers: { "Content-Type": contentType },
          });
        return healthyResponse(new URL(input));
      },
    });
    expect(backoffs).toEqual([1000]);
  }
});

test("does not retry malformed or semantically unavailable successful responses", async () => {
  const responses = [
    () =>
      new Response("not JSON", {
        headers: { "Content-Type": "application/json" },
      }),
    () => new Response("Sign in", { headers: { "Content-Type": "text/html" } }),
    () =>
      Response.json({
        release_id: "release",
        calibration: {
          available: false,
          country: { code: "us" },
          total_targets: 2,
        },
      }),
    () =>
      Response.json({
        release_id: "release",
        calibration: {
          available: true,
          country: { code: "wrong" },
          total_targets: 2,
        },
      }),
  ];
  for (const response of responses) {
    let attempts = 0;
    const backoffs: number[] = [];
    await expect(
      verifyCalibrationDeployment({
        url: "https://candidate.vercel.app/calibration/dashboard",
        sleep: async (milliseconds) => {
          backoffs.push(milliseconds);
        },
        fetcher: async () => {
          attempts += 1;
          return response();
        },
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(backoffs).toEqual([]);
  }
});

test("bounds JSON error detail, removes control characters, and redacts known credentials", async () => {
  const previousToken = process.env.HF_TOKEN;
  process.env.HF_TOKEN = "test-runtime-token";
  try {
    const failure = await verifyCalibrationDeployment({
      url: "https://candidate.vercel.app/calibration/dashboard",
      bypassSecret: "test-preview-secret",
      fetcher: async () =>
        Response.json(
          {
            detail: `test-runtime-token\n test-preview-secret hf_abc123 Bearer hidden-value ${"x".repeat(500)} tail-marker`,
          },
          { status: 401 },
        ),
    }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toStartWith("us calibration summary returned HTTP 401: ");
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("test-runtime-token");
    expect(message).not.toContain("test-preview-secret");
    expect(message).not.toContain("hf_abc123");
    expect(message).not.toContain("hidden-value");
    expect(message).not.toContain("tail-marker");
    expect(message).not.toContain("\n");
    const prefix = "us calibration summary returned HTTP 401: ";
    expect(message.slice(prefix.length).length).toBeLessThanOrEqual(200);
  } finally {
    if (previousToken === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = previousToken;
  }
});

test("does not expose HTML, invalid JSON, or non-string HTTP error details", async () => {
  const responses = [
    () =>
      new Response("<html>secret-html-body</html>", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    () =>
      new Response("secret-invalid-body", {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    () =>
      Response.json(
        { detail: { secret: "secret-object-detail" } },
        { status: 403 },
      ),
  ];
  for (const response of responses) {
    await expect(
      verifyCalibrationDeployment({
        url: "https://candidate.vercel.app/calibration/dashboard",
        fetcher: async () => response(),
      }),
    ).rejects.toThrow("us calibration summary returned HTTP 403.");
  }
});

test("retries a timeout while consuming the successful JSON response body", async () => {
  let attempts = 0;
  const backoffs: number[] = [];
  await verifyCalibrationDeployment({
    url: "https://candidate.vercel.app/calibration/dashboard",
    sleep: async (milliseconds) => {
      backoffs.push(milliseconds);
    },
    fetcher: async (input) => {
      attempts += 1;
      const response = healthyResponse(new URL(input));
      if (attempts === 1)
        response.json = async () => {
          throw new DOMException("secret response body timeout", "AbortError");
        };
      return response;
    },
  });
  expect(backoffs).toEqual([1000]);
});

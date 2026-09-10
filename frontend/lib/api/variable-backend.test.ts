import { describe, expect, test } from "bun:test";
import { proxyVariableBackend } from "./variable-backend";
import { HOSTED_US_RELEASE } from "../microcosm/production-release";

const config = {
  url: "https://task--calibration.modal.run",
  key: "private-key",
  secret: "private-secret",
  sourceCommit: "reviewed-sha",
};

describe("private calculation backend", () => {
  test("missing configuration fails before making a request", async () => {
    const response = await proxyVariableBackend(
      "variable=snap",
      {},
      async () => {
        throw new Error("must not fetch");
      },
    );
    expect(response.status).toBe(503);
  });
  test("typed backend errors retain their status without exposing credentials", async () => {
    const response = await proxyVariableBackend(
      "variable=snap",
      config,
      async (_url, init) => {
        expect(new Headers(init.headers).get("Modal-Secret")).toBe(
          config.secret,
        );
        return Response.json(
          { detail: "Reviewed data unavailable" },
          { status: 503 },
        );
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      detail: "Reviewed data unavailable",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  test("a redirect cannot disclose proxy credentials to a different endpoint", async () => {
    let calls = 0;
    const response = await proxyVariableBackend(
      "variable=snap",
      config,
      async () => {
        calls++;
        return new Response(null, {
          status: 303,
          headers: {
            location: "https://other.modal.run/api/microcosm_variable",
          },
        });
      },
    );
    expect(response.status).toBe(502);
    expect(calls).toBe(1);
  });
  test("metadata requires the deployed source and package tuple but does not claim loaded data", async () => {
    const body = {
      runtime: {
        source_commit: config.sourceCommit,
        packages: HOSTED_US_RELEASE.packages,
      },
      data_configuration: HOSTED_US_RELEASE,
    };
    const response = await proxyVariableBackend(
      "metadata=1",
      config,
      async () => Response.json(body),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    const stale = await proxyVariableBackend("metadata=1", config, async () =>
      Response.json({
        ...body,
        runtime: { ...body.runtime, source_commit: "stale" },
      }),
    );
    expect(stale.status).toBe(409);
  });
  test("a successful calculation must carry verified immutable data provenance", async () => {
    const body = {
      runtime: {
        source_commit: config.sourceCommit,
        packages: HOSTED_US_RELEASE.packages,
      },
      data_identity: { ...HOSTED_US_RELEASE, verified: true },
      weighted_sum: 123,
    };
    const response = await proxyVariableBackend(
      "variable=snap",
      config,
      async () => Response.json(body),
    );
    expect(response.status).toBe(200);
    const unverified = await proxyVariableBackend(
      "variable=snap",
      config,
      async () =>
        Response.json({
          ...body,
          data_identity: { ...body.data_identity, verified: false },
        }),
    );
    expect(unverified.status).toBe(409);
  });
  test("Modal result redirects are followed only on the original path", async () => {
    let calls = 0;
    const response = await proxyVariableBackend(
      "variable=snap",
      config,
      async (url) => {
        calls++;
        if (calls === 1)
          return new Response(null, {
            status: 303,
            headers: { location: `${url}&__modal_result=retained` },
          });
        return Response.json({ detail: "Unavailable" }, { status: 503 });
      },
    );
    expect(response.status).toBe(503);
    expect(calls).toBe(2);
  });
});

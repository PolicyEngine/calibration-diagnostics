import { describe, expect, test } from "bun:test";
import { proxyVariableBackend } from "./variable-backend";
import { HOSTED_US_RELEASE } from "../microcosm/production-release";

const config = {
  url: "https://task--calibration.modal.run",
  key: "private-key",
  secret: "private-secret",
  sourceCommit: "reviewed-sha",
};

// The backend reports its deployment's own resolution of POPULACE_HF_REPO and
// POPULACE_HF_REVISION beside the static reviewed configuration.
const reviewedEnvironment = {
  repo: HOSTED_US_RELEASE.repo,
  revision: HOSTED_US_RELEASE.hf_revision,
  filename: HOSTED_US_RELEASE.filename,
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
      environment_configuration: reviewedEnvironment,
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
      period: "2024",
      release_id: HOSTED_US_RELEASE.release_id,
      variable: "snap",
      variables: [
        {
          variable: "snap",
          period: "2024",
          release_id: HOSTED_US_RELEASE.release_id,
          weighted_sum: 123,
        },
      ],
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
  test("successful output must match the requested selection at every result", async () => {
    const body = {
      runtime: {
        source_commit: config.sourceCommit,
        packages: HOSTED_US_RELEASE.packages,
      },
      data_identity: { ...HOSTED_US_RELEASE, verified: true },
      period: "2024",
      release_id: HOSTED_US_RELEASE.release_id,
      variables: ["snap", "ssi"].map((variable) => ({
        variable,
        period: "2024",
        release_id: HOSTED_US_RELEASE.release_id,
      })),
    };
    const query = new URLSearchParams({
      variables: "snap,ssi",
      period: "2024",
      release: HOSTED_US_RELEASE.release_id,
    }).toString();
    expect(
      (
        await proxyVariableBackend(query, config, async () =>
          Response.json(body),
        )
      ).status,
    ).toBe(200);
    const invalid = [
      { ...body, period: "2025" },
      { ...body, period: undefined },
      { ...body, release_id: "other" },
      { ...body, release_id: undefined },
      { ...body, variables: undefined },
      { ...body, variables: [] },
      { ...body, variables: [body.variables[0]] },
      { ...body, variables: [body.variables[0], body.variables[0]] },
      { ...body, variables: body.variables.toReversed() },
      ...["variable", "period", "release_id"].flatMap((field) =>
        [undefined, "wrong"].map((value) => ({
          ...body,
          variables: [
            body.variables[0],
            { ...body.variables[1], [field]: value },
          ],
        })),
      ),
    ];
    for (const responseBody of invalid) {
      const response = await proxyVariableBackend(query, config, async () =>
        Response.json(responseBody),
      );
      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
  test("single-result compatibility fields cannot claim a different variable", async () => {
    const body = {
      runtime: {
        source_commit: config.sourceCommit,
        packages: HOSTED_US_RELEASE.packages,
      },
      data_identity: { ...HOSTED_US_RELEASE, verified: true },
      period: "2024",
      release_id: HOSTED_US_RELEASE.release_id,
      variable: "ssi",
      variables: [
        {
          variable: "snap",
          period: "2024",
          release_id: HOSTED_US_RELEASE.release_id,
        },
      ],
    };
    expect(
      (
        await proxyVariableBackend("variable=snap", config, async () =>
          Response.json(body),
        )
      ).status,
    ).toBe(409);
  });
  test("metadata must match the backend deployment's own data selection", async () => {
    const body = {
      runtime: {
        source_commit: config.sourceCommit,
        packages: HOSTED_US_RELEASE.packages,
      },
      data_configuration: HOSTED_US_RELEASE,
      environment_configuration: reviewedEnvironment,
    };
    expect(
      (
        await proxyVariableBackend("metadata=1", config, async () =>
          Response.json(body),
        )
      ).status,
    ).toBe(200);
    // A stale override passes the static configuration check while every
    // calculation answers 503, so the metadata gate must refuse it here.
    const stale = [
      {
        ...reviewedEnvironment,
        repo: "policyengine/unreviewed-override-fixture",
      },
      { ...reviewedEnvironment, revision: "main" },
      { ...reviewedEnvironment, filename: "other.h5" },
      undefined,
    ];
    for (const environment_configuration of stale) {
      const response = await proxyVariableBackend(
        "metadata=1",
        config,
        async () => Response.json({ ...body, environment_configuration }),
      );
      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });
  test("a backend that only redirects is reported as exceeding the redirect limit", async () => {
    let calls = 0;
    const response = await proxyVariableBackend(
      "variable=snap",
      config,
      async (url) => {
        calls++;
        return new Response(null, {
          status: 303,
          headers: { location: String(url) },
        });
      },
    );
    expect(calls).toBe(7);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "The calculation backend exceeded its result redirect limit.",
    });
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

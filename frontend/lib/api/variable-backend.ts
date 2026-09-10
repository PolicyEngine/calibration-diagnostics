import { HOSTED_US_RELEASE } from "../microcosm/production-release";

type BackendConfig = {
  url?: string;
  key?: string;
  secret?: string;
  sourceCommit?: string;
};
type FetchBackend = (url: URL, init: RequestInit) => Promise<Response>;

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function matchesRelease(value: unknown): boolean {
  const identity = record(value);
  for (const field of [
    "repo",
    "hf_revision",
    "release_id",
    "filename",
    "sha256",
    "data_year",
  ] as const) {
    if (identity[field] !== HOSTED_US_RELEASE[field]) return false;
  }
  for (const field of ["build_manifest", "release_manifest"] as const) {
    const manifest = record(identity[field]);
    if (
      manifest.path !== HOSTED_US_RELEASE[field].path ||
      manifest.json_sha256 !== HOSTED_US_RELEASE[field].json_sha256
    )
      return false;
  }
  return Object.entries(HOSTED_US_RELEASE.packages).every(
    ([name, version]) => record(identity.packages)[name] === version,
  );
}

function matchesSelection(
  body: Record<string, unknown>,
  query: string,
): boolean {
  const params = new URLSearchParams(query);
  const names = [
    ...new Set(
      [...params.getAll("variables"), ...params.getAll("variable")]
        .flatMap((value) => value.split(/[,\s]+/))
        .filter(Boolean),
    ),
  ];
  const period = params.get("period") ?? String(HOSTED_US_RELEASE.data_year);
  const release = params.get("release") ?? HOSTED_US_RELEASE.release_id;
  if (
    !names.length ||
    body.period !== period ||
    body.release_id !== release ||
    !Array.isArray(body.variables) ||
    body.variables.length !== names.length
  )
    return false;
  if (names.length === 1 && body.variable !== names[0]) return false;
  return body.variables.every((value, index) => {
    const result = record(value);
    return (
      result.variable === names[index] &&
      result.period === period &&
      result.release_id === release
    );
  });
}

export async function proxyVariableBackend(
  query: string,
  config: BackendConfig,
  fetchBackend: FetchBackend = fetch,
): Promise<Response> {
  if (!config.url || !config.key || !config.secret || !config.sourceCommit) {
    return json(
      { detail: "The reviewed calculation backend is not configured." },
      503,
    );
  }
  let base: URL;
  try {
    base = new URL(config.url);
  } catch {
    return json({ detail: "Invalid calculation backend configuration." }, 503);
  }
  if (
    base.protocol !== "https:" ||
    !base.hostname.endsWith(".modal.run") ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !["", "/"].includes(base.pathname)
  ) {
    return json({ detail: "Invalid calculation backend configuration." }, 503);
  }
  let endpoint = new URL("/api/microcosm_variable", base);
  endpoint.search = query;
  const originalPath = endpoint.pathname;
  const signal = AbortSignal.timeout(780_000);
  try {
    for (let redirects = 0; redirects <= 6; redirects++) {
      const response = await fetchBackend(endpoint, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal,
        headers: {
          "Modal-Key": config.key,
          "Modal-Secret": config.secret,
          "Cache-Control": "no-cache",
        },
      });
      // Modal's documented 150-second redirect resumes the existing invocation.
      // Never send its credentials to another origin or another function path.
      if (response.status === 303 && redirects < 6) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Missing result URL");
        const next = new URL(location, endpoint);
        if (
          next.origin !== base.origin ||
          next.pathname !== originalPath ||
          next.username ||
          next.password
        )
          throw new Error("Unexpected result URL");
        endpoint = next;
        continue;
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        return json(
          { detail: "The calculation backend did not return JSON." },
          502,
        );
      }
      const body = record(await response.json());
      if (!response.ok) {
        return json(
          {
            detail:
              typeof body.detail === "string"
                ? body.detail.slice(0, 600)
                : "Variable calculation failed.",
          },
          response.status >= 400 && response.status <= 599
            ? response.status
            : 502,
        );
      }
      const runtime = record(body.runtime);
      const packages = record(runtime.packages);
      const metadataOnly = new URLSearchParams(query).get("metadata") === "1";
      const identity = record(
        metadataOnly ? body.data_configuration : body.data_identity,
      );
      if (
        runtime.source_commit !== config.sourceCommit ||
        !Object.entries(HOSTED_US_RELEASE.packages).every(
          ([name, version]) => packages[name] === version,
        ) ||
        !matchesRelease(identity) ||
        (!metadataOnly &&
          (identity.verified !== true || !matchesSelection(body, query)))
      ) {
        return json(
          {
            detail:
              "The calculation backend does not match this application's reviewed source, model, data release and requested selection.",
          },
          409,
        );
      }
      return json(body, 200);
    }
    return json(
      { detail: "The calculation backend exceeded its result redirect limit." },
      502,
    );
  } catch {
    return json(
      {
        detail: signal.aborted
          ? "Variable calculation timed out."
          : "The calculation backend request failed.",
      },
      signal.aborted ? 504 : 502,
    );
  }
}

const EXPLICIT_API_BASE = process.env.NEXT_PUBLIC_API_URL?.trim();
const LOCAL_API_BASE = "http://localhost:8000";
const API_BASE = EXPLICIT_API_BASE || LOCAL_API_BASE;

// Module-scoped current run, updated by RunProvider. Lets every request
// automatically carry ?dataset & ?run without each hook re-threading them.
let _currentRun: { dataset?: string; run?: string } = {};

export function setCurrentRun(run: { dataset?: string; run?: string }) {
  _currentRun = run;
}

type ParamValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | (string | number)[];

function mergeRunParams(
  params?: Record<string, ParamValue>,
): Record<string, ParamValue> {
  return {
    dataset: _currentRun.dataset,
    run: _currentRun.run,
    ...(params ?? {}),
  };
}

// Endpoints that don't depend on a loaded run — safe to call before the
// run picker has settled.
const RUN_AGNOSTIC_PATHS = [
  "/datasets",
  "/runs",
  "/health",
  "/pipeline",         // covers /pipeline and /pipeline/stages/*
  "/target-inventory", // committed JSON, run-independent
  "/microplex",        // pulls parity JSONs from PolicyEngine/microplex-us
  "/analysis/case-studies",
];

function pathRequiresRun(path: string): boolean {
  return !RUN_AGNOSTIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

class SelectionNotReadyError extends Error {
  constructor() {
    super("Run not yet selected; skipping request.");
    this.name = "SelectionNotReadyError";
  }
}

function appendParams(url: URL, params: Record<string, ParamValue>): void {
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((item) => {
        if (item !== undefined && item !== null) {
          url.searchParams.append(k, String(item));
        }
      });
    } else {
      url.searchParams.set(k, String(v));
    }
  });
}

function apiUrl(path: string): URL {
  if (!EXPLICIT_API_BASE && isPublicBrowserRuntime() && path.startsWith("/microplex")) {
    return new URL(`/api${path}`, window.location.origin);
  }
  return new URL(path, API_BASE);
}

function isPublicBrowserRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function shouldUseDeployedFixture(path: string): boolean {
  return (
    !EXPLICIT_API_BASE &&
    isPublicBrowserRuntime() &&
    (path === "/datasets" || path === "/runs")
  );
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, ParamValue>,
): Promise<T> {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "true") {
    const { getFixture } = await import("@/fixtures");
    return getFixture<T>(path, params as never);
  }

  if (shouldUseDeployedFixture(path)) {
    const { getFixture } = await import("@/fixtures");
    return getFixture<T>(path, params as never);
  }

  // If the path needs a loaded run but the picker hasn't settled yet,
  // throw instead of firing a doomed request. React Query will surface
  // this as a transient error and retry once the run resolves.
  if (pathRequiresRun(path) && !(_currentRun.dataset && _currentRun.run)) {
    throw new SelectionNotReadyError();
  }

  const url = apiUrl(path);
  appendParams(url, mergeRunParams(params));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function apiPost<T>(
  path: string,
  body: unknown,
): Promise<T> {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "true") {
    const { getFixture } = await import("@/fixtures");
    return getFixture<T>(path);
  }

  const url = apiUrl(path);
  appendParams(url, mergeRunParams());
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

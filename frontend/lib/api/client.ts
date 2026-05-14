const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export async function apiGet<T>(
  path: string,
  params?: Record<string, ParamValue>,
): Promise<T> {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "true") {
    const { getFixture } = await import("@/fixtures");
    return getFixture<T>(path, params as never);
  }

  const url = new URL(path, API_BASE);
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

  const url = new URL(path, API_BASE);
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

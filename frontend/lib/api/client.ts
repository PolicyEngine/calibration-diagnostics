const EXPLICIT_API_BASE = process.env.NEXT_PUBLIC_API_URL?.trim();
const LOCAL_API_BASE = "http://localhost:8000";

type ParamValue = string | number | boolean | undefined | null | (string | number)[];

function isPublicBrowserRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

// The populace data is served by the Next.js API routes (which read from
// Hugging Face). On a deployed host the browser hits those directly; for local
// dev it falls through to a FastAPI backend mirror on :8000. Set
// NEXT_PUBLIC_API_URL to point at an explicit API base.
function apiUrl(path: string): URL {
  if (EXPLICIT_API_BASE) return new URL(path, EXPLICIT_API_BASE);
  if (isPublicBrowserRuntime()) return new URL(`/api${path}`, window.location.origin);
  return new URL(path, LOCAL_API_BASE);
}

function appendParams(url: URL, params: Record<string, ParamValue>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, ParamValue>,
): Promise<T> {
  const url = apiUrl(path);
  if (params) appendParams(url, params);
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

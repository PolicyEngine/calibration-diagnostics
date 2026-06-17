const EXPLICIT_API_BASE = process.env.NEXT_PUBLIC_API_URL?.trim();

type ParamValue = string | number | boolean | undefined | null | (string | number)[];

// The populace data is served by the Next.js API routes, which read live from
// Hugging Face and run on the same origin in dev and prod.
function apiUrl(path: string): URL {
  if (EXPLICIT_API_BASE) return new URL(path, EXPLICIT_API_BASE);
  const origin =
    typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  return new URL(`/api${path}`, origin);
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

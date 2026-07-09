// Single source of truth for the dashboard's mount path.
//
// The dashboard is mounted under populace.dev at `/calibration/dashboard` via a
// Vercel multi-zone rewrite (see the PolicyEngine/populace.dev repo). The Next
// app therefore runs with `basePath = /calibration/dashboard`, and every
// hand-built absolute URL — API calls, static-asset fetches, raw <a> hrefs, and
// props passed to non-Next link components — must include the basePath.
//
// `next/link`, `useRouter().push`, and `redirect()` add the basePath
// automatically; do NOT wrap those with `withBasePath`.
//
// Override with NEXT_PUBLIC_BASE_PATH. Set it to "" for a root/bare deploy
// (kept in sync with next.config.ts, which reads the same variable).
export const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH !== undefined
    ? process.env.NEXT_PUBLIC_BASE_PATH
    : "/calibration/dashboard";

/**
 * Prefix a root-relative path (beginning with "/") with the app basePath.
 * Returns the path unchanged when no basePath is configured.
 */
export function withBasePath(path: string): string {
  if (!BASE_PATH) return path;
  return path.startsWith("/") ? `${BASE_PATH}${path}` : `${BASE_PATH}/${path}`;
}

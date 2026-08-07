import type { NextConfig } from "next";

// Mount path for the microcosm.institute multi-zone rewrite. Kept in sync with
// lib/base-path.ts (same env var, same default). Set NEXT_PUBLIC_BASE_PATH=""
// for a root/bare deploy.
const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH !== undefined
    ? process.env.NEXT_PUBLIC_BASE_PATH
    : "/calibration/dashboard";

const nextConfig: NextConfig = {
  output: "standalone",
  ...(BASE_PATH ? { basePath: BASE_PATH } : {}),
  outputFileTracingIncludes: {
    "/api/microcosm/variable": ["./scripts/microcosm_variable_value.py"],
  },
  // NOTE: the hosted Microcosm variable lookup is a native (non-Next) Vercel
  // Python function pinned to the deployment root (`/api/microcosm_variable`),
  // immune to Next's basePath. Under the mount the client calls it at
  // `${BASE_PATH}/api/microcosm_variable`; that path is mapped back to the root
  // function by an edge rewrite in vercel.json (Next forbids a config rewrite
  // from a basePath'd source to an internal, non-basePath destination).
  async redirects() {
    if (!BASE_PATH) return [];
    // Backward-compat, two eras deep: the pre-mount URLs served at the app's
    // own domain root (`basePath: false` matches un-prefixed paths), and the
    // pre-rename `/populace` slug both bare and under the mount.
    return [
      {
        source: "/populace",
        destination: `${BASE_PATH}/microcosm`,
        basePath: false,
        permanent: false,
      },
      {
        source: "/populace/:path*",
        destination: `${BASE_PATH}/microcosm/:path*`,
        basePath: false,
        permanent: false,
      },
      {
        source: "/populace",
        destination: `${BASE_PATH}/microcosm`,
        permanent: false,
      },
      {
        source: "/populace/:path*",
        destination: `${BASE_PATH}/microcosm/:path*`,
        permanent: false,
      },
      {
        source: "/microcosm",
        destination: `${BASE_PATH}/microcosm`,
        basePath: false,
        permanent: false,
      },
      {
        source: "/microcosm/:path*",
        destination: `${BASE_PATH}/microcosm/:path*`,
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

/**
 * What the release history page's routes share (calibration-diagnostics#224): the store they
 * read by default, the `panel` parameter, their cache headers, and a response that compresses
 * itself. A timeline grows with every build, and a function's response has a size limit, so the
 * routes send gzip to a client that accepts it.
 */
import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";

import { acceptsGzip } from "./calibration-tree-http";
import { PANEL_ID_PATTERN, type PanelViewResult } from "./release-history-read";
import { releaseHistoryReadStore } from "./release-history-source";
import type { ReleaseHistoryStore } from "./release-history-store";

export interface ReleaseHistoryRouteDependencies {
  /** The store a request reads: private Blob, or the local folder the environment names. */
  store(): ReleaseHistoryStore;
}

export const DEFAULT_RELEASE_HISTORY_ROUTE_DEPENDENCIES: ReleaseHistoryRouteDependencies = {
  store: () => releaseHistoryReadStore(),
};

// The manifest and every timeline change at each run, so the CDN keeps a response for a minute.
export const RELEASE_HISTORY_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, max-age=60, stale-if-error=86400",
};

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/** The panel a request names, null when it names none, or the 400 for a malformed id. */
export function requestedPanel(searchParams: URLSearchParams): string | null | NextResponse {
  const panel = searchParams.get("panel")?.trim();
  if (!panel) return null;
  if (PANEL_ID_PATTERN.test(panel)) return panel;
  return NextResponse.json(
    { detail: "A panel id is 64 hexadecimal characters." },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

/** The response for a panel that could not be served. */
export function panelProblemResponse(
  result: Exclude<PanelViewResult, { kind: "ok" }>,
  country: string,
): NextResponse {
  if (result.kind === "mismatch") {
    console.error(`Release history timeline refused for ${country}: ${result.detail}`);
    return NextResponse.json(
      { detail: "The stored timeline could not be read." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
  const detail = {
    no_history: `No release history is stored for ${country} yet.`,
    unknown_panel: `No such release history panel for ${country}.`,
    no_timeline: "This panel has no timeline yet.",
  }[result.kind];
  return NextResponse.json({ detail }, { status: 404, headers: NO_STORE_HEADERS });
}

/** A read of the store that failed: logged with its cause, answered without it. */
export function readFailureResponse(error: unknown): NextResponse {
  console.error("Release history read failed:", error);
  return NextResponse.json(
    { detail: "The release history could not be read." },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}

/** A text response, compressed with gzip for a client that accepts it. */
export function compressedResponse(
  request: Request,
  body: string,
  headers: Record<string, string>,
): NextResponse {
  const responseHeaders = { ...headers, Vary: "Accept-Encoding" };
  if (!acceptsGzip(request)) return new NextResponse(body, { status: 200, headers: responseHeaders });
  return new NextResponse(new Uint8Array(gzipSync(body)), {
    status: 200,
    headers: { ...responseHeaders, "Content-Encoding": "gzip" },
  });
}

import { requiredCountry } from "@/lib/api/request-country";
import {
  compressedResponse,
  DEFAULT_RELEASE_HISTORY_ROUTE_DEPENDENCIES,
  panelProblemResponse,
  readFailureResponse,
  RELEASE_HISTORY_CACHE_HEADERS,
  requestedPanel,
  type ReleaseHistoryRouteDependencies,
} from "@/lib/microcosm/release-history-http";
import { readPanelView } from "@/lib/microcosm/release-history-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One panel as the page loads it: the panel's summary, how to present its outputs, and its whole
// `timeline.json`, read from private Blob. `?panel=` names the panel of one reference engine;
// without it the route serves the panel the page opens.
export function createReleaseHistoryTimelineHandler(
  dependencies: ReleaseHistoryRouteDependencies = DEFAULT_RELEASE_HISTORY_ROUTE_DEPENDENCIES,
) {
  return async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const country = requiredCountry(params);
    if (country instanceof Response) return country;
    const panel = requestedPanel(params);
    if (panel instanceof Response) return panel;
    try {
      const result = await readPanelView(dependencies.store(), country, panel);
      if (result.kind !== "ok") return panelProblemResponse(result, country);
      return compressedResponse(request, JSON.stringify(result.view), {
        ...RELEASE_HISTORY_CACHE_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (error) {
      return readFailureResponse(error);
    }
  };
}

export const GET = createReleaseHistoryTimelineHandler();

import { requiredCountry } from "@/lib/api/request-country";
import { timelineCsv, timelineCsvFileName } from "@/lib/microcosm/release-history-export";
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

// A panel's timeline as a CSV download: the table `release-history export` writes, one row per
// build and output. It holds what the page shows and nothing more: a withheld value is an empty
// cell.
export function createReleaseHistoryExportHandler(
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
      return compressedResponse(request, timelineCsv(result.view.timeline), {
        ...RELEASE_HISTORY_CACHE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${timelineCsvFileName(country, result.view.panelId)}"`,
      });
    } catch (error) {
      return readFailureResponse(error);
    }
  };
}

export const GET = createReleaseHistoryExportHandler();

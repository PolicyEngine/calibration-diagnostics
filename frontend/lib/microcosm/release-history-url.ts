/**
 * The release history page's state in its URL (calibration-diagnostics#224), so a link opens the
 * same engine, output, scale and step. A default is never written, and a value the page cannot
 * use (a panel of another country, an output this panel does not hold) is ignored by the page,
 * not refused here.
 */

export type ChartScale = "relative" | "absolute";
export type MovedScope = "headline" | "all";

export interface ReleaseHistoryUrlState {
  /** The panel of the chosen reference engine; null for the panel the page opens. */
  panel: string | null;
  /** The selected output's id; null for the first output. */
  output: string | null;
  /** The measured period; null for the first one. */
  period: number | null;
  scale: ChartScale;
  /** The build whose step card is open, as `<release>/<build>`. */
  step: string | null;
  moved: MovedScope;
}

const PARAMS = ["panel", "output", "period", "scale", "step", "moved"] as const;

function value(search: URLSearchParams, name: string): string | null {
  const found = search.get(name)?.trim();
  return found ? found : null;
}

export function releaseHistoryUrlState(search: URLSearchParams): ReleaseHistoryUrlState {
  const period = Number(value(search, "period"));
  return {
    panel: value(search, "panel"),
    output: value(search, "output"),
    period: Number.isInteger(period) && period > 0 ? period : null,
    scale: value(search, "scale") === "absolute" ? "absolute" : "relative",
    step: value(search, "step"),
    moved: value(search, "moved") === "all" ? "all" : "headline",
  };
}

/** `currentUrl` with part of the state changed, every other parameter kept, defaults left out. */
export function withReleaseHistoryState(
  currentUrl: string,
  patch: Partial<ReleaseHistoryUrlState>,
): string {
  const url = new URL(currentUrl);
  const next = { ...releaseHistoryUrlState(url.searchParams), ...patch };
  const written: Record<(typeof PARAMS)[number], string | null> = {
    panel: next.panel,
    output: next.output,
    period: next.period === null ? null : String(next.period),
    scale: next.scale === "absolute" ? "absolute" : null,
    step: next.step,
    moved: next.moved === "all" ? "all" : null,
  };
  for (const name of PARAMS) {
    if (written[name]) url.searchParams.set(name, written[name]);
    else url.searchParams.delete(name);
  }
  return url.toString();
}

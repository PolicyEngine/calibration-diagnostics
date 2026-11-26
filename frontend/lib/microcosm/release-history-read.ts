/**
 * Server-side reads for the release history page's routes (calibration-diagnostics#224): the
 * manifest, and one panel as the page loads it. Everything is read through a ReleaseHistoryStore,
 * so the routes' tests use the in-memory one.
 */
import {
  panelPrefix,
  parseManifest,
  readJson,
  RELEASE_HISTORY_MANIFEST_PATH,
  TIMELINE_FORMAT_VERSION,
  type PanelDocument,
  type ReleaseHistoryManifest,
  type ReleaseHistoryStore,
  type Timeline,
} from "./release-history-store";
import {
  panelPresentation,
  releaseHistorySummary,
  type ReleaseHistoryPanelView,
} from "./release-history-summary";

export const PANEL_ID_PATTERN = /^[0-9a-f]{64}$/;

/** The stored manifest, or null while the store holds none. */
export async function readReleaseHistoryManifest(
  store: ReleaseHistoryStore,
): Promise<ReleaseHistoryManifest | null> {
  const found = await readJson<unknown>(store, RELEASE_HISTORY_MANIFEST_PATH);
  return found === null ? null : parseManifest(found);
}

/**
 * `no_history`: the country has no measured file. `unknown_panel`: the manifest lists no such
 * panel with a measured file. `no_timeline`: the panel's timeline is not in the store.
 * `mismatch`: the stored timeline is not this panel's, or not a timeline this code reads.
 */
export type PanelViewResult =
  | { kind: "ok"; view: ReleaseHistoryPanelView }
  | { kind: "no_history" }
  | { kind: "unknown_panel" }
  | { kind: "no_timeline" }
  | { kind: "mismatch"; detail: string };

function timelineProblem(timeline: Timeline, country: string, panelId: string): string | null {
  if (timeline === null || typeof timeline !== "object") return "The stored timeline is not an object.";
  if (timeline.kind !== "release_history.timeline") return "The stored document is not a timeline.";
  if (timeline.formatVersion !== TIMELINE_FORMAT_VERSION) {
    return `Unsupported timeline format ${String(timeline.formatVersion)}.`;
  }
  if (timeline.country !== country || timeline.panelId !== panelId) {
    return "The stored timeline belongs to another country or panel.";
  }
  if (!Array.isArray(timeline.builds) || !Array.isArray(timeline.outputs)) {
    return "The stored timeline has no builds or no outputs.";
  }
  return null;
}

/**
 * One panel of a country: the one asked for, or the one the page opens when none is named. Only
 * a panel the country's manifest entry lists is ever read.
 */
export async function readPanelView(
  store: ReleaseHistoryStore,
  country: string,
  requestedPanelId: string | null,
): Promise<PanelViewResult> {
  const summary = releaseHistorySummary(country, await readReleaseHistoryManifest(store));
  if (!summary.available) return { kind: "no_history" };
  const panelId = requestedPanelId ?? summary.defaultPanelId;
  const panel = summary.panels.find((candidate) => candidate.panelId === panelId);
  if (!panel) return { kind: "unknown_panel" };
  const prefix = panelPrefix(country, panel.panelId);
  const [timeline, document] = await Promise.all([
    readJson<Timeline>(store, `${prefix}timeline.json`),
    readJson<PanelDocument>(store, `${prefix}panel.json`),
  ]);
  if (!timeline) return { kind: "no_timeline" };
  const problem = timelineProblem(timeline, country, panel.panelId);
  if (problem) return { kind: "mismatch", detail: problem };
  return {
    kind: "ok",
    view: {
      country,
      panelId: panel.panelId,
      panel,
      presentation: panelPresentation(document),
      timeline,
    },
  };
}

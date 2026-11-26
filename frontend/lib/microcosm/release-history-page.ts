/**
 * What the release history page shows for one URL (calibration-diagnostics#224): the engine
 * options, the notices about the chosen engine, and the output, period and step the URL selects.
 * Pure: the view renders what these return. A value of the URL the page cannot use falls back to
 * its default here, so a stale link never fails.
 */
import { dateShort, engineLabel } from "./release-history-format";
import {
  outputEntries,
  timelinePeriods,
  type OutputEntry,
} from "./release-history-outputs";
import type {
  PanelPresentation,
  ReleaseHistoryPanelSummary,
  ReleaseHistoryPanelView,
  ReleaseHistorySummary,
} from "./release-history-summary";
import type { ReleaseHistoryUrlState } from "./release-history-url";

/** The panel a URL selects: the one it names when the country has it, else the default one. */
export function selectedPanelId(summary: ReleaseHistorySummary, requested: string | null): string | null {
  return summary.panels.some((panel) => panel.panelId === requested) ? requested : summary.defaultPanelId;
}

function coverageText(panel: ReleaseHistoryPanelSummary): string {
  return `${panel.coverage.measured} of ${panel.coverage.files} files`;
}

/**
 * One option per panel of the country, the default first: the engine's model and what the panel
 * holds. Two panels on one engine are told apart by their definition.
 */
export function engineOptions(summary: ReleaseHistorySummary): { value: string; label: string }[] {
  const engines = summary.panels.map((panel) => engineLabel(panel.engine.model));
  return summary.panels.map((panel, index) => {
    const repeated = engines.filter((engine) => engine === engines[index]).length > 1;
    const parts = [engines[index], coverageText(panel)];
    if (repeated) parts.push(`definition ${(panel.specSha256 ?? "unknown").slice(0, 7)}`);
    else if (!panel.sameDefinitionAsDefault) parts.push("other definition");
    return { value: panel.panelId, label: parts.join(" · ") };
  });
}

/**
 * What the page says about the engine on screen.
 *
 * - `newer_engine_filling`: the default (served) panel is shown while a newer engine's panel,
 *   the pinned one, fills. The page moves to it once it is complete.
 * - `viewing_filling_engine`: the pinned panel is shown before it is complete.
 * - `viewing_other_engine`: another engine's panel is shown, one measured on request.
 * - `other_definition`: the panel was measured under another spec or producer version than the
 *   default one, so its outputs may differ.
 */
export type EngineNotice =
  | { kind: "newer_engine_filling"; engine: string; pinnedAt: string | null; coverage: string; panelId: string }
  | { kind: "viewing_filling_engine"; engine: string; coverage: string; defaultEngine: string; defaultPanelId: string }
  | { kind: "viewing_other_engine"; engine: string; defaultEngine: string; defaultPanelId: string }
  | { kind: "other_definition"; engine: string };

export function engineNotices(summary: ReleaseHistorySummary, panelId: string | null): EngineNotice[] {
  const shown = summary.panels.find((panel) => panel.panelId === panelId);
  const chosen = summary.panels.find((panel) => panel.panelId === summary.defaultPanelId);
  if (!shown || !chosen) return [];
  const notices: EngineNotice[] = [];
  const pinned = summary.panels.find((panel) => panel.pinned);
  if (shown.panelId === chosen.panelId) {
    if (pinned && pinned.panelId !== chosen.panelId) {
      notices.push({
        kind: "newer_engine_filling",
        engine: engineLabel(pinned.engine.model),
        pinnedAt: pinned.pinnedAt,
        coverage: coverageText(pinned),
        panelId: pinned.panelId,
      });
    }
    return notices;
  }
  const back = { defaultEngine: engineLabel(chosen.engine.model), defaultPanelId: chosen.panelId };
  if (shown.pinned) {
    notices.push({
      kind: "viewing_filling_engine",
      engine: engineLabel(shown.engine.model),
      coverage: coverageText(shown),
      ...back,
    });
  } else {
    notices.push({ kind: "viewing_other_engine", engine: engineLabel(shown.engine.model), ...back });
  }
  if (!shown.sameDefinitionAsDefault) {
    notices.push({ kind: "other_definition", engine: engineLabel(shown.engine.model) });
  }
  return notices;
}

/** What the URL selects on a loaded panel. */
export interface PageSelection {
  /** Every output of the panel, in the page's order, and those of the selected period. */
  entries: OutputEntry[];
  periods: number[];
  period: number;
  periodEntries: OutputEntry[];
  /** The selected output; null only for a timeline with no output. */
  entry: OutputEntry | null;
  /** The build whose step card is open, by its place in the timeline's builds. */
  stepIndex: number | null;
}

export function pageSelection(
  view: ReleaseHistoryPanelView,
  state: Pick<ReleaseHistoryUrlState, "output" | "period" | "step">,
): PageSelection {
  const entries = outputEntries(view.timeline, view.presentation);
  const periods = timelinePeriods(entries);
  const period = state.period !== null && periods.includes(state.period) ? state.period : periods[0] ?? 0;
  const periodEntries = entries.filter((entry) => entry.period === period);
  const entry = periodEntries.find((candidate) => candidate.id === state.output) ?? periodEntries[0] ?? null;
  const stepIndex = view.timeline.builds.findIndex((build) => build.buildId === state.step);
  return { entries, periods, period, periodEntries, entry, stepIndex: stepIndex === -1 ? null : stepIndex };
}

/**
 * The parts of the URL's state the loaded panel cannot use, set back to their defaults: an
 * output or a period it does not hold, a step at a build it does not list. Empty when the URL
 * says only what the page shows, so a link copied from it opens the same view.
 */
export function staleState(
  selection: PageSelection,
  state: Pick<ReleaseHistoryUrlState, "output" | "period" | "step">,
): Partial<ReleaseHistoryUrlState> {
  const stale: Partial<ReleaseHistoryUrlState> = {};
  if (state.output !== null && selection.entry?.id !== state.output) stale.output = null;
  if (state.period !== null && selection.period !== state.period) stale.period = null;
  if (state.step !== null && selection.stepIndex === null) stale.step = null;
  return stale;
}

/** One line on the country's disclosure policy, from the panel's spec. */
export function disclosureLine(disclosure: PanelPresentation["disclosure"]): string {
  if (disclosure.policy === "source_household_small_cells") {
    const floor = disclosure.minSourceHouseholds ?? 3;
    return `A value that rests on fewer than ${floor} survey households is withheld, with any partner cell that would give it back.`;
  }
  if (disclosure.policy === "none") return "No value is withheld: this country's policy checks none.";
  return disclosure.policy ? `Disclosure policy: ${disclosure.policy.replace(/_/g, " ")}.` : "Disclosure policy not recorded.";
}

/** "19 Oct (name)" for each build, for a sentence that names builds. */
export function namedBuilds(
  builds: ReadonlyArray<{ buildId: string; publishedAt: string }>,
  shortNames: ReadonlyMap<string, string>,
): string {
  return builds
    .map((build) => `${dateShort(build.publishedAt)} (${shortNames.get(build.buildId) ?? build.buildId})`)
    .join(", ");
}

/**
 * What the release history page's routes return (calibration-diagnostics#224): a country's
 * panels from the manifest, the panel the page opens, and what a panel's `panel.json` says about
 * how to present its outputs. Pure, with type-only imports, so the page imports it too.
 */
import type {
  ManifestCountry,
  ManifestPanel,
  PanelCoverage,
  PanelDocument,
  ReleaseHistoryManifest,
  Timeline,
} from "./release-history-store";

/** A panel's reference engine, as the manifest names it (`<package>==<version>`). */
export interface ReleaseHistoryEngine {
  policyengine: string | null;
  model: string | null;
  core: string | null;
}

/**
 * One panel of a country. `pinned`: the panel of the engine the default branch pins. `served`:
 * the manifest's current panel, the last pinned one that was complete. The per-file entries stay
 * in the manifest: the panel's timeline says which builds it has no run for.
 */
export interface ReleaseHistoryPanelSummary {
  panelId: string;
  engine: ReleaseHistoryEngine;
  specSha256: string | null;
  producerVersion: string | null;
  createdAt: string | null;
  pinnedAt: string | null;
  pinned: boolean;
  served: boolean;
  complete: boolean;
  coverage: PanelCoverage;
  /** Whether its spec and producer version equal the default panel's, so its outputs are the same. */
  sameDefinitionAsDefault: boolean;
}

export interface ReleaseHistorySummary {
  country: string;
  /** False while the store holds no measured file for the country. */
  available: boolean;
  updatedAt: string | null;
  /** The panel the page opens when the URL names none. */
  defaultPanelId: string | null;
  pinnedPanelId: string | null;
  servedPanelId: string | null;
  /** Every panel that holds a measured file, the default one first. */
  panels: ReleaseHistoryPanelSummary[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function holdsMeasuredFile(panel: ManifestPanel): boolean {
  return Object.values(panel.points ?? {}).some((point) => point.state === "measured");
}

/** Newest first, by when a panel was last pinned, or created when it never was. */
function byRecency(left: ManifestPanel, right: ManifestPanel): number {
  const leftAt = left.pinnedAt ?? left.createdAt ?? "";
  const rightAt = right.pinnedAt ?? right.createdAt ?? "";
  if (leftAt !== rightAt) return leftAt < rightAt ? 1 : -1;
  return left.panelId < right.panelId ? -1 : left.panelId > right.panelId ? 1 : 0;
}

/**
 * The panel the page opens: the served panel, which is the last complete one. After an engine
 * bump the pinned panel fills first and the page moves to it only once it is complete (María,
 * 26 November 2026). Before any panel is complete it is the pinned one, and failing that the
 * newest panel that holds a measured file.
 */
export function defaultPanelId(entry: ManifestCountry | undefined): string | null {
  if (!entry) return null;
  const listed = Object.values(entry.panels ?? {}).filter(holdsMeasuredFile);
  const has = (panelId: string | null) => listed.some((panel) => panel.panelId === panelId);
  if (has(entry.currentPanelId)) return entry.currentPanelId;
  if (has(entry.pinnedPanelId)) return entry.pinnedPanelId;
  return [...listed].sort(byRecency)[0]?.panelId ?? null;
}

function panelSummary(
  panel: ManifestPanel,
  entry: ManifestCountry,
  chosen: ManifestPanel | undefined,
): ReleaseHistoryPanelSummary {
  return {
    panelId: panel.panelId,
    engine: {
      policyengine: text(panel.engine?.policyengine),
      model: text(panel.engine?.model),
      core: text(panel.engine?.core),
    },
    specSha256: panel.specSha256,
    producerVersion: panel.producerVersion,
    createdAt: panel.createdAt,
    pinnedAt: panel.pinnedAt,
    pinned: entry.pinnedPanelId === panel.panelId,
    served: entry.currentPanelId === panel.panelId,
    complete: panel.complete,
    coverage: panel.coverage,
    sameDefinitionAsDefault:
      panel.specSha256 === (chosen?.specSha256 ?? null) &&
      panel.producerVersion === (chosen?.producerVersion ?? null),
  };
}

/** A country's panels and the one the page opens, from the manifest. */
export function releaseHistorySummary(
  country: string,
  manifest: ReleaseHistoryManifest | null,
): ReleaseHistorySummary {
  const entry =
    manifest && Object.hasOwn(manifest.countries, country) ? manifest.countries[country] : undefined;
  const chosenId = defaultPanelId(entry);
  if (!entry || chosenId === null) {
    return {
      country,
      available: false,
      updatedAt: manifest?.updatedAt ?? null,
      defaultPanelId: null,
      pinnedPanelId: entry?.pinnedPanelId ?? null,
      servedPanelId: entry?.currentPanelId ?? null,
      panels: [],
    };
  }
  const chosen = entry.panels[chosenId];
  const others = Object.values(entry.panels)
    .filter((panel) => panel.panelId !== chosenId && holdsMeasuredFile(panel))
    .sort(byRecency);
  return {
    country,
    available: true,
    updatedAt: manifest?.updatedAt ?? null,
    defaultPanelId: chosenId,
    pinnedPanelId: entry.pinnedPanelId,
    servedPanelId: entry.currentPanelId,
    panels: [chosen, ...others].map((panel) => panelSummary(panel, entry, chosen)),
  };
}

// ---------------------------------------------------------------------------
// Presentation: what `panel.json` says about a panel's outputs

/** A baseline item of the panel's spec: `kind` groups it, `byDecile` says it has decile rows. */
export interface PresentationBaselineItem {
  id: string;
  kind: string | null;
  stat: string | null;
  byDecile: boolean;
}

/**
 * What the page needs from a panel's hashed spec to label, group and order its outputs. The
 * timeline holds none of it. Reform labels are not here: they come with the timeline.
 */
export interface PanelPresentation {
  currency: string | null;
  /** How a period is named: 2026 is "2026-27" for a fiscal year. */
  periodLabel: "fiscal_year" | "calendar_year";
  periods: number[];
  baseline: PresentationBaselineItem[];
  /** Reform ids, in the spec's order. */
  reforms: string[];
  povertyMeasures: string[];
  groups: string[];
  disclosure: { policy: string | null; minSourceHouseholds: number | null };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The presentation of a panel; an absent or unreadable `panel.json` gives empty lists. */
export function panelPresentation(panel: PanelDocument | null): PanelPresentation {
  const definition = record(panel?.definition);
  const variables = record(definition.variables);
  const disclosure = record(definition.disclosure);
  const baseline = list(definition.baseline).flatMap((item): PresentationBaselineItem[] => {
    const entry = record(item);
    const id = text(entry.id);
    return id
      ? [{ id, kind: text(entry.kind), stat: text(entry.stat), byDecile: text(entry.by) !== null }]
      : [];
  });
  return {
    currency: text(definition.currency),
    periodLabel: definition.period_label === "fiscal_year" ? "fiscal_year" : "calendar_year",
    periods: list(definition.periods).filter((period): period is number => Number.isInteger(period)),
    baseline,
    reforms: list(definition.reforms).flatMap((reform) => {
      const id = text(record(reform).id);
      return id ? [id] : [];
    }),
    povertyMeasures: Object.keys(record(variables.poverty)),
    groups: Object.keys(record(variables.groups)),
    disclosure: {
      policy: text(disclosure.policy),
      minSourceHouseholds:
        typeof disclosure.min_source_households === "number" ? disclosure.min_source_households : null,
    },
  };
}

/** One panel as the page loads it: its summary, its presentation and its whole timeline. */
export interface ReleaseHistoryPanelView {
  country: string;
  panelId: string;
  panel: ReleaseHistoryPanelSummary;
  presentation: PanelPresentation;
  timeline: Timeline;
}

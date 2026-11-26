// Test support: one synthetic panel as the page loads it, read through the routes' own reader.
import { readPanelView } from "../release-history-read";
import type { ReleaseHistoryPanelView } from "../release-history-summary";
import { sharedSyntheticReleaseHistory } from "./release-history-synthetic-store";

/**
 * A panel of the synthetic store. `uk`: `earlier` is the served panel, `newer` the pinned one
 * that is still filling. `us`: `earlier` is complete, `other` holds two builds on another engine.
 */
export async function syntheticPanelView(
  country: "uk" | "us",
  engine: "earlier" | "newer" | "other" = "earlier",
): Promise<ReleaseHistoryPanelView> {
  const { store, countries } = await sharedSyntheticReleaseHistory();
  const result = await readPanelView(store, country, countries[country].panels[engine]);
  if (result.kind !== "ok") throw new Error(`No synthetic ${country} panel for the ${engine} engine: ${result.kind}.`);
  return result.view;
}

import type { BuildTimeline } from "@/lib/microcosm/build-monitor";

// How the build monitor's run selector orders runs. The choice is kept in the
// page's `order` query parameter.

export type RunOrder = "pipeline" | "date";

export const RUN_ORDER_PARAM = "order";

export function parseRunOrder(_value: string | null | undefined): RunOrder {
  return "pipeline";
}

export function withRunOrder(currentUrl: string, _order: RunOrder): string {
  return currentUrl;
}

export interface OrderedRunOption {
  run: Pick<BuildTimeline, "run_id" | "started_ms" | "pipeline_label">;
  group: string | undefined;
}

// The selector's runs, as today: in the list's order, each under its group.
export function orderRunOptions<T extends OrderedRunOption["run"]>(
  runs: readonly T[],
  _order: RunOrder,
  groupOf: (run: T) => string | undefined,
): { run: T; group: string | undefined }[] {
  return runs.map((run) => ({ run, group: groupOf(run) }));
}

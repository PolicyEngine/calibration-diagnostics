import type { BuildTimeline } from "@/lib/microcosm/build-monitor";

// How the build monitor's run selector orders runs: under each run's pipeline
// group, as the list arrives, or in one list by start, newest first. The
// choice is kept in the page's `order` query parameter so a link keeps it.

export type RunOrder = "pipeline" | "date";

export const RUN_ORDER_PARAM = "order";

// The order a URL's `order` parameter names: by date only when it says so.
export function parseRunOrder(value: string | null | undefined): RunOrder {
  return value === "date" ? "date" : "pipeline";
}

// `currentUrl` with `order` kept in it, every other parameter unchanged. By
// pipeline is the default, so it needs no parameter.
export function withRunOrder(currentUrl: string, order: RunOrder): string {
  const url = new URL(currentUrl);
  if (order === "date") url.searchParams.set(RUN_ORDER_PARAM, order);
  else url.searchParams.delete(RUN_ORDER_PARAM);
  return url.toString();
}

export interface OrderedRunOption {
  run: Pick<BuildTimeline, "run_id" | "started_ms" | "pipeline_label">;
  group: string | undefined;
}

// The selector's runs in `order`. By pipeline they keep the list's order under
// each run's group; by date they form one list, newest start first, with runs
// whose start is unknown last, in the list's order.
export function orderRunOptions<T extends OrderedRunOption["run"]>(
  runs: readonly T[],
  order: RunOrder,
  groupOf: (run: T) => string | undefined,
): { run: T; group: string | undefined }[] {
  if (order === "pipeline") return runs.map((run) => ({ run, group: groupOf(run) }));
  return runs
    .map((run, index) => ({ run, index }))
    .sort(
      (first, second) =>
        (second.run.started_ms ?? -Infinity) - (first.run.started_ms ?? -Infinity) ||
        first.index - second.index,
    )
    .map(({ run }) => ({ run, group: undefined }));
}

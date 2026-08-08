import {
  nextLevelExplorerStates,
  type ExplorerState,
} from "./calibration-explorer";
import type { CalibrationTreeResponse } from "./calibration-tree";

export type CalibrationTreeFetcher = (
  state: ExplorerState,
) => Promise<CalibrationTreeResponse | null>;

interface PrefetchCalibrationDescendantsOptions {
  state: ExplorerState;
  data: CalibrationTreeResponse;
  depth: number;
  concurrency?: number;
  fetchTree: CalibrationTreeFetcher;
  isCancelled?: () => boolean;
}

export interface CalibrationPrefetchResult {
  requested: number;
  loaded: number;
  levelsCompleted: number;
}

interface TreeLevelEntry {
  state: ExplorerState;
  data: CalibrationTreeResponse;
}

function stateKey(state: ExplorerState): string {
  return JSON.stringify(state);
}

function nextStates(entries: TreeLevelEntry[]): ExplorerState[] {
  const unique = new Map<string, ExplorerState>();
  for (const entry of entries) {
    const states = nextLevelExplorerStates(
      entry.state,
      entry.data.groups.flatMap((group) =>
        group.nodes.map((item) => item.selection),
      ),
    );
    for (const state of states) unique.set(stateKey(state), state);
  }
  return [...unique.values()];
}

async function concurrentMap<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  const workerCount = Math.min(Math.max(Math.floor(concurrency), 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

/**
 * Breadth-first prefetching gives the immediately clickable level priority,
 * then uses each response to discover the following level. Target selections
 * are terminal and are excluded by nextLevelExplorerStates.
 */
export async function prefetchCalibrationDescendants({
  state,
  data,
  depth,
  concurrency = 6,
  fetchTree,
  isCancelled = () => false,
}: PrefetchCalibrationDescendantsOptions): Promise<CalibrationPrefetchResult> {
  const result: CalibrationPrefetchResult = {
    requested: 0,
    loaded: 0,
    levelsCompleted: 0,
  };
  let frontier: TreeLevelEntry[] = [{ state, data }];

  for (let level = 0; level < Math.max(Math.floor(depth), 0); level += 1) {
    if (isCancelled()) break;
    const states = nextStates(frontier);
    if (!states.length) break;
    result.requested += states.length;

    const responses = await concurrentMap(states, concurrency, async (childState) => {
      if (isCancelled()) return null;
      try {
        const childData = await fetchTree(childState);
        return childData && !isCancelled()
          ? { state: childState, data: childData }
          : null;
      } catch {
        return null;
      }
    });
    frontier = responses.filter((entry): entry is TreeLevelEntry => entry != null);
    result.loaded += frontier.length;
    result.levelsCompleted += 1;
    if (!frontier.length) break;
  }

  return result;
}

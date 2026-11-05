import type { ReleasesRecord } from "@policyengine/calibration-tree/release-record";

// What changed in a dataset repository's releases.json between two commits,
// as the Slack release alerts announce it (microcosm-emitter#24). Only the
// release writer changes the record: it lists a newly published build
// (optionally making it current), makes a listed build current, or marks one
// withdrawn.

export type ReleaseRecordAlert =
  | {
      kind: "published";
      release: string;
      build: string;
      publishedAt: string;
      /** The build became its release's current build in this update. */
      becameCurrent: boolean;
      /** The release's current build after the update. */
      currentBuild: string | null;
    }
  | { kind: "current_changed"; release: string; from: string | null; to: string | null }
  | { kind: "withdrawn"; release: string; build: string }
  | {
      kind: "record_created";
      buildCount: number;
      releases: Array<{ release: string; currentBuild: string | null }>;
    };

const byName = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The alerts for one update of a release repository's main.
 *
 * - No record after the update: none.
 * - No record before it: the update created releases.json, which lists every
 *   build already published, so one summary instead of one alert per build.
 * - Otherwise, in this order: each newly listed build, saying whether it
 *   became current; each other change of a release's current build; each
 *   build newly marked withdrawn. Releases and builds are in name order.
 */
export function releaseRecordAlerts(
  before: ReleasesRecord | null,
  after: ReleasesRecord | null,
): ReleaseRecordAlert[] {
  if (!after) return [];
  const releaseNames = Object.keys(after.releases).sort(byName);
  if (!before) {
    return [{
      kind: "record_created",
      buildCount: releaseNames.reduce(
        (count, release) => count + Object.keys(after.releases[release].builds).length,
        0,
      ),
      releases: releaseNames.map((release) => ({
        release,
        currentBuild: after.releases[release].current,
      })),
    }];
  }

  const published: ReleaseRecordAlert[] = [];
  const currentChanges: ReleaseRecordAlert[] = [];
  const withdrawals: ReleaseRecordAlert[] = [];
  for (const release of releaseNames) {
    const entry = after.releases[release];
    const earlier = Object.hasOwn(before.releases, release) ? before.releases[release] : undefined;
    const earlierCurrent = earlier?.current ?? null;
    const newBuilds = Object.keys(entry.builds)
      .filter((build) => !earlier || !Object.hasOwn(earlier.builds, build))
      .sort(byName);
    for (const build of newBuilds) {
      published.push({
        kind: "published",
        release,
        build,
        publishedAt: entry.builds[build].publishedAt,
        becameCurrent: entry.current === build && earlierCurrent !== build,
        currentBuild: entry.current,
      });
    }
    // A new build that became current is announced once, as published.
    if (entry.current !== earlierCurrent && !(entry.current != null && newBuilds.includes(entry.current))) {
      currentChanges.push({ kind: "current_changed", release, from: earlierCurrent, to: entry.current });
    }
    for (const build of Object.keys(entry.builds).sort(byName)) {
      const wasWithdrawn = earlier && Object.hasOwn(earlier.builds, build)
        ? earlier.builds[build].withdrawn
        : null;
      if (entry.builds[build].withdrawn && wasWithdrawn === false) {
        withdrawals.push({ kind: "withdrawn", release, build });
      }
    }
  }
  return [...published, ...currentChanges, ...withdrawals];
}

export type UnannouncedRecordChange =
  | { kind: "removed" }
  | { kind: "default_changed"; from: string | null; to: string | null }
  | { kind: "unwithdrawn"; release: string; build: string };

/**
 * Changes between the two records that post no alert but should not pass
 * unnoticed, for the log: the record's removal (readers then fall back to
 * tags and pointer files), a change of default release, and a build that is
 * no longer withdrawn.
 */
export function unannouncedRecordChanges(
  before: ReleasesRecord | null,
  after: ReleasesRecord | null,
): UnannouncedRecordChange[] {
  if (!before) return [];
  if (!after) return [{ kind: "removed" }];
  const changes: UnannouncedRecordChange[] = [];
  if (before.default !== after.default) {
    changes.push({ kind: "default_changed", from: before.default, to: after.default });
  }
  for (const release of Object.keys(after.releases).sort(byName)) {
    const earlier = Object.hasOwn(before.releases, release) ? before.releases[release] : undefined;
    if (!earlier) continue;
    for (const build of Object.keys(after.releases[release].builds).sort(byName)) {
      if (
        Object.hasOwn(earlier.builds, build) &&
        earlier.builds[build].withdrawn &&
        !after.releases[release].builds[build].withdrawn
      ) {
        changes.push({ kind: "unwithdrawn", release, build });
      }
    }
  }
  return changes;
}

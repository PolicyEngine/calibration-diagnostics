/**
 * What the release history page says about the builds of a timeline
 * (calibration-diagnostics#224): the marks on the time axis, the builds an engine has no run
 * for, and the facts of a step's two builds. Everything comes from the timeline's `builds`:
 * listing facts, the file's state on the panel, and what each build declares. No value of any
 * output is read here.
 */
import type { TimelineBuild } from "./release-history-store";

/**
 * A mark on the time axis. `new_build_engine`: the file was built with another model version
 * than the build before it. `same_file`: the build publishes an earlier build's file.
 * `withdrawn`: the publisher withdrew the build.
 */
export type BuildMark = "new_build_engine" | "same_file" | "withdrawn";

export const BUILD_MARK_LABELS: Readonly<Record<BuildMark, string>> = {
  new_build_engine: "New build engine",
  same_file: "Same file as an earlier build",
  withdrawn: "Withdrawn",
};

/** A package as a manifest names it (`{name, version}`, or a pin as text): "name version". */
export function packageLabel(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.replace("==", " ");
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const { name, version } = value as { name?: unknown; version?: unknown };
    if (typeof name === "string" && typeof version === "string") return `${name} ${version}`;
    if (typeof name === "string") return name;
  }
  return null;
}

/** The range of models a build declares: "policyengine-uk ==2.174.1". */
export function compatibleModelsLabel(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const ranges = value.flatMap((item) => {
    const { name, specifier } = (item ?? {}) as { name?: unknown; specifier?: unknown };
    return typeof name === "string" ? [`${name} ${typeof specifier === "string" ? specifier : ""}`.trim()] : [];
  });
  return ranges.length > 0 ? ranges.join(", ") : null;
}

function plain(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/** Each build's marks, in the order of the timeline's builds. */
export function buildMarks(builds: readonly TimelineBuild[]): BuildMark[][] {
  let previousEngine: string | null = null;
  return builds.map((build) => {
    const marks: BuildMark[] = [];
    const engine = packageLabel(build.declared?.builtWithModel);
    // A republished file was built once, and a withdrawn build is no neighbour: neither starts
    // or ends a change of build engine.
    if (engine !== null && build.sameFileAs === null && !build.withdrawn) {
      if (previousEngine !== null && engine !== previousEngine) marks.push("new_build_engine");
      previousEngine = engine;
    }
    if (build.sameFileAs !== null) marks.push("same_file");
    if (build.withdrawn) marks.push("withdrawn");
    return marks;
  });
}

/**
 * The builds on the axis this panel holds no value for, by why: never run on this engine, a run
 * that failed and will be tried again, one that ran out of attempts, or a file the producer
 * refused (a gap on every engine). A withdrawn build is never measured, so it is not listed.
 */
export interface BuildsWithoutRun {
  neverRun: TimelineBuild[];
  retrying: TimelineBuild[];
  failed: TimelineBuild[];
  refused: TimelineBuild[];
  /** Builds on the axis: listed, with a file, not withdrawn. */
  onAxis: number;
}

export function buildsWithoutRun(builds: readonly TimelineBuild[]): BuildsWithoutRun {
  const axis = builds.filter((build) => !build.withdrawn);
  const inState = (state: TimelineBuild["state"]) => axis.filter((build) => build.state === state);
  return {
    neverRun: inState("missing"),
    retrying: inState("retrying"),
    failed: inState("failed"),
    refused: inState("gap"),
    onAxis: axis.length,
  };
}

export function withoutRunCount(without: BuildsWithoutRun): number {
  return without.neverRun.length + without.retrying.length + without.failed.length + without.refused.length;
}

/** One build's state on the panel, in the page's words. */
export function buildStateLabel(build: Pick<TimelineBuild, "state" | "status">): string {
  if (build.state === "measured") return build.status === "partial" ? "Partial" : "Measured";
  return { gap: "Gap", retrying: "Retrying", failed: "Failed", missing: "Not measured" }[build.state];
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

function commitUrl(repository: string | null | undefined, commit: string | null | undefined): string | null {
  return repository && commit && REPOSITORY.test(repository) && COMMIT.test(commit)
    ? `https://github.com/${repository}/commit/${commit}`
    : null;
}

/** What one build declares, ready to show. Null fields are facts the build does not declare. */
export interface BuildFacts {
  build: TimelineBuild;
  /** False for a timeline written before it carried build facts, or a build with no point. */
  declared: boolean;
  /** Another build's id when the point was fetched through it: two builds, one file. */
  fetchedThrough: string | null;
  builtAt: string | null;
  builtWithModel: string | null;
  builtWithCore: string | null;
  compatibleModels: string | null;
  codeRepository: string | null;
  codeCommit: string | null;
  commitUrl: string | null;
  nTargets: number | null;
  targetSurfaceSha256: string | null;
  targetRegistryVersion: string | null;
  householdWeightYear: string | null;
}

export function buildFacts(build: TimelineBuild): BuildFacts {
  const declared = build.declared ?? null;
  return {
    build,
    declared: declared !== null,
    fetchedThrough: declared && declared.fetchedThrough !== build.buildId ? declared.fetchedThrough : null,
    builtAt: declared?.builtAt ?? null,
    builtWithModel: packageLabel(declared?.builtWithModel),
    builtWithCore: packageLabel(declared?.builtWithCore),
    compatibleModels: compatibleModelsLabel(declared?.compatibleModels),
    codeRepository: declared?.codeRepository ?? null,
    codeCommit: declared?.codeCommit ?? null,
    commitUrl: commitUrl(declared?.codeRepository, declared?.codeCommit),
    nTargets: declared?.nTargets ?? null,
    targetSurfaceSha256: declared?.targetSurfaceSha256 ?? null,
    targetRegistryVersion: plain(declared?.targetRegistryVersion),
    householdWeightYear: plain(declared?.householdWeightYear),
  };
}

/** Whether two facts differ; null when either build does not declare the fact. */
function changed<T>(from: T | null, to: T | null): boolean | null {
  return from === null || to === null ? null : from !== to;
}

/**
 * A step's two builds: the build it ends at, and its neighbour, the build before it on the axis
 * (withdrawn builds are never neighbours). `noStepReason` says why no output has a step to this
 * build, when none can.
 */
export interface StepFacts {
  to: BuildFacts;
  from: BuildFacts | null;
  noStepReason: string | null;
  /** GitHub's comparison of the two builds' Microcosm commits. */
  compareUrl: string | null;
  buildEngineChanged: boolean | null;
  targetSetChanged: boolean | null;
  targetRegistryChanged: boolean | null;
  /** Columns the reference model does not define, in one build and not the other. */
  columnsAdded: string[];
  columnsRemoved: string[];
}

function neighbourBefore(builds: readonly TimelineBuild[], index: number): TimelineBuild | null {
  for (let before = index - 1; before >= 0; before -= 1) {
    if (!builds[before].withdrawn) return builds[before];
  }
  return null;
}

function noStepReason(to: TimelineBuild, from: TimelineBuild | null): string | null {
  if (to.withdrawn) return "This build was withdrawn, so no step starts or ends at it.";
  if (!from) return "This is the first build of the series.";
  if (to.state !== "measured") return "This engine holds no value for this build.";
  if (from.state !== "measured") return "This engine holds no value for the build before it.";
  return null;
}

export function stepFacts(builds: readonly TimelineBuild[], index: number): StepFacts | null {
  const build = builds[index];
  if (!build) return null;
  const neighbour = build.withdrawn ? null : neighbourBefore(builds, index);
  const to = buildFacts(build);
  const from = neighbour ? buildFacts(neighbour) : null;
  const sameRepository = from !== null && from.codeRepository !== null && from.codeRepository === to.codeRepository;
  const fromColumns = new Set(neighbour?.unknownColumns ?? []);
  const toColumns = new Set(build.unknownColumns ?? []);
  const comparable = neighbour?.unknownColumns != null && build.unknownColumns != null;
  return {
    to,
    from,
    noStepReason: noStepReason(build, neighbour),
    compareUrl:
      sameRepository && from.commitUrl && to.commitUrl && from.codeCommit !== to.codeCommit
        ? `https://github.com/${to.codeRepository}/compare/${from.codeCommit}...${to.codeCommit}`
        : null,
    buildEngineChanged: from ? changed(from.builtWithModel, to.builtWithModel) : null,
    targetSetChanged: from ? changed(from.targetSurfaceSha256, to.targetSurfaceSha256) : null,
    targetRegistryChanged: from ? changed(from.targetRegistryVersion, to.targetRegistryVersion) : null,
    columnsAdded: comparable ? [...toColumns].filter((column) => !fromColumns.has(column)).sort() : [],
    columnsRemoved: comparable ? [...fromColumns].filter((column) => !toColumns.has(column)).sort() : [],
  };
}

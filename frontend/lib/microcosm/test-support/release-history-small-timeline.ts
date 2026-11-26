// Test support: a small timeline with chosen values, built by the real `buildTimeline`, for
// tests that need exact numbers. Each column of `values` is one build, oldest first.
import {
  buildTimeline,
  type MeasurementCell,
  type ReferencesLock,
  type SeriesBuild,
  type SeriesRecord,
  type Timeline,
} from "../release-history-store";
import { measurementDocument } from "./release-history-documents";

const LINE = "zz-national";
const PANEL = "a".repeat(64);
const digest = (index: number) => index.toString(16).padStart(64, "0");

/** A cell's value, `"withheld"`, or `null` where the build's point holds no such cell. */
export type SmallValue = number | "withheld" | null;

export interface SmallBuild {
  /** Publishes the file of this earlier build (by index). */
  sameFileAs?: number;
  withdrawn?: boolean;
  /** Listed and never measured on this panel. */
  unmeasured?: boolean;
}

export function smallTimeline(options: {
  builds: SmallBuild[];
  /** By output id: `[unit, values per build]`. */
  outputs: Record<string, [MeasurementCell["unit"], SmallValue[]]>;
  references?: ReferencesLock | null;
}): Timeline {
  const builds = options.builds.map((build, index): SeriesBuild => ({
    build_id: `${LINE}/b${index + 1}`,
    release: LINE,
    build: `b${index + 1}`,
    release_directory: `${LINE}/b${index + 1}`,
    published_at: `2026-11-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    withdrawn: build.withdrawn ?? false,
    current: index === options.builds.length - 1,
    in_default_release: true,
    role: "national",
    digest: digest((build.sameFileAs ?? index) + 1),
    dataset_path: `releases/${LINE}/b${index + 1}/zz.h5`,
    release_manifest_sha256: "f".repeat(64),
    listing_status: "ok",
    listing_reason: null,
  }));
  const series: SeriesRecord = {
    format_version: 1,
    kind: "release_history.series",
    country: "zz",
    release_repo: "policyengine/zz",
    rule: { releases: [LINE], since: null },
    revision: "main",
    commit: "1".repeat(40),
    listed_at: "2026-11-30T00:00:00Z",
    record: { present: true, sha256: "d".repeat(64), default: LINE },
    lines: [{ release: LINE, present: true, role: "national" }],
    builds,
  };
  const points = options.builds.flatMap((build, index) => {
    if (build.unmeasured || build.sameFileAs !== undefined) return [];
    const cells = Object.entries(options.outputs).flatMap(([output, [unit, values]]): MeasurementCell[] => {
      const value = values[index];
      if (value === null || value === undefined) return [];
      return [{
        output,
        period: 2026,
        unit,
        value: value === "withheld" ? null : value,
        status: value === "withheld" ? "withheld" : "ok",
        reason: value === "withheld" ? "small_cell" : null,
      }];
    });
    return [measurementDocument({
      country: "zz",
      panelId: PANEL,
      measurementId: digest(index + 1).replace(/^0/, "9"),
      digest: digest(index + 1),
      cells,
    })];
  });
  return buildTimeline({
    country: "zz",
    panelId: PANEL,
    series,
    points,
    references: options.references ?? null,
    labels: null,
    builtAt: "2026-11-30T00:00:00Z",
  });
}

/**
 * A panel's timeline as a long table (calibration-diagnostics#224): one row per build and
 * output, with the step from the build before it on the series and the output's official
 * reference. The columns and rows are those of the producer's `release-history export`
 * (`release_history/export.py`, `TIMELINE_COLUMNS` and `timeline_rows`); a test compares the
 * column lists. A withheld value is an empty cell with the status `withheld`.
 */
import type { Timeline } from "./release-history-store";

export const TIMELINE_CSV_COLUMNS = [
  "build_id",
  "published_at",
  "current",
  "withdrawn",
  "same_file_as",
  "state",
  "measurement_id",
  "reference_model_compatibility",
  "unknown_columns",
  "period",
  "output",
  "unit",
  "value",
  "status",
  "compared_with",
  "change",
  "relative_change",
  "change_points",
  "change_status",
  "reference_status",
  "reference_value",
  "reference_basis",
] as const;

export type TimelineCsvColumn = (typeof TIMELINE_CSV_COLUMNS)[number];
export type TimelineCsvRow = Record<TimelineCsvColumn, string | number | boolean | null>;

/** The official figure in the model's sign convention, when the reference has a value. */
function referenceValue(reference: Timeline["outputs"][number]["reference"]): number | null {
  if (!reference) return null;
  if (typeof reference.modelSignValue === "number") return reference.modelSignValue;
  return typeof reference.value === "number" ? reference.value : null;
}

export function timelineCsvRows(timeline: Timeline): TimelineCsvRow[] {
  const builds = new Map(timeline.builds.map((build) => [build.buildId, build]));
  const rows: TimelineCsvRow[] = [];
  for (const output of timeline.outputs) {
    const reference = output.reference;
    for (const entry of output.values) {
      const build = builds.get(entry.buildId);
      if (!build) continue;
      rows.push({
        build_id: build.buildId,
        published_at: build.publishedAt,
        current: build.current,
        withdrawn: build.withdrawn,
        same_file_as: build.sameFileAs,
        state: build.state,
        measurement_id: build.measurementId,
        reference_model_compatibility: build.referenceModelCompatibility,
        unknown_columns: (build.unknownColumns ?? []).join(";"),
        period: output.period,
        output: output.output,
        unit: output.unit,
        // A withheld cell never carries its value into the export.
        value: entry.status === "ok" ? entry.value : null,
        status: entry.status,
        compared_with: entry.comparedWith,
        change: entry.changeStatus === "ok" ? entry.change : null,
        relative_change: entry.changeStatus === "ok" ? entry.relativeChange : null,
        change_points: entry.changeStatus === "ok" ? entry.changePoints : null,
        change_status: entry.changeStatus,
        reference_status: reference ? reference.status : null,
        reference_value: referenceValue(reference),
        reference_basis: typeof reference?.basis === "string" ? reference.basis : null,
      });
    }
  }
  return rows;
}

function csvField(value: string | number | boolean | null): string {
  if (value === null) return "";
  const field = String(value);
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

/** The table as RFC 4180 text, with a header row. */
export function timelineCsv(timeline: Timeline): string {
  const lines = [TIMELINE_CSV_COLUMNS.join(",")];
  for (const row of timelineCsvRows(timeline)) {
    lines.push(TIMELINE_CSV_COLUMNS.map((column) => csvField(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** The file name a download of a panel's table gets. */
export function timelineCsvFileName(country: string, panelId: string): string {
  return `release-history-${country}-${panelId.slice(0, 12)}.csv`;
}

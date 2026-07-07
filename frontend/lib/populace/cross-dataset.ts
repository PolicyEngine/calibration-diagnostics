// Cross-dataset scoring core.
//
// The cross-dataset comparison scores every dataset (populace + external tax
// microdata) against the SAME surface: PolicyEngine's national calibration
// targets. Each target carries an official value and populace's own estimate;
// external datasets arrive as committed JSONs keyed by the target `name`. A
// dataset "covers" a target only if it can express that concept — federal
// tax-unit engines can express the IRS-SOI tax targets but not SNAP/Medicaid/
// census targets, so coverage is part of the comparison, not a defect.
//
// Lead metric is the calibrator's OWN loss functional — a capped mean absolute
// relative error (capped-MAPE), the same metric the release reports as Final
// loss (see pipeline.ts / latest-artifact.ts), reproduced here over the shared
// surface so datasets compare apples-to-apples.

export const LOSS_ERROR_CAP = 2.0; // 200% — matches the calibration map's cap.

export interface NationalTarget {
  name: string;
  target: number | null | undefined; // official (IRS/SOI/etc.) actual
  populace: number | null | undefined; // populace final_estimate
  source?: string | null;
  variable?: string | null;
  measure?: string | null; // "total" | "count"
}

export interface DatasetScore {
  label: string;
  loss: number | null; // capped-MAPE over covered targets
  median: number | null; // median |err| over covered targets
  within10: number; // # covered targets within 10%
  covered: number; // # targets this dataset expresses
}

export interface ConceptGroup {
  key: string; // "<variable> · <measure>"
  variable: string;
  measure: string;
  cells: number; // # target cells in this concept
  scores: Record<string, { loss: number | null; covered: number }>; // by dataset label
}

// A dataset is a label plus a lookup from target name to its value (null/undefined
// when the dataset cannot express that target).
export interface DatasetInput {
  label: string;
  value: (t: NationalTarget) => number | null | undefined;
}

export function relError(
  estimate: number | null | undefined,
  benchmark: number | null | undefined,
): number | null {
  if (estimate == null || benchmark == null || benchmark === 0) return null;
  return (estimate - benchmark) / Math.abs(benchmark);
}

export function cappedError(absRelError: number): number {
  return Math.min(absRelError, LOSS_ERROR_CAP);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Absolute relative errors for one dataset over the targets it covers. Targets
// with no official value, or that the dataset cannot express, are skipped
// (they simply do not enter that dataset's coverage or loss).
function absErrors(targets: NationalTarget[], ds: DatasetInput): number[] {
  const out: number[] = [];
  for (const t of targets) {
    const rel = relError(ds.value(t), t.target);
    if (rel != null) out.push(Math.abs(rel));
  }
  return out;
}

export function scoreDataset(targets: NationalTarget[], ds: DatasetInput): DatasetScore {
  const errs = absErrors(targets, ds);
  return {
    label: ds.label,
    loss: mean(errs.map(cappedError)),
    median: median(errs),
    within10: errs.filter((e) => e <= 0.1).length,
    covered: errs.length,
  };
}

// Per-concept (variable × measure) breakdown so the 478-cell surface reads as a
// few dozen concept rows instead of a wall of cells. Each concept reports, per
// dataset, its capped-MAPE loss and how many of the concept's cells it covers.
export function conceptBreakdown(
  targets: NationalTarget[],
  datasets: DatasetInput[],
): ConceptGroup[] {
  const groups = new Map<string, NationalTarget[]>();
  for (const t of targets) {
    const variable = t.variable ?? "—";
    const measure = t.measure ?? "—";
    const key = `${variable} · ${measure}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  return [...groups.entries()]
    .map(([key, cells]) => {
      const scores: ConceptGroup["scores"] = {};
      for (const ds of datasets) {
        const errs = absErrors(cells, ds);
        scores[ds.label] = { loss: mean(errs.map(cappedError)), covered: errs.length };
      }
      return {
        key,
        variable: cells[0].variable ?? "—",
        measure: cells[0].measure ?? "—",
        cells: cells.length,
        scores,
      };
    })
    .sort((a, b) => b.cells - a.cells);
}

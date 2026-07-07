"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmtMoney } from "@/components/shared/format";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  usePopulaceReforms,
  type ReformValidationRow,
} from "@/lib/api/hooks/use-populace";

import taxcalcCps2024 from "@/lib/populace/external-datasets/taxcalc-cps-2024.json";
import tmd2024 from "@/lib/populace/external-datasets/tmd-2024.json";

// ---------------------------------------------------------------------------
// Cross-dataset comparison: every dataset is scored against the SAME official
// benchmark surface (the SOI-actual and federal-EITC-by-state suites) and
// datasets compare by their errors — ground truth stays the referee. External
// datasets arrive as committed JSONs from scripts/score_external_dataset.py;
// adding one more file here adds a column, nothing else changes.
// ---------------------------------------------------------------------------

interface ExternalDataset {
  dataset: string;
  label: string;
  engine?: string;
  source?: string;
  source_url?: string;
  year?: number;
  notes?: string;
  rows: Record<string, number>;
}

const EXTERNAL_DATASETS: ExternalDataset[] = [
  tmd2024 as ExternalDataset,
  taxcalcCps2024 as ExternalDataset,
];

// Benchmark suites external federal-only datasets can express.
const COMPARABLE_CATEGORIES = new Set(["IRS SOI actual", "Federal EITC by state"]);

// Lead with the calibrator's own metric, not a descriptive median. The per-row
// term of the normalized target loss is the capped squared relative error
// (min(|err|, 2.0)² — the same LOSS_ERROR_CAP the calibration map uses so a
// near-zero target can't blow the term up). We report its MEAN over each
// dataset's covered rows, so datasets with different coverage stay comparable
// (coverage itself is shown alongside). This is the number the calibration
// optimizes toward; median |err| is kept as a secondary read.
const LOSS_ERROR_CAP = 2.0; // 200%

function lossTerm(absRelError: number): number {
  const capped = Math.min(absRelError, LOSS_ERROR_CAP);
  return capped * capped;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function relError(estimate: number | null | undefined, benchmark: number | null | undefined) {
  if (estimate == null || benchmark == null || benchmark === 0) return null;
  return (estimate - benchmark) / Math.abs(benchmark);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function errClass(rel: number | null): string {
  if (rel == null) return "text-muted-foreground";
  const a = Math.abs(rel);
  if (a <= 0.1) return "text-emerald-700";
  if (a <= 0.25) return "text-amber-700";
  return "text-rose-700";
}

function ValueErrCell({ value, rel }: { value: number | null; rel: number | null }) {
  if (value == null) {
    return <td className="px-3 py-1.5 text-right text-muted-foreground">—</td>;
  }
  return (
    <td className="px-3 py-1.5 text-right">
      <div className="tabular-nums">{fmtMoney(value)}</div>
      <div className={`text-xs tabular-nums ${errClass(rel)}`}>
        {rel == null ? "" : `${rel > 0 ? "+" : ""}${(rel * 100).toFixed(1)}%`}
      </div>
    </td>
  );
}

interface DatasetSummary {
  label: string;
  sub: string;
  errors: number[];
  covered: number;
}

export function CrossDatasetView() {
  const { data, isLoading } = usePopulaceReforms();

  const { rows, datasets } = useMemo(() => {
    const benchRows: ReformValidationRow[] = (data?.rows ?? []).filter(
      (r) => r.category != null && COMPARABLE_CATEGORIES.has(r.category) && r.jct_score != null,
    );
    const populaceSummary: DatasetSummary = {
      label: "populace",
      sub: data?.release_id ?? "current release",
      errors: [],
      covered: 0,
    };
    const externalSummaries = EXTERNAL_DATASETS.map((d) => ({
      label: d.label,
      sub: [d.engine, d.year ? String(d.year) : null].filter(Boolean).join(" · "),
      errors: [] as number[],
      covered: 0,
    }));
    const out = benchRows.map((r) => {
      const populaceRel = relError(r.populace_estimate, r.jct_score);
      if (populaceRel != null) {
        populaceSummary.errors.push(Math.abs(populaceRel));
        populaceSummary.covered += 1;
      }
      const externals = EXTERNAL_DATASETS.map((d, i) => {
        const value = d.rows[r.id];
        const rel = relError(value ?? null, r.jct_score);
        if (rel != null) {
          externalSummaries[i].errors.push(Math.abs(rel));
          externalSummaries[i].covered += 1;
        }
        return { value: value ?? null, rel };
      });
      return { row: r, populaceRel, externals };
    });
    return { rows: out, datasets: [populaceSummary, ...externalSummaries] };
  }, [data]);

  if (isLoading) return <LoadingBlock label="Loading benchmark surface…" />;
  if (!rows.length) {
    return (
      <EmptyState
        title="No comparable benchmark rows"
        description="The cross-dataset view needs the SOI-actual and federal-EITC suites in the release's reform-validation payload."
      />
    );
  }

  const totalRows = rows.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cross-dataset comparison"
        description="Every dataset scored against the same official actuals — datasets compare by the calibration's own loss (mean capped squared relative error, the per-row term of the normalized target loss we optimize), with median |err| and coverage alongside. Ground truth stays the referee. External columns come from committed JSONs (scripts/score_external_dataset.py); federal-only files simply do not cover state-program rows, and that coverage gap is part of the comparison."
      />

      <SectionCard
        title="Dataset scorecard"
        description="Each dataset over the shared comparable surface. Overall loss is the calibration's own loss functional — the summed capped squared relative error (the normalized target loss we optimize) over the rows a dataset covers; it is what the calibration minimizes, but it scales with coverage, so read it against the Coverage column. Mean loss divides that by covered rows for a coverage-fair comparison. Lower is better on both."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Dataset</th>
                <th className="px-3 py-2 text-right">Overall loss</th>
                <th className="px-3 py-2 text-right">Mean loss</th>
                <th className="px-3 py-2 text-right">Median |err|</th>
                <th className="px-3 py-2 text-right">Within 10%</th>
                <th className="px-3 py-2 text-right">Coverage</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => {
                const terms = d.errors.map(lossTerm);
                const totalLoss = terms.length ? terms.reduce((s, v) => s + v, 0) : null;
                const meanLoss = mean(terms);
                const med = median(d.errors);
                const within10 = d.errors.filter((e) => e <= 0.1).length;
                return (
                  <tr key={d.label} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-medium">{d.label}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                      {totalLoss == null ? "—" : totalLoss.toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {meanLoss == null ? "—" : meanLoss.toFixed(3)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {med == null ? "—" : `${(med * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {d.covered ? `${within10}/${d.covered}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {d.covered}/{totalRows}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      <span className="block max-w-[26ch] truncate" title={d.sub}>
                        {d.sub || "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Benchmark rows"
        description="Official actual per row; each dataset cell shows its simulated total and the signed error vs the actual. — means the dataset cannot express the row (missing input base, no state model, or no file yet)."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Benchmark</th>
                <th className="px-3 py-2">Suite</th>
                <th className="px-3 py-2 text-right">Official</th>
                <th className="px-3 py-2 text-right">populace</th>
                {EXTERNAL_DATASETS.map((d) => (
                  <th key={d.dataset} className="px-3 py-2 text-right">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, populaceRel, externals }) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-1.5">{row.name}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.category}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmtMoney(row.jct_score)}
                  </td>
                  <ValueErrCell value={row.populace_estimate ?? null} rel={populaceRel} />
                  {externals.map((e, i) => (
                    <ValueErrCell key={i} value={e.value} rel={e.rel} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {EXTERNAL_DATASETS.map((d) => (
        <SectionCard key={d.dataset} title={d.label} description={d.source}>
          <p className="text-sm text-muted-foreground">{d.notes}</p>
          {d.source_url && (
            <a
              className="mt-2 inline-block text-sm text-primary underline"
              href={d.source_url}
              target="_blank"
              rel="noreferrer"
            >
              {d.source_url}
            </a>
          )}
        </SectionCard>
      ))}
    </div>
  );
}

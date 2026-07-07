"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { usePopulaceTargetDiagnostics } from "@/lib/api/hooks/use-populace";
import {
  conceptBreakdown,
  scoreDataset,
  type DatasetInput,
  type NationalTarget,
} from "@/lib/populace/cross-dataset";

import taxcalcNational from "@/lib/populace/external-datasets/taxcalc-cps-national-2024.json";
import tmdNational from "@/lib/populace/external-datasets/tmd-national-2024.json";

// ---------------------------------------------------------------------------
// Cross-dataset comparison. Every dataset is scored against the SAME surface:
// PolicyEngine's national calibration targets (official IRS/SOI/etc. actuals
// the US microdata is built to match) — so the benchmark set isn't ours to
// pick, it's what the model calibrates to. populace covers ~all of it; a
// federal tax-unit engine (TMD, Tax-Calculator CPS) covers the SOI tax
// concepts it can express, and that coverage gap is part of the comparison.
// External columns are committed JSONs from scripts/score_external_dataset.py,
// keyed by target name. Lead metric is the calibration's own capped-MAPE loss.
// ---------------------------------------------------------------------------

interface ExternalDataset {
  dataset: string;
  label: string;
  engine?: string;
  year?: number;
  source?: string;
  source_url?: string;
  notes?: string;
  rows: Record<string, number>;
}

const EXTERNAL_DATASETS: ExternalDataset[] = [
  tmdNational as ExternalDataset,
  taxcalcNational as ExternalDataset,
];

function fmtLoss(loss: number | null): string {
  return loss == null ? "—" : loss.toFixed(3);
}

export function CrossDatasetView() {
  const { data, isLoading } = usePopulaceTargetDiagnostics({ level: "national", limit: 500 });

  const { targets, datasets, scores, concepts, releaseId } = useMemo(() => {
    const targets: NationalTarget[] = (data?.targets ?? [])
      .filter((t): t is typeof t & { name: string } => !!t.name && t.target != null)
      .map((t) => ({
        name: t.name,
        target: t.target,
        populace: t.final_estimate,
        source: t.source,
        variable: t.variable,
        measure: t.measure,
      }));

    const datasets: DatasetInput[] = [
      { label: "populace", value: (t) => t.populace },
      ...EXTERNAL_DATASETS.map(
        (d): DatasetInput => ({ label: d.label, value: (t) => d.rows[t.name] }),
      ),
    ];

    return {
      targets,
      datasets,
      scores: datasets.map((ds) => scoreDataset(targets, ds)),
      concepts: conceptBreakdown(targets, datasets),
      releaseId: data?.release_id ?? null,
    };
  }, [data]);

  if (isLoading) return <LoadingBlock label="Loading national target surface…" />;
  if (!targets.length) {
    return (
      <EmptyState
        title="No national targets"
        description="The cross-dataset view needs the release's national calibration targets (target-diagnostics, level=national)."
      />
    );
  }

  const subOf = (label: string): string => {
    if (label === "populace") return releaseId ?? "current release";
    const d = EXTERNAL_DATASETS.find((x) => x.label === label);
    return [d?.engine, d?.year ? String(d.year) : null].filter(Boolean).join(" · ");
  };
  const total = targets.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cross-dataset comparison"
        description="Every dataset scored against the model's own national calibration targets — the official IRS/SOI/etc. actuals PolicyEngine's US microdata is built to match, so the benchmark set isn't hand-picked. Datasets compare by the calibration's own loss (capped-MAPE: the capped mean absolute relative error, the same functional the release reports as Final loss). populace covers ~all targets; federal tax-unit engines cover the SOI tax concepts they can express, and that coverage gap is part of the comparison."
      />

      <SectionCard
        title="Dataset scorecard"
        description="Each dataset over the shared national target surface. Loss is the capped-MAPE the calibration minimizes (lower is better). Coverage is how many targets the dataset can express — a federal tax engine cannot express SNAP/Medicaid/census targets, so it covers fewer than populace by design."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Dataset</th>
                <th className="px-3 py-2 text-right">Loss (capped MAPE)</th>
                <th className="px-3 py-2 text-right">Median |err|</th>
                <th className="px-3 py-2 text-right">Within 10%</th>
                <th className="px-3 py-2 text-right">Coverage</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => {
                const sub = subOf(s.label);
                return (
                  <tr key={s.label} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5 font-medium">{s.label}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                      {fmtLoss(s.loss)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {s.median == null ? "—" : `${(s.median * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {s.covered ? `${s.within10}/${s.covered}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {s.covered}/{total}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      <span className="block max-w-[26ch] truncate" title={sub}>
                        {sub || "—"}
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
        title="By concept"
        description="The national surface broken down by concept (variable × measure). Each cell shows the dataset's capped-MAPE loss over that concept's target cells, with coverage (cells expressed / cells in the concept). — means the dataset cannot express the concept."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Concept</th>
                <th className="px-3 py-2 text-right">Cells</th>
                {datasets.map((d) => (
                  <th key={d.label} className="px-3 py-2 text-right">
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {concepts.map((c) => (
                <tr key={c.key} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-1.5">
                    <span className="font-medium">{c.variable}</span>{" "}
                    <span className="text-xs text-muted-foreground">· {c.measure}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {c.cells}
                  </td>
                  {datasets.map((d) => {
                    const sc = c.scores[d.label];
                    return (
                      <td key={d.label} className="px-3 py-1.5 text-right tabular-nums">
                        {sc.covered === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span>
                            {fmtLoss(sc.loss)}
                            {sc.covered < c.cells && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                {sc.covered}/{c.cells}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                    );
                  })}
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

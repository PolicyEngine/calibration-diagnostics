"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Stack,
  Text,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";

import { AppShell } from "@/components/layout/app-shell";
import { DataTable } from "@/components/shared/InteractiveDataTable";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import {
  useMicroplex,
  type MicroplexRunSummary,
  type MicroplexFamilyCount,
  type MicroplexTargetCount,
  type MicroplexFilingStatusGap,
  type MicroplexAgiGap,
} from "@/lib/api/hooks/use-microplex";

function fmt(v: number | null | undefined, opts: { pct?: boolean } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (opts.pct) return `${(v * 100).toFixed(1)}%`;
  if (Math.abs(v) >= 1000 || Number.isInteger(v)) return formatNumber(v);
  return v.toFixed(4);
}

function deltaBadge(v: number | null | undefined, improveIsLower = true) {
  if (v == null || !Number.isFinite(v)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const improved = improveIsLower ? v < 0 : v > 0;
  const variant: "success" | "error" | "secondary" =
    Math.abs(v) < 1e-9 ? "secondary" : improved ? "success" : "error";
  const sign = v > 0 ? "+" : "";
  return (
    <Badge variant={variant}>
      {sign}
      {fmt(v)}
    </Badge>
  );
}

const bestWorstColumns = [
  { key: "artifactPath", header: "Run", format: (v: unknown) => (
    <span className="font-mono text-xs">{String(v)}</span>
  ) },
  {
    key: "lossDelta",
    header: "Loss Δ",
    align: "right" as const,
    format: (v: unknown) => deltaBadge(Number(v)),
  },
  {
    key: "candidateBeatsBaseline",
    header: "Beats baseline?",
    format: (v: unknown) =>
      v ? <Badge variant="success">yes</Badge> : <Badge variant="secondary">no</Badge>,
  },
  {
    key: "largestRegressingFamily",
    header: "Worst family",
    format: (v: unknown) => (
      <span className="text-xs font-mono">{v == null ? "—" : String(v)}</span>
    ),
  },
  {
    key: "largestRegressingFamilyDelta",
    header: "Family Δ",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : Number(v).toFixed(3),
  },
];

const familyColumns = [
  { key: "family", header: "Family", format: (v: unknown) => (
    <span className="font-mono text-xs">{String(v)}</span>
  ) },
  {
    key: "rank1Count",
    header: "#1",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "rank2Count",
    header: "#2",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "rank3Count",
    header: "#3",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "top3Count",
    header: "Top-3 (Σ)",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
];

const leadColumns = [
  {
    key: "target",
    header: "Target",
    format: (v: unknown) => (
      <span className="font-mono text-xs">{String(v)}</span>
    ),
  },
  {
    key: "weightedTermDelta",
    header: "Weighted Δ",
    align: "right" as const,
    format: (v: unknown) => Number(v).toFixed(2),
  },
];

const targetCountColumns = [
  {
    key: "target",
    header: "Target",
    format: (v: unknown) => (
      <span className="font-mono text-xs">{String(v)}</span>
    ),
  },
  {
    key: "count",
    header: "Count",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "weightedTermDeltaMean",
    header: "Mean weighted Δ",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : Number(v).toFixed(2),
  },
  {
    key: "weightedTermDeltaSum",
    header: "Σ weighted Δ",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : Number(v).toFixed(2),
  },
];

const filingStatusGapColumns = [
  {
    key: "filingStatus",
    header: "Filing status",
    format: (v: unknown) => (
      <span className="font-mono text-xs">{String(v)}</span>
    ),
  },
  {
    key: "meanAbsWeightedCountDelta",
    header: "Mean |count Δ|",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "weightedCountDeltaSum",
    header: "Σ count Δ",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "positiveCount",
    header: "+ audits",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "negativeCount",
    header: "- audits",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
];

const agiGapColumns = [
  {
    key: "agiBin",
    header: "AGI bin",
    format: (v: unknown) => (
      <span className="font-mono text-xs">{String(v)}</span>
    ),
  },
  {
    key: "meanAbsWeightedCountDelta",
    header: "Mean |count Δ|",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "weightedCountDeltaSum",
    header: "Σ count Δ",
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "positiveCount",
    header: "+ audits",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
  {
    key: "negativeCount",
    header: "- audits",
    align: "right" as const,
    format: (v: unknown) => formatNumber(Number(v)),
  },
];

export default function MicroplexPage() {
  const { data, isLoading, error } = useMicroplex();

  if (isLoading)
    return (
      <AppShell>
        <LoadingBlock label="Fetching microplex parity artifacts…" />
      </AppShell>
    );
  if (error)
    return (
      <AppShell>
        <Text size="sm" c="red">
          Failed to load microplex artifacts: {String(error)}
        </Text>
      </AppShell>
    );
  if (!data) return null;

  const h = data.headline;
  const leadAuditTargets = data.irs_drilldown.lead_audits.flatMap((a) =>
    (a.matchingTargets ?? []).map((t) => ({ ...t, audit: a.artifactPath })),
  );

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>microplex vs us-data</Title>
          <Text c="dimmed" size="sm">
            Read-only aggregate view of the parity artifacts committed in{" "}
            <a
              href="https://github.com/PolicyEngine/microplex-us/tree/main/artifacts"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              PolicyEngine/microplex-us
            </a>
            . Microplex synthesizes microdata via normalizing flows and
            sparse reweighting; this page surfaces how its outputs score
            against the same PE target oracle that us-data calibrates to.
            Per-target diffs and the output h5 aren&apos;t published yet
            (private R2 bucket only), so we show what&apos;s on GitHub.
          </Text>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Headline parity ({h.candidate_label} vs {h.baseline_label})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex flex-col gap-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Composite parity loss
                </div>
                <div>baseline <strong>{fmt(h.baseline_composite_parity_loss)}</strong></div>
                <div>candidate <strong>{fmt(h.candidate_composite_parity_loss)}</strong></div>
                <div>Δ {deltaBadge(h.composite_parity_loss_delta)}</div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Mean |relative error|
                </div>
                <div>baseline <strong>{fmt(h.baseline_mean_abs_relative_error)}</strong></div>
                <div>candidate <strong>{fmt(h.candidate_mean_abs_relative_error)}</strong></div>
                <div>Δ {deltaBadge(h.mean_abs_relative_error_delta)}</div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Coverage
                </div>
                <div>slice win rate <strong>{fmt(h.slice_win_rate, { pct: true })}</strong></div>
                <div>target win rate <strong>{fmt(h.target_win_rate, { pct: true })}</strong></div>
                <div>supported target rate <strong>{fmt(h.supported_target_rate, { pct: true })}</strong></div>
                <div>n synthetic <strong>{fmt(h.n_synthetic)}</strong></div>
                <div>profile <span className="font-mono text-xs">{h.calibration_target_profile}</span></div>
              </div>
            </div>
            {data.verdict && (
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(data.verdict).map(([k, v]) => (
                  <Badge key={k} variant={v ? "success" : "secondary"}>
                    {v ? "✓" : "✗"} {k}
                  </Badge>
                ))}
              </div>
            )}
            <Text size="xs" c="dimmed" className="mt-3">
              artifact_id <code className="font-mono">{data.artifact_id}</code>
            </Text>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.source_artifacts.map((artifact) => (
                <a
                  key={artifact.name}
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  {artifact.name}
                </a>
              ))}
            </div>
            <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
              {data.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Best runs (lowest loss Δ)</CardTitle>
            </CardHeader>
            <CardContent>
              <Text size="xs" c="dimmed" className="mb-2">
                Across {fmt(data.regression_summary.total_scored_runs)} scored
                runs ({fmt(data.regression_summary.total_audited_runs)} audited).
              </Text>
              <DataTable
                columns={bestWorstColumns}
                data={data.regression_summary.best_runs as unknown as Record<string, unknown>[]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Worst runs (highest loss Δ)</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={bestWorstColumns}
                data={data.regression_summary.worst_runs as unknown as Record<string, unknown>[]}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Top regressing families (how often each ranks as worst)</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={familyColumns}
              data={
                data.regression_summary.top3_family_counts as unknown as Record<
                  string,
                  unknown
                >[]
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Targets most often appearing in audited regressions</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={targetCountColumns}
              data={
                data.regression_summary.target_counts_from_audits.slice(0, 25) as unknown as Record<
                  string,
                  unknown
                >[]
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              IRS drilldown — {data.irs_drilldown.family} (leads{" "}
              {data.irs_drilldown.audits_where_family_leads} audits)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Text size="xs" c="dimmed" className="mb-2">
              Specific targets in the worst-offending family, ranked by
              weighted term Δ (positive = microplex worse than baseline on
              this target).
            </Text>
            <DataTable
              columns={leadColumns}
              data={leadAuditTargets.slice(0, 25) as unknown as Record<string, unknown>[]}
            />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Filing-status gaps in IRS lead audits</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={filingStatusGapColumns}
                data={
                  data.irs_drilldown.lead_filing_status_gap_summary as unknown as Record<
                    string,
                    unknown
                  >[]
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>MFS AGI-bin gaps in IRS lead audits</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={agiGapColumns}
                data={
                  data.irs_drilldown.lead_mfs_agi_gap_summary as unknown as Record<
                    string,
                    unknown
                  >[]
                }
              />
            </CardContent>
          </Card>
        </div>
      </Stack>
    </AppShell>
  );
}

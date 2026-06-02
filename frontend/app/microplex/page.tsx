"use client";

import { useState, type ReactNode } from "react";

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
  useMicroplexReformComparison,
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
    <span className="block max-w-[360px] whitespace-normal break-words font-mono text-xs">
      {String(v)}
    </span>
  ) },
  {
    key: "lossDelta",
    header: (
      <HelpText title="Loss delta is Microplex loss minus us-data baseline loss. Positive means Microplex has higher loss.">
        Loss delta
      </HelpText>
    ),
    align: "right" as const,
    format: (v: unknown) => deltaBadge(Number(v)),
  },
  {
    key: "candidateBeatsBaseline",
    header: "Beats us-data?",
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
    header: (
      <HelpText title="Family delta is the loss contribution change for the worst regressing target family. Positive means that family is worse for Microplex.">
        Family delta
      </HelpText>
    ),
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
    header: (
      <HelpText title="How many public runs had this family ranked among the three largest regressions.">
        Top-3 total
      </HelpText>
    ),
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
    header: (
      <HelpText title="Weighted delta is Microplex weighted loss term minus the us-data baseline weighted loss term for this target. Positive means Microplex is worse.">
        Weighted delta
      </HelpText>
    ),
    align: "right" as const,
    format: (v: unknown) => Number(v).toFixed(2),
  },
];

function metricTone(value: number | null | undefined, improveIsLower = true) {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return "secondary" as const;
  }
  return (improveIsLower ? value < 0 : value > 0) ? "success" as const : "error" as const;
}

function MetricTile({
  label,
  value,
  detail,
  badge,
}: {
  label: ReactNode;
  value: string;
  detail?: string;
  badge?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        {badge}
      </div>
      <div className="mt-1 text-2xl font-semibold leading-tight">{value}</div>
      {detail && (
        <Text size="xs" c="dimmed" className="mt-1">
          {detail}
        </Text>
      )}
    </div>
  );
}

function SectionIntro({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <Title order={3}>{title}</Title>
      {children && (
        <Text c="dimmed" size="sm" className="mt-1 max-w-4xl">
          {children}
        </Text>
      )}
    </div>
  );
}

function HelpText({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span
      className="group relative inline-flex cursor-help items-center gap-1 normal-case tracking-normal underline decoration-dotted underline-offset-2 focus-within:outline-none"
      tabIndex={0}
    >
      {children}
      <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground no-underline normal-case tracking-normal">
        ?
      </span>
      <span className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-md border border-border bg-white p-3 text-left text-xs font-normal leading-snug text-foreground shadow-lg normal-case tracking-normal group-hover:block group-focus:block">
        {title}
      </span>
    </span>
  );
}

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
    header: (
      <HelpText title="Average weighted loss delta across audited appearances of this target. Positive means Microplex is worse.">
        Mean weighted delta
      </HelpText>
    ),
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : Number(v).toFixed(2),
  },
  {
    key: "weightedTermDeltaSum",
    header: (
      <HelpText title="Sum of weighted loss deltas across audited appearances of this target.">
        Total weighted delta
      </HelpText>
    ),
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
    header: (
      <HelpText title="Average absolute weighted count gap for this filing status across lead audits.">
        Mean count gap
      </HelpText>
    ),
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "weightedCountDeltaSum",
    header: (
      <HelpText title="Signed sum of weighted count gaps. Positive means Microplex is higher than the us-data baseline; negative means lower.">
        Total count gap
      </HelpText>
    ),
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
    header: (
      <HelpText title="Average absolute weighted count gap for this AGI bin across lead audits.">
        Mean count gap
      </HelpText>
    ),
    align: "right" as const,
    format: (v: unknown) =>
      v == null ? "—" : formatNumber(Number(v)),
  },
  {
    key: "weightedCountDeltaSum",
    header: (
      <HelpText title="Signed sum of weighted count gaps. Positive means Microplex is higher than the us-data baseline; negative means lower.">
        Total count gap
      </HelpText>
    ),
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

const targetDiagnosticsColumns = [
  {
    key: "target_id",
    header: "Target",
    format: (v: unknown, row: Record<string, unknown>) => (
      <span className="block max-w-[420px] whitespace-normal break-words font-mono text-xs">
        {String(v ?? row.target_name ?? "—")}
      </span>
    ),
  },
  {
    key: "family",
    header: "Family",
    format: (v: unknown, row: Record<string, unknown>) => (
      <span className="font-mono text-xs">
        {String(v ?? row.target_family ?? "—")}
      </span>
    ),
  },
  {
    key: "target_value",
    header: "Target value",
    align: "right" as const,
    format: (v: unknown) => (v == null ? "—" : fmt(Number(v))),
  },
  {
    key: "us_data_aggregate",
    header: "us-data aggregate",
    align: "right" as const,
    format: (v: unknown, row: Record<string, unknown>) => {
      const value = v ?? row.from_estimate;
      return value == null ? "—" : fmt(Number(value));
    },
  },
  {
    key: "microplex_aggregate",
    header: "Microplex aggregate",
    align: "right" as const,
    format: (v: unknown, row: Record<string, unknown>) => {
      const value = v ?? row.to_estimate;
      return value == null ? "—" : fmt(Number(value));
    },
  },
  {
    key: "delta_absolute_error",
    header: (
      <HelpText title="Microplex absolute error minus us-data absolute error. Negative means Microplex is closer to the target.">
        Error delta
      </HelpText>
    ),
    align: "right" as const,
    format: (v: unknown, row: Record<string, unknown>) => {
      let value = v;
      if (value == null) {
        const target = Number(row.target_value);
        const fromEstimate = Number(row.from_estimate ?? row.us_data_aggregate);
        const toEstimate = Number(row.to_estimate ?? row.microplex_aggregate);
        if (
          Number.isFinite(target) &&
          Number.isFinite(fromEstimate) &&
          Number.isFinite(toEstimate)
        ) {
          value = Math.abs(toEstimate - target) - Math.abs(fromEstimate - target);
        }
      }
      return value == null ? "—" : deltaBadge(Number(value));
    },
  },
  {
    key: "supported_by_microplex",
    header: "Supported",
    format: (v: unknown) =>
      v === true ? (
        <Badge variant="success">yes</Badge>
      ) : v === false ? (
        <Badge variant="secondary">no</Badge>
      ) : (
        "—"
      ),
  },
];

function ReformComparisonCard({
  comparison,
  isLoading,
  error,
  reformId,
  onReformChange,
}: {
  comparison: ReturnType<typeof useMicroplexReformComparison>["data"];
  isLoading: boolean;
  error: unknown;
  reformId: string;
  onReformChange: (value: string) => void;
}) {
  const outcome = comparison?.outcomes?.[0];
  const reformOptions = comparison?.available_reforms ?? [
    {
      id: "american_family_act_2025",
      label: "American Family Act 2025 CTC expansion",
    },
    {
      id: "working_parents_tax_relief_act_2026",
      label: "Working Parents Tax Relief Act EITC enhancement",
    },
    {
      id: "halve_joint_eitc_phase_out_rate",
      label: "Halve joint-filer EITC phase-out rate",
    },
  ];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Microsim reform comparison</CardTitle>
          {comparison?.available ? (
            <Badge variant="success">ran locally</Badge>
          ) : (
            <Badge variant="secondary">
              {isLoading ? "running" : "not available"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Stack gap="md">
          <label className="flex max-w-xl flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              Reform preset
            </span>
            <select
              value={reformId}
              onChange={(event) => onReformChange(event.target.value)}
              className="h-10 rounded-md border border-border bg-white px-3 text-sm"
            >
              {reformOptions.map((reform) => (
                <option key={reform.id} value={reform.id}>
                  {reform.label}
                </option>
              ))}
            </select>
          </label>
          <Text size="sm" c="dimmed">
            Runs the same PolicyEngine-US reform over the incumbent us-data H5
            and the configured Microplex H5. This is a reform-sensitivity check:
            it tells us whether the candidate dataset produces a comparable
            aggregate policy impact, not whether the reform itself is calibrated.
          </Text>

          {isLoading && (
            <LoadingBlock label="Running PolicyEngine microsim comparison…" />
          )}
          {error ? (
            <Text size="sm" c="red">
              Failed to run microsim comparison: {String(error)}
            </Text>
          ) : null}
          {!isLoading && comparison && !comparison.available && (
            <Text size="sm" c="dimmed">
              {comparison.reason ?? "No Microplex H5 is configured."}
            </Text>
          )}
          {comparison?.available && outcome && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <MetricTile
                  label={
                    <HelpText title="us-data reform delta is the weighted aggregate reformed value minus baseline value using the incumbent PolicyEngine us-data dataset.">
                      us-data {outcome.variable} delta
                    </HelpText>
                  }
                  value={fmt(outcome.us_data.delta)}
                  detail={`baseline ${fmt(outcome.us_data.baseline.total)}`}
                />
                <MetricTile
                  label={
                    <HelpText title="Microplex reform delta is the weighted aggregate reformed value minus baseline value using the Microplex candidate H5 from the configured run bundle.">
                      Microplex {outcome.variable} delta
                    </HelpText>
                  }
                  value={fmt(outcome.microplex.delta)}
                  detail={`baseline ${fmt(outcome.microplex.baseline.total)}`}
                />
                <MetricTile
                  label={
                    <HelpText title="Microplex delta divided by us-data delta. A value near 1 means the candidate dataset gives a similar aggregate reform impact for this outcome.">
                      Delta ratio
                    </HelpText>
                  }
                  value={fmt(outcome.microplex_delta_as_share_of_us_data)}
                  detail={`gap ${fmt(outcome.delta_gap)}`}
                />
              </div>
              <Text size="xs" c="dimmed">
                Reform: {comparison.reform?.label ?? "unknown"} for period{" "}
                {comparison.period}. Microplex artifact{" "}
                <span className="font-mono">
                  {comparison.microplex_bundle?.artifact_id ?? "unknown"}
                </span>
                . us-data records: {fmt(outcome.us_data.baseline.record_count)};
                Microplex records: {fmt(outcome.microplex.baseline.record_count)}
                {comparison.runtime_seconds != null
                  ? `; runtime ${comparison.runtime_seconds.toFixed(1)}s`
                  : ""}
                .
                {comparison.reform?.source_url ? (
                  <>
                    {" "}
                    <a
                      href={comparison.reform.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      Source
                    </a>
                    .
                  </>
                ) : null}
              </Text>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function MicroplexPage() {
  const { data, isLoading, error } = useMicroplex();
  const [selectedReformId, setSelectedReformId] = useState(
    "american_family_act_2025",
  );
  const reformComparison = useMicroplexReformComparison(selectedReformId);

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
  const native = data.native_scores;
  const hasConfiguredBundleScore = native.source === "configured_run_bundle";
  const verdictEntries = data.verdict ? Object.entries(data.verdict) : [];
  const leadAuditTargets = data.irs_drilldown.lead_audits.flatMap((a) =>
    (a.matchingTargets ?? []).map((t) => ({ ...t, audit: a.artifactPath })),
  );
  const topFamilies = data.regression_summary.top3_family_counts.slice(0, 5);
  const topTargets = data.regression_summary.target_counts_from_audits.slice(0, 8);
  const targetDiagnostics = data.target_diagnostics;

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Microplex target performance</Title>
          <Text c="dimmed" size="sm">
            Read-only aggregate view of the Microplex summary artifacts
            committed in{" "}
            <a
              href="https://github.com/PolicyEngine/microplex-us/tree/main/artifacts"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              PolicyEngine/microplex-us
            </a>
            . The primary question here is how Microplex scores against the{" "}
            <HelpText title="The target oracle is the active PolicyEngine target set used to score aggregate fit. It is the benchmark Microplex is evaluated against.">
              PolicyEngine target oracle
            </HelpText>
            . The incumbent us-data baseline is shown only as comparison
            context.
          </Text>
        </div>

        <Card>
          <CardContent className="py-4">
            <Text size="sm" c="dimmed">
              <strong>us-data baseline</strong> means the incumbent
              PolicyEngine us-data dataset scored through the same target
              oracle. It is useful context, but the main question is still:
              how close is Microplex to each target value?
            </Text>
          </CardContent>
        </Card>

        <ReformComparisonCard
          comparison={reformComparison.data}
          isLoading={reformComparison.isLoading}
          error={reformComparison.error}
          reformId={selectedReformId}
          onReformChange={setSelectedReformId}
        />

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                {hasConfiguredBundleScore
                  ? "Run bundle broad target score"
                  : "Historical broad target score"}
              </CardTitle>
              <Badge variant={metricTone(native.enhanced_cps_native_loss_delta)}>
                {native.candidate_beats_baseline
                  ? "beats us-data baseline"
                  : "us-data baseline lower loss"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="md">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <MetricTile
                  label={
                    <HelpText
                      title={
                        hasConfiguredBundleScore
                          ? "Native loss is the PolicyEngine-us-data broad target loss computed by running dataset aggregates against the active target set. This value is read from the configured Microplex run bundle. Lower is better."
                          : "Native loss is the PolicyEngine-us-data broad target loss computed by running dataset aggregates against the active target set. This value is read from the committed public Microplex parity artifact, not recomputed live. Lower is better."
                      }
                    >
                      {hasConfiguredBundleScore
                        ? "Microplex native loss"
                        : "Historical Microplex native loss"}
                    </HelpText>
                  }
                  value={fmt(native.candidate_enhanced_cps_native_loss)}
                  detail={`us-data baseline ${fmt(
                    native.baseline_enhanced_cps_native_loss,
                  )}`}
                  badge={deltaBadge(native.enhanced_cps_native_loss_delta)}
                />
                <MetricTile
                  label={
                    <HelpText title="MSRE means mean squared relative error. This version is unweighted across scored targets. Lower is better.">
                      Microplex unweighted MSRE
                    </HelpText>
                  }
                  value={fmt(native.candidate_unweighted_msre)}
                  detail={`us-data baseline ${fmt(native.baseline_unweighted_msre)}`}
                  badge={deltaBadge(native.unweighted_msre_delta)}
                />
                <MetricTile
                  label={
                    <HelpText title="Targets scored are target rows kept in the native loss calculation after dropping invalid, bad, or zero-valued targets.">
                      Targets scored
                    </HelpText>
                  }
                  value={fmt(native.n_targets_kept)}
                  detail={`${fmt(native.n_national_targets)} national, ${fmt(
                    native.n_state_targets,
                  )} state, out of ${fmt(native.n_targets_total)} total`}
                />
              </div>
              <Text size="sm" c="dimmed">
                Lower loss is better.{" "}
                {hasConfiguredBundleScore ? (
                  <>
                    These values come from configured run bundle{" "}
                    <span className="font-mono">
                      {native.artifact_id ?? data.artifact_id ?? "unknown"}
                    </span>
                    {native.source_path ? (
                      <>
                        {" "}via{" "}
                        <span className="font-mono break-all">
                          {native.source_path}
                        </span>
                      </>
                    ) : null}
                    .
                  </>
                ) : (
                  <>
                    These values come from the committed public parity artifact{" "}
                    <span className="font-mono">
                      {data.artifact_id ?? "unknown"}
                    </span>
                    , which does not include candidate or baseline dataset paths
                    and should not be read as a current live Microplex score.
                  </>
                )}{" "}
                The full row-level aggregate table is generated in each newer
                run bundle as{" "}
                <span className="font-mono">
                  {native.full_target_diagnostics_path}
                </span>
                {" "}under manifest key{" "}
                <span className="font-mono">
                  {native.full_target_diagnostics_manifest_key}
                </span>
                , but those generated bundles are not committed publicly yet.
              </Text>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Target diagnostics rows</CardTitle>
              <Badge variant={targetDiagnostics.available ? "success" : "secondary"}>
                {targetDiagnostics.available ? "loaded" : "not loaded"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Row-level target diagnostics from{" "}
                <span className="font-mono break-all">
                  {targetDiagnostics.path ?? native.full_target_diagnostics_path}
                </span>
                . Showing {fmt(targetDiagnostics.targets.length)} of{" "}
                {fmt(targetDiagnostics.total_targets)} rows.
              </Text>
              <DataTable
                columns={targetDiagnosticsColumns}
                data={
                  targetDiagnostics.targets as unknown as Record<
                    string,
                    unknown
                  >[]
                }
              />
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="md">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <MetricTile
                  label={
                    <HelpText title="The supported target rate is the share of oracle targets that Microplex can currently evaluate with its available variables and entity structure.">
                      Supported target rate
                    </HelpText>
                  }
                  value={fmt(h.supported_target_rate, { pct: true })}
                  detail="share of oracle targets Microplex can evaluate"
                />
                <MetricTile
                  label={
                    <HelpText title="Target win rate is the share of scored target rows where Microplex has lower error than the us-data baseline in the public summary.">
                      Target win rate
                    </HelpText>
                  }
                  value={fmt(h.target_win_rate, { pct: true })}
                  detail="share beating us-data baseline in public summary"
                />
                <MetricTile
                  label={
                    <HelpText title="Synthetic records is the number of generated Microplex records in this public artifact.">
                      Synthetic records
                    </HelpText>
                  }
                  value={fmt(h.n_synthetic)}
                  detail={`profile ${h.calibration_target_profile ?? "unknown"}`}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="rounded-md border border-border">
                  <div className="border-b border-border bg-muted/30 px-3 py-2">
                    <Text size="sm" className="font-medium">
                      Recurring regressing families
                    </Text>
                    <Text size="xs" c="dimmed">
                      Families that often appear among the top regressions.
                    </Text>
                  </div>
                  <DataTable
                    columns={familyColumns}
                    data={topFamilies as unknown as Record<string, unknown>[]}
                  />
                </div>
                <div className="rounded-md border border-border">
                  <div className="border-b border-border bg-muted/30 px-3 py-2">
                    <Text size="sm" className="font-medium">
                      Repeated target flags
                    </Text>
                    <Text size="xs" c="dimmed">
                      Targets recurring in audited regressions.
                    </Text>
                  </div>
                  <DataTable
                    columns={targetCountColumns}
                    data={topTargets as unknown as Record<string, unknown>[]}
                  />
                </div>
              </div>
            </Stack>
          </CardContent>
        </Card>

        <SectionIntro title="Run history">
          Use this to see whether recent Microplex runs are improving and which
          target families dominate failures. Loss delta is candidate minus
          us-data baseline; positive means Microplex is worse on that score.
        </SectionIntro>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Best public runs</CardTitle>
            </CardHeader>
            <CardContent>
              <Text size="xs" c="dimmed" className="mb-2">
                Lowest loss delta across{" "}
                {fmt(data.regression_summary.total_scored_runs)} scored runs (
                {fmt(data.regression_summary.total_audited_runs)} audited).
              </Text>
              <DataTable
                columns={bestWorstColumns}
                data={
                  data.regression_summary.best_runs as unknown as Record<
                    string,
                    unknown
                  >[]
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Worst public runs</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={bestWorstColumns}
                data={
                  data.regression_summary.worst_runs as unknown as Record<
                    string,
                    unknown
                  >[]
                }
              />
            </CardContent>
          </Card>
        </div>

        <SectionIntro title="IRS drilldown">
          The public drilldown is focused on{" "}
          <span className="font-mono">{data.irs_drilldown.family}</span>,
          the family leading {data.irs_drilldown.audits_where_family_leads}{" "}
          audited regressions. Positive weighted delta means Microplex is worse
          than the us-data baseline on that target.
        </SectionIntro>

        <Card>
          <CardHeader>
            <CardTitle>Largest IRS target gaps</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={leadColumns}
              data={
                leadAuditTargets.slice(0, 15) as unknown as Record<
                  string,
                  unknown
                >[]
              }
            />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Filing-status count gaps</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={filingStatusGapColumns}
                data={
                  data.irs_drilldown
                    .lead_filing_status_gap_summary as unknown as Record<
                    string,
                    unknown
                  >[]
                }
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>MFS AGI-bin count gaps</CardTitle>
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

        <Card>
          <CardHeader>
            <CardTitle>us-data baseline and artifact context</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="md">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <MetricTile
                  label={
                    <HelpText title="Composite parity loss is a public Microplex harness score. It combines target error summaries from the parity artifact; lower is better.">
                      Composite parity loss
                    </HelpText>
                  }
                  value={fmt(h.candidate_composite_parity_loss)}
                  detail={`us-data baseline ${fmt(
                    h.baseline_composite_parity_loss,
                  )}`}
                  badge={deltaBadge(h.composite_parity_loss_delta)}
                />
                <MetricTile
                  label={
                    <HelpText title="Mean absolute relative error is the average absolute percent-style error across the public harness target rows. Lower is better.">
                      Mean |relative error|
                    </HelpText>
                  }
                  value={fmt(h.candidate_mean_abs_relative_error)}
                  detail={`us-data baseline ${fmt(
                    h.baseline_mean_abs_relative_error,
                  )}`}
                  badge={deltaBadge(h.mean_abs_relative_error_delta)}
                />
                <MetricTile
                  label={
                    <HelpText title="Slice win rate is the share of evaluation slices where Microplex beats the us-data baseline in the public harness summary.">
                      Slice win rate
                    </HelpText>
                  }
                  value={fmt(h.slice_win_rate, { pct: true })}
                  detail={`artifact ${data.artifact_id ?? "unknown"}`}
                />
              </div>

              {verdictEntries.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {verdictEntries.map(([key, passed]) => (
                    <Badge key={key} variant={passed ? "success" : "secondary"}>
                      {passed ? "pass" : "fail"} {key}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
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
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {data.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}

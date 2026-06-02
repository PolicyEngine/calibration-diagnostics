"use client";

import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Stack,
  Text,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";

import { AppShell } from "@/components/layout/app-shell";
import { useMicroplex } from "@/lib/api/hooks/use-microplex";
import { useSummary } from "@/lib/api/hooks/use-summary";
import { useTargetInventorySummary } from "@/lib/api/hooks/use-target-inventory";
import { useRunContext } from "@/lib/run-context";

function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return formatNumber(value);
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-white p-3">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}

function DeltaBadge({
  value,
  improveIsLower = true,
}: {
  value: number | null | undefined;
  improveIsLower?: boolean;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const improved = improveIsLower ? value < 0 : value > 0;
  const variant: "success" | "error" | "secondary" =
    Math.abs(value) < 1e-9 ? "secondary" : improved ? "success" : "error";
  const sign = value > 0 ? "+" : "";
  return (
    <Badge variant={variant}>
      {sign}
      {num(value)}
    </Badge>
  );
}

export default function ComparisonPage() {
  const { dataset, run } = useRunContext();
  const summary = useSummary();
  const microplex = useMicroplex();
  const inventory = useTargetInventorySummary();
  const microplexTargetRefs = microplex.data
    ? [
        ...microplex.data.regression_summary.target_counts_from_audits.map(
          (target) => ({ ...target, source: "regression audits" }),
        ),
        ...microplex.data.irs_drilldown.lead_target_counts.map((target) => ({
          ...target,
          source: "IRS drilldown",
        })),
      ].slice(0, 12)
    : [];

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Comparison</Title>
          <Text c="dimmed" size="sm">
            Side-by-side orientation for the selected us-data run and the
            public Microplex parity artifact.
          </Text>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>us-data run</CardTitle>
                <Badge variant="secondary">selected dashboard run</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  Dataset <strong>{dataset ?? "not selected"}</strong> · Run{" "}
                  <strong>{run ?? "not selected"}</strong>
                </Text>
                {summary.isLoading && <Skeleton className="h-28 w-full" />}
                {summary.error && (
                  <Text c="red">
                    Failed to load us-data summary: {String(summary.error)}
                  </Text>
                )}
                {summary.data && (
                  <div className="grid grid-cols-2 gap-3">
                    <Kpi
                      label="Included targets"
                      value={num(summary.data.headline.n_targets_included)}
                      hint={`${num(summary.data.headline.n_targets)} total`}
                    />
                    <Kpi
                      label="Estimated targets"
                      value={num(summary.data.headline.n_targets_with_estimate)}
                    />
                    <Kpi
                      label="Median |rel. error|"
                      value={pct(summary.data.headline.median_abs_rel_error, 2)}
                      hint={`p95 ${pct(summary.data.headline.p95_abs_rel_error)}`}
                    />
                    <Kpi
                      label="Targets within 10%"
                      value={pct(summary.data.headline.pct_within_10pct)}
                    />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link
                    className="text-sm text-primary hover:underline"
                    href="/summary"
                  >
                    Open summary
                  </Link>
                  <Link
                    className="text-sm text-primary hover:underline"
                    href="/targets"
                  >
                    Inspect targets
                  </Link>
                  <Link
                    className="text-sm text-primary hover:underline"
                    href="/analysis"
                  >
                    Trace variables
                  </Link>
                </div>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Microplex artifact</CardTitle>
                <Badge variant="secondary">public parity JSON</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                {microplex.isLoading && <Skeleton className="h-28 w-full" />}
                {microplex.error && (
                  <Text c="red">
                    Failed to load Microplex artifact: {String(microplex.error)}
                  </Text>
                )}
                {microplex.data && (
                  <>
                    <Text size="sm" c="dimmed">
                      Artifact{" "}
                      <strong className="font-mono">
                        {microplex.data.artifact_id}
                      </strong>{" "}
                      · profile{" "}
                      <strong>
                        {microplex.data.headline.calibration_target_profile}
                      </strong>
                    </Text>
                    <div className="grid grid-cols-2 gap-3">
                      <Kpi
                        label="Composite parity loss"
                        value={num(
                          microplex.data.headline.candidate_composite_parity_loss,
                        )}
                        hint={`baseline ${num(
                          microplex.data.headline.baseline_composite_parity_loss,
                        )}`}
                      />
                      <Kpi
                        label="Target win rate"
                        value={pct(microplex.data.headline.target_win_rate)}
                      />
                      <Kpi
                        label="Supported target rate"
                        value={pct(microplex.data.headline.supported_target_rate)}
                      />
                      <Kpi
                        label="Scored / audited runs"
                        value={`${num(
                          microplex.data.regression_summary.total_scored_runs,
                        )} / ${num(
                          microplex.data.regression_summary.total_audited_runs,
                        )}`}
                      />
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link
                    className="text-sm text-primary hover:underline"
                    href="/microplex"
                  >
                    Open Microplex overview
                  </Link>
                  <Link
                    className="text-sm text-primary hover:underline"
                    href="/pipeline"
                  >
                    Inspect Microplex pipeline
                  </Link>
                </div>
              </Stack>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Interpretation boundary</CardTitle>
          </CardHeader>
          <CardContent>
            <Text size="sm" c="dimmed">
              The Microplex side currently comes from public aggregate JSON
              artifacts. The us-data side comes from the loaded dashboard run.
              A full apples-to-apples target-by-target comparison needs the
              generated Microplex H5 or full PE-native target diagnostic JSON
              to be published and loaded into this app.
            </Text>
          </CardContent>
        </Card>

        {microplex.data?.repo_structure && (
          <Card>
            <CardHeader>
              <CardTitle>Microplex artifact structure</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  The Microplex repo has a richer generated artifact structure
                  than the committed public JSONs. Newer run bundles record
                  the full target diagnostics manifest artifact{" "}
                  <span className="font-mono">
                    {
                      microplex.data.repo_structure.full_target_diagnostics
                        .manifest_key
                    }
                  </span>
                  , pointing to{" "}
                  <span className="font-mono">
                    {
                      microplex.data.repo_structure.full_target_diagnostics
                        .run_level_path
                    }
                  </span>
                  .
                </Text>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Kpi
                    label="Canonical stages"
                    value={num(
                      microplex.data.repo_structure.canonical_stage_count,
                    )}
                  />
                  <Kpi
                    label="Committed public JSONs"
                    value={num(
                      microplex.data.repo_structure
                        .current_commit_public_artifact_count,
                    )}
                  />
                  <Kpi
                    label="Generated artifacts"
                    value={num(
                      microplex.data.repo_structure.generated_artifacts.length,
                    )}
                    hint="not committed public JSONs"
                  />
                </div>

                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2">Artifact</th>
                        <th className="px-3 py-2">Path hint</th>
                        <th className="px-3 py-2">Producer</th>
                        <th className="px-3 py-2">Public</th>
                      </tr>
                    </thead>
                    <tbody>
                      {microplex.data.repo_structure.generated_artifacts.map(
                        (artifact) => (
                          <tr
                            key={artifact.name}
                            className="border-b border-border/40"
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">
                                {artifact.name}
                              </div>
                              <Text size="xs" c="dimmed">
                                {artifact.description}
                              </Text>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {artifact.path_hint}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {artifact.producer}
                            </td>
                            <td className="px-3 py-2">
                              {artifact.public_committed ? "yes" : "no"}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Target comparison surface</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Yes, this repo has the target definitions. What we do not yet
                have in public form is Microplex&apos;s full per-target estimate
                table, so this section compares target inventory and public
                Microplex target references rather than target-by-target model
                errors.
              </Text>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <Kpi
                  label="Target DB rows"
                  value={num(inventory.data?.db_total)}
                  hint="from policy_data.db inventory"
                />
                <Kpi
                  label="Inventory tiers"
                  value={num(inventory.data?.tiers.length)}
                  hint="csv/python/db/yaml sources"
                />
                <Kpi
                  label="Microplex public refs"
                  value={num(microplexTargetRefs.length)}
                  hint="regression and IRS drilldown targets shown"
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2">Inventory tier</th>
                        <th className="px-3 py-2 text-right">Records</th>
                        <th className="px-3 py-2 text-right">Matched to DB</th>
                        <th className="px-3 py-2 text-right">Match rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.data?.tiers.slice(0, 8).map((tier) => (
                        <tr
                          key={tier.tier}
                          className="border-b border-border/40"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {tier.tier}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {num(tier.total_records)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {num(tier.matched_to_db)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {pct(tier.match_rate)}
                          </td>
                        </tr>
                      ))}
                      {!inventory.data && (
                        <tr>
                          <td
                            className="px-3 py-4 text-sm text-muted-foreground"
                            colSpan={4}
                          >
                            Loading target inventory...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2">Microplex target reference</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2 text-right">Count</th>
                        <th className="px-3 py-2 text-right">Mean Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {microplexTargetRefs.map((target) => (
                        <tr
                          key={`${target.source}-${target.target}`}
                          className="border-b border-border/40"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {target.target}
                          </td>
                          <td className="px-3 py-2">{target.source}</td>
                          <td className="px-3 py-2 text-right">
                            {num(target.count)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {num(target.weightedTermDeltaMean)}
                          </td>
                        </tr>
                      ))}
                      {microplexTargetRefs.length === 0 && (
                        <tr>
                          <td
                            className="px-3 py-4 text-sm text-muted-foreground"
                            colSpan={4}
                          >
                            Loading Microplex target references...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Link
                  className="text-sm text-primary hover:underline"
                  href="/inventory"
                >
                  Open full target inventory
                </Link>
                <Link
                  className="text-sm text-primary hover:underline"
                  href="/targets"
                >
                  Open us-data target estimates
                </Link>
              </div>
            </Stack>
          </CardContent>
        </Card>

        {microplex.data?.native_scores && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Microplex aggregates vs PE targets</CardTitle>
                <Badge
                  variant={
                    microplex.data.native_scores.candidate_beats_baseline
                      ? "success"
                      : "secondary"
                  }
                >
                  {microplex.data.native_scores.candidate_beats_baseline
                    ? "candidate beats baseline"
                    : "baseline lower native loss"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  These are the native PE aggregate-vs-target summary metrics
                  from the public Microplex parity artifact. Lower loss is
                  better. The row-level table is generated in newer run bundles
                  as{" "}
                  <span className="font-mono">
                    {
                      microplex.data.native_scores
                        .full_target_diagnostics_path
                    }
                  </span>
                  , but those generated bundles are not committed publicly.
                </Text>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Kpi
                    label="Candidate native loss"
                    value={num(
                      microplex.data.native_scores
                        .candidate_enhanced_cps_native_loss,
                    )}
                    hint={`baseline ${num(
                      microplex.data.native_scores
                        .baseline_enhanced_cps_native_loss,
                    )}`}
                  />
                  <div className="rounded-md border border-border bg-white p-3">
                    <Text size="xs" c="dimmed">
                      Native loss delta
                    </Text>
                    <div className="mt-2">
                      <DeltaBadge
                        value={
                          microplex.data.native_scores
                            .enhanced_cps_native_loss_delta
                        }
                      />
                    </div>
                    <Text size="xs" c="dimmed">
                      candidate minus baseline
                    </Text>
                  </div>
                  <Kpi
                    label="Targets kept"
                    value={num(microplex.data.native_scores.n_targets_kept)}
                    hint={`${num(
                      microplex.data.native_scores.n_targets_total,
                    )} total`}
                  />
                  <Kpi
                    label="Candidate unweighted MSRE"
                    value={num(
                      microplex.data.native_scores.candidate_unweighted_msre,
                    )}
                    hint={`baseline ${num(
                      microplex.data.native_scores.baseline_unweighted_msre,
                    )}`}
                  />
                  <Kpi
                    label="National targets"
                    value={num(microplex.data.native_scores.n_national_targets)}
                    hint={`period ${num(microplex.data.native_scores.period)}`}
                  />
                  <Kpi
                    label="State targets"
                    value={num(microplex.data.native_scores.n_state_targets)}
                    hint={`${num(
                      microplex.data.native_scores.n_targets_bad_dropped,
                    )} bad, ${num(
                      microplex.data.native_scores.n_targets_zero_dropped,
                    )} zero dropped`}
                  />
                </div>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}

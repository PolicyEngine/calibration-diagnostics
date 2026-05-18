"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Skeleton,
  Alert,
  AlertTitle,
  AlertDescription,
  Stack,
  Group,
  Title,
  Text,
  formatPercent,
  formatNumber,
  MetricCard,
} from "@policyengine/ui-kit";
import { DataTable } from "@/components/shared/InteractiveDataTable";
import { AppShell } from "@/components/layout/app-shell";
import { useTargets } from "@/lib/api/hooks/use-targets";
import { useSummary } from "@/lib/api/hooks/use-summary";
import {
  useErrorDecomposition,
  useConstraintDiff,
  useContributors,
  useTargetConvergence,
  useProvenance,
} from "@/lib/api/hooks/use-target-detail";
import {
  TargetFiltersProvider,
  statusToIncludedOnly,
  useTargetFilters,
} from "@/lib/target-filters-context";
import { TargetChipBar } from "@/components/targets/chip-bar";
import { TargetSearchAndControls } from "@/components/targets/search-and-controls";
import { TargetPagination } from "@/components/targets/pagination";
import { SourceSummary } from "@/components/targets/source-summary";
import { STATE_FIPS_TO_CODE } from "@/lib/geo-names";

/**
 * Map a target's (geo_level, geographic_id) to the output dataset file the
 * pipeline builds for it. e.g. district 0612 → "districts/CA-12.h5".
 */
function datasetForRow(row: {
  geo_level?: string | null;
  geographic_id?: string | null;
}): string {
  const level = row.geo_level ?? "";
  if (level === "national") return "national/US.h5";
  const gid = row.geographic_id ?? "";
  if (!gid) return "—";
  if (level === "state") {
    const n = parseInt(gid, 10);
    const code = Number.isFinite(n) ? STATE_FIPS_TO_CODE[n] : null;
    return `states/${code ?? gid}.h5`;
  }
  if (level === "district") {
    const n = parseInt(gid, 10);
    if (Number.isFinite(n)) {
      const state = STATE_FIPS_TO_CODE[Math.floor(n / 100)] ?? String(Math.floor(n / 100));
      const dist = String(n % 100).padStart(2, "0");
      return `districts/${state}-${dist}.h5`;
    }
    return `districts/${gid}.h5`;
  }
  return level;
}
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

/** Render free-text notes, linkifying URLs. */
function NotesWithLinks({ notes }: { notes: string }) {
  const parts = notes.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline break-all"
          >
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const targetColumns = [
  {
    key: "target_id",
    header: "ID",
    format: (val: unknown) =>
      val != null ? `#${val}` : <span className="text-muted-foreground">—</span>,
  },
  {
    key: "geo_display_name",
    header: "Geography",
    format: (val: unknown) => String(val ?? "National"),
  },
  {
    key: "dataset",
    header: "Dataset",
    format: (_val: unknown, row: Record<string, unknown>) => (
      <span className="font-mono text-xs text-muted-foreground">
        {datasetForRow(row as never)}
      </span>
    ),
  },
  {
    key: "variable",
    header: "Variable",
    format: (val: unknown, row: Record<string, unknown>) => {
      const constraints = (row.constraints as string[] | undefined) ?? [];
      const sub =
        constraints.length === 0
          ? "all population"
          : constraints.join(", ");
      return (
        <div className="flex flex-col gap-0.5">
          <span>{String(val)}</span>
          <span className="text-xs text-muted-foreground">· {sub}</span>
        </div>
      );
    },
  },
  {
    key: "target_value",
    header: "Target",
    align: "right" as const,
    format: (val: unknown) => formatNumber(Number(val)),
  },
  {
    key: "estimate",
    header: "PE aggregate",
    align: "right" as const,
    format: (val: unknown) =>
      val == null
        ? <span className="text-muted-foreground">—</span>
        : formatNumber(Number(val)),
  },
  {
    key: "rel_error",
    header: "Rel. error",
    align: "right" as const,
    format: (val: unknown) => {
      if (val == null) return <span className="text-muted-foreground">—</span>;
      const v = Number(val);
      const abs = Math.abs(v);
      const variant =
        abs > 0.5
          ? "error"
          : abs > 0.2
            ? "warning"
            : abs > 0.05
              ? "secondary"
              : "success";
      const display = abs >= 1 ? `${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(1)}%`;
      return <Badge variant={variant}>{display}</Badge>;
    },
  },
  {
    key: "source",
    header: "Source",
    format: (val: unknown) =>
      val == null || val === "" ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="text-xs">{String(val)}</span>
      ),
  },
  {
    key: "included",
    header: "Status",
    format: (val: unknown) =>
      val ? (
        <Badge variant="success">Used</Badge>
      ) : (
        <Badge variant="secondary">Unused</Badge>
      ),
  },
];

const contributorColumns = [
  {
    key: "household_idx",
    header: "Household",
    format: (val: unknown) => (
      <Link
        href={`/households?selected=${val}`}
        className="text-primary hover:underline"
      >
        #{String(val)}
      </Link>
    ),
  },
  {
    key: "g_weight",
    header: "G-weight",
    align: "right" as const,
    format: (val: unknown) => Number(val).toFixed(1),
  },
  {
    key: "raw_value",
    header: "Value",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
  {
    key: "income",
    header: "Income",
    align: "right" as const,
    format: (val: unknown) => `$${Number(val).toLocaleString()}`,
  },
  {
    key: "in_poverty",
    header: "Poverty",
    align: "center" as const,
    format: (val: unknown) =>
      val ? (
        <Badge variant="error">Yes</Badge>
      ) : (
        <Text size="sm" c="dimmed">
          No
        </Text>
      ),
  },
];

const constraintColumns = [
  {
    key: "constraint",
    header: "Constraint",
    format: (_: unknown, row: Record<string, unknown>) =>
      `${row.variable} ${row.operation} ${row.value}`,
  },
  {
    key: "contributors_satisfying",
    header: "Satisfying",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
  {
    key: "contributors_violating",
    header: "Violating",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
  {
    key: "status",
    header: "Status",
    align: "right" as const,
    format: (val: unknown) => {
      const variant =
        val === "OK"
          ? "success"
          : val === "MINOR_VIOLATION"
            ? "warning"
            : "error";
      return <Badge variant={variant}>{String(val)}</Badge>;
    },
  },
];

function TargetTable() {
  const { filters } = useTargetFilters();
  const searchParams = useSearchParams();
  const selectedIdx = searchParams.get("selected")
    ? Number(searchParams.get("selected"))
    : null;

  const targets = useTargets({
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    search: filters.search,
    variables: filters.variables,
    geoLevels: filters.geoLevels,
    errorBuckets: filters.errorBuckets,
    stateFips:
      filters.stateFipsList.length > 0 ? filters.stateFipsList : undefined,
    sources: filters.sources.length > 0 ? filters.sources : undefined,
    includedOnly: statusToIncludedOnly(filters.status),
    limit: filters.pageSize,
    offset: filters.page * filters.pageSize,
  });

  return (
    <Stack gap="md">
      {targets.data ? (
        <DataTable
          columns={targetColumns}
          sortable
          data={targets.data.items.map((t) => ({
            ...t,
            _selected: t.target_idx === selectedIdx,
          }))}
        />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
      <TargetPagination total={targets.data?.total ?? 0} />
    </Stack>
  );
}

function DetailPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedIdx = searchParams.get("selected")
    ? Number(searchParams.get("selected"))
    : null;

  const errorDecomp = useErrorDecomposition(selectedIdx);
  const constraintDiff = useConstraintDiff(selectedIdx);
  const contributors = useContributors(selectedIdx, { limit: 10 });
  const convergence = useTargetConvergence(selectedIdx);
  const provenance = useProvenance(selectedIdx);

  if (selectedIdx === null) return null;

  return (
    <Card>
      <CardHeader>
        <Group justify="space-between" align="center">
          <CardTitle>Target detail: #{selectedIdx}</CardTitle>
          <button
            type="button"
            onClick={() => {
              const sp = new URLSearchParams(searchParams.toString());
              sp.delete("selected");
              router.replace(`?${sp.toString()}`);
            }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Close ×
          </button>
        </Group>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="convergence">Convergence</TabsTrigger>
            <TabsTrigger value="contributors">Contributors</TabsTrigger>
            <TabsTrigger value="constraints">Constraints</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Stack gap="md">
              {errorDecomp.data && (
                <Stack gap="sm">
                  <Text weight="semibold">Error decomposition</Text>
                  <Group gap="md" wrap="wrap">
                    <MetricCard
                      label="Target"
                      value={errorDecomp.data.target_value}
                      format="number"
                    />
                    <MetricCard
                      label="Raw sum"
                      value={errorDecomp.data.raw_sum}
                      format="number"
                    />
                    <MetricCard
                      label="Initial est."
                      value={errorDecomp.data.initial_estimate}
                      format="number"
                    />
                    <MetricCard
                      label="Final est."
                      value={errorDecomp.data.final_estimate}
                      format="number"
                    />
                  </Group>
                  <Alert>
                    <AlertTitle>Diagnosis</AlertTitle>
                    <AlertDescription>
                      {errorDecomp.data.diagnosis}
                    </AlertDescription>
                  </Alert>
                </Stack>
              )}

              {provenance.data && (
                <Stack gap="sm">
                  <Text weight="semibold">Provenance</Text>
                  <Group gap="sm" wrap="wrap">
                    <Badge variant="outline">
                      Source: {provenance.data.source}
                    </Badge>
                    <Badge variant="outline">
                      Period: {provenance.data.period}
                    </Badge>
                    {provenance.data.tolerance && (
                      <Badge variant="outline">
                        Tolerance: {provenance.data.tolerance}%
                      </Badge>
                    )}
                  </Group>
                  {provenance.data.notes && (
                    <div className="text-xs text-muted-foreground border-l-2 border-border pl-3 py-1">
                      <span className="font-semibold">Notes: </span>
                      <NotesWithLinks notes={provenance.data.notes} />
                    </div>
                  )}
                  <Group gap="xs" wrap="wrap">
                    <Text size="sm" c="dimmed">
                      Constraints:
                    </Text>
                    {provenance.data.constraints.map((c, i) => (
                      <Badge key={i} variant="secondary">
                        {c.variable} {c.operation} {c.value}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              )}
            </Stack>
          </TabsContent>

          <TabsContent value="convergence">
            {convergence.data && convergence.data.length > 0 ? (
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  {convergence.data.length} epoch checkpoints. Final rel_error:{" "}
                  {formatPercent(
                    convergence.data[convergence.data.length - 1].rel_error,
                    1,
                  )}
                </Text>
                <DataTable
                  columns={[
                    { key: "epoch", header: "Epoch" },
                    {
                      key: "estimate",
                      header: "Estimate",
                      align: "right" as const,
                      format: (v: unknown) => Number(v).toExponential(2),
                    },
                    {
                      key: "rel_error",
                      header: "Rel. error",
                      align: "right" as const,
                      format: (v: unknown) => formatPercent(Number(v), 1),
                    },
                  ]}
                  data={convergence.data}
                />
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                No convergence data available
              </Text>
            )}
          </TabsContent>

          <TabsContent value="contributors">
            {contributors.data ? (
              <DataTable columns={contributorColumns} data={contributors.data} />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </TabsContent>

          <TabsContent value="constraints">
            {constraintDiff.data ? (
              <DataTable
                columns={constraintColumns}
                data={constraintDiff.data.constraints}
              />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function CoverageBanner() {
  const summary = useSummary();
  if (!summary.data) return null;
  const h = summary.data.headline;
  const total = h.n_targets;
  const withEst = h.n_targets_with_estimate ?? total;
  if (withEst === total) return null;
  const pct = total > 0 ? (withEst / total) * 100 : 0;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <strong>{withEst.toLocaleString()}</strong> of{" "}
      <strong>{total.toLocaleString()}</strong> targets have a PE aggregate
      computed ({pct.toFixed(1)}%). The remainder need pipeline-level
      evaluation (uprating + entity mapping) that this dashboard doesn't yet
      perform; those rows show <span className="font-mono">—</span> for now.
    </div>
  );
}

function TargetExplorerContent() {
  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>All targets</Title>
          <Text c="dimmed" size="sm">
            Every target known to <code>policy_data.db</code>. Status shows
            whether the active calibration uses it; Dataset shows which output
            bundle the pipeline builds it into.
          </Text>
        </div>

        <CoverageBanner />

        <SourceSummary />

        <div className="flex flex-col gap-3 min-w-0">
          <TargetSearchAndControls />
          <TargetChipBar />
          <TargetTable />
          <DetailPanel />
        </div>
      </Stack>
    </AppShell>
  );
}

export default function TargetExplorerPage() {
  return (
    <Suspense>
      <TargetFiltersProvider>
        <TargetExplorerContent />
      </TargetFiltersProvider>
    </Suspense>
  );
}

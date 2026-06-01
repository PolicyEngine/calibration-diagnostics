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
import { LoadingBlock } from "@/components/shared/LoadingBlock";
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
import { RunSelectorCard } from "@/components/targets/run-selector-card";
import { CompareProvider, useCompareMode } from "@/lib/compare-context";
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

function buildTargetColumns(compareOn: boolean) {
  const base = baseTargetColumns;
  if (!compareOn) return base;
  // Splice compare-only columns immediately after the rel_error column so
  // the user reads A → B → Δ left-to-right next to the existing PE
  // aggregate / Rel. error pair.
  const relIdx = base.findIndex((c) => c.key === "rel_error");
  return [
    ...base.slice(0, relIdx + 1),
    {
      key: "estimate_b",
      header: "PE agg (B)",
      align: "right" as const,
      format: (val: unknown) =>
        val == null
          ? <span className="text-muted-foreground">—</span>
          : formatNumber(Number(val)),
    },
    {
      key: "rel_error_b",
      header: "Rel. error (B)",
      align: "right" as const,
      format: (val: unknown) => {
        if (val == null) return <span className="text-muted-foreground">—</span>;
        const v = Number(val);
        const abs = Math.abs(v);
        const variant =
          abs > 0.5 ? "error" : abs > 0.2 ? "warning" : abs > 0.05 ? "secondary" : "success";
        const display = abs >= 1 ? `${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(1)}%`;
        return <Badge variant={variant}>{display}</Badge>;
      },
    },
    {
      key: "delta",
      header: "Δ |err|",
      align: "right" as const,
      format: (val: unknown) => {
        if (val == null || !Number.isFinite(Number(val))) {
          return <span className="text-muted-foreground">—</span>;
        }
        const v = Number(val);
        // Negative delta = B improved (lower |err|); positive = regressed.
        const variant: "success" | "error" | "secondary" =
          Math.abs(v) < 1e-6 ? "secondary" : v < 0 ? "success" : "error";
        const sign = v > 0 ? "+" : "";
        return <Badge variant={variant}>{sign}{(v * 100).toFixed(1)}pp</Badge>;
      },
    },
    ...base.slice(relIdx + 1),
  ];
}

const baseTargetColumns = [
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
        <Badge variant="success">In loss</Badge>
      ) : (
        <Badge variant="secondary">Not in loss</Badge>
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
  const { filters, setFilters } = useTargetFilters();
  const { enabled: compareOn, runB } = useCompareMode();
  const searchParams = useSearchParams();
  const selectedIdx = searchParams.get("selected")
    ? Number(searchParams.get("selected"))
    : null;

  const compareRun = compareOn ? runB : null;
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
    datasetFiles:
      filters.datasetFiles.length > 0 ? filters.datasetFiles : undefined,
    includedOnly: statusToIncludedOnly(filters.status),
    compareRun,
    limit: filters.pageSize,
    offset: filters.page * filters.pageSize,
  });

  const columns = buildTargetColumns(!!compareRun);

  const bundleEvaluated = targets.data?.bundle_evaluated;

  return (
    <Stack gap="md">
      {bundleEvaluated && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
          <strong>Bundle-fit numbers.</strong> PE aggregates below were
          evaluated against{" "}
          <code className="font-mono text-xs">{bundleEvaluated}</code>{" "}
          — the calibrated h5 the pipeline builds for this bundle — not
          the federal <code className="font-mono text-xs">enhanced_cps_2024.h5</code>.
        </div>
      )}
      {targets.data ? (
        <DataTable
          columns={columns}
          sortable
          sort={{ key: filters.sortBy, direction: filters.sortOrder }}
          onSortChange={(s) => {
            if (s) {
              setFilters({
                sortBy: s.key as typeof filters.sortBy,
                sortOrder: s.direction,
              });
            }
          }}
          data={targets.data.items.map((t) => ({
            ...t,
            _selected: t.target_idx === selectedIdx,
          }))}
        />
      ) : targets.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm">
          Failed to load targets: {String(targets.error)}
        </div>
      ) : (
        <LoadingBlock
          label={
            compareRun
              ? "Loading targets + compare run… (first-time loads can take ~1–2 min)"
              : "Loading targets… (first-time loads can take ~30–90s)"
          }
        />
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

        <RunSelectorCard />

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
        <CompareProvider>
          <TargetExplorerContent />
        </CompareProvider>
      </TargetFiltersProvider>
    </Suspense>
  );
}

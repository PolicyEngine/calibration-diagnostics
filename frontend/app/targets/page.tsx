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
  Input,
  Stack,
  Group,
  Title,
  Text,
  formatPercent,
  MetricCard,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@policyengine/ui-kit";
import { DataTable } from "@/components/shared/InteractiveDataTable";
import { AppShell } from "@/components/layout/app-shell";
import { useTargets } from "@/lib/api/hooks/use-targets";
import {
  useErrorDecomposition,
  useConstraintDiff,
  useContributors,
  useTargetConvergence,
  useProvenance,
} from "@/lib/api/hooks/use-target-detail";
import { useGeo, useGeoParams } from "@/lib/geo-context";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";

const baseTargetColumns = [
  { key: "target_id", header: "ID", format: (val: unknown) => val !== null ? `#${val}` : "" },
  { key: "geo_display_name", header: "Geography", format: (val: unknown) => String(val ?? "National") },
  { key: "variable", header: "Variable" },
  { key: "domain", header: "Domain", format: (val: unknown) => val ? String(val) : "" },
  { key: "additional_constraints", header: "Additional constraints", format: (val: unknown) => val ? String(val) : "" },
  {
    key: "target_value",
    header: "Target value",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
  {
    key: "estimate",
    header: "Estimate",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
  {
    key: "rel_error",
    header: "Rel. error",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      const variant = Math.abs(v) > 0.5 ? "error" : Math.abs(v) > 0.2 ? "warning" : "success";
      return <Badge variant={variant}>{formatPercent(v, 1)}</Badge>;
    },
  },
  {
    key: "loss_contribution",
    header: "Loss contribution",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      if (v >= 0.01) return `${(v * 100).toFixed(1)}%`;
      if (v >= 0.001) return `${(v * 100).toFixed(2)}%`;
      return `${(v * 100).toFixed(3)}%`;
    },
  },
  {
    key: "n_contributors",
    header: "Contributors",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
];

const statusColumn = {
  key: "included",
  header: "Status",
  format: (val: unknown) =>
    val ? <Badge variant="success">Included</Badge> : <Badge variant="secondary">Skipped</Badge>,
};

const contributorColumns = [
  {
    key: "household_idx",
    header: "Household",
    format: (val: unknown) => (
      <Link href={`/households?selected=${val}`} className="text-primary hover:underline">
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
      val ? <Badge variant="error">Yes</Badge> : <Text size="sm" c="dimmed">No</Text>,
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
      const variant = val === "OK" ? "success" : val === "MINOR_VIOLATION" ? "warning" : "error";
      return <Badge variant={variant}>{String(val)}</Badge>;
    },
  },
];

function TargetExplorerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { geo } = useGeo();
  const geoParams = useGeoParams();
  const [showAll, setShowAll] = useState(false);
  const selectedIdx = searchParams.get("selected")
    ? Number(searchParams.get("selected"))
    : null;

  const targets = useTargets({
    sortBy: "abs_rel_error",
    sortOrder: "desc",
    geoLevel: geo.level,
    stateFips: geo.stateFips,
    includedOnly: showAll ? undefined : true,
    limit: 200,
  });

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortOrder("desc");
    }
  };

  const errorDecomp = useErrorDecomposition(selectedIdx);
  const constraintDiff = useConstraintDiff(selectedIdx);
  const contributors = useContributors(selectedIdx, { limit: 10 });
  const convergence = useTargetConvergence(selectedIdx);
  const provenance = useProvenance(selectedIdx);

  return (
    <AppShell>
      <Stack gap="lg">
        <Group gap="md" justify="space-between" align="end">
          <Title order={2}>Target explorer: {geo.label === "National" ? "US" : geo.label}</Title>
          <button
            onClick={() => setShowAll(!showAll)}
            className={`px-3 py-1.5 rounded text-sm border transition-colors ${
              showAll
                ? "bg-yellow-50 border-yellow-300 text-yellow-800"
                : "bg-white border-border text-muted-foreground hover:bg-gray-50"
            }`}
          >
            {showAll ? "Showing all targets (incl. skipped)" : "View skipped targets"}
          </button>
        </Group>

        {/* Target table */}
        <div className="overflow-x-auto -mx-6 px-6">
          <div className="min-w-[800px]">
            {targets.data ? (
              <DataTable
                columns={showAll ? [...baseTargetColumns, statusColumn] : baseTargetColumns}
                sortable
                filterable
                data={targets.data.items.map((t) => ({
                  ...t,
                  _selected: t.target_idx === selectedIdx,
                }))}
              />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </div>
        </div>

        {/* Detail panel */}
        {selectedIdx !== null && (
          <Card>
            <CardHeader>
              <CardTitle>Target detail: #{selectedIdx}</CardTitle>
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
                    {/* Error decomposition */}
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

                    {/* Provenance */}
                    {provenance.data && (
                      <Stack gap="sm">
                        <Text weight="semibold">Provenance</Text>
                        <Group gap="sm" wrap="wrap">
                          <Badge variant="outline">Source: {provenance.data.source}</Badge>
                          <Badge variant="outline">Period: {provenance.data.period}</Badge>
                          {provenance.data.tolerance && (
                            <Badge variant="outline">Tolerance: {provenance.data.tolerance}%</Badge>
                          )}
                        </Group>
                        <Group gap="xs" wrap="wrap">
                          <Text size="sm" c="dimmed">Constraints:</Text>
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
                        {convergence.data.length} epoch checkpoints. Final
                        rel_error:{" "}
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
                    <Text size="sm" c="dimmed">No convergence data available</Text>
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
        )}
      </Stack>
    </AppShell>
  );
}

export default function TargetExplorerPage() {
  return (
    <Suspense>
      <TargetExplorerContent />
    </Suspense>
  );
}

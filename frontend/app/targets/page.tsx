"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataTable,
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
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import { useTargets } from "@/lib/api/hooks/use-targets";
import {
  useErrorDecomposition,
  useConstraintDiff,
  useContributors,
  useTargetConvergence,
  useProvenance,
} from "@/lib/api/hooks/use-target-detail";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

const targetColumns = [
  { key: "target_name", header: "Target" },
  { key: "variable", header: "Variable" },
  { key: "geo_level", header: "Geo" },
  {
    key: "rel_error",
    header: "Rel Error",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      const variant = Math.abs(v) > 0.5 ? "error" : Math.abs(v) > 0.2 ? "warning" : "success";
      return <Badge variant={variant}>{formatPercent(v, 1)}</Badge>;
    },
  },
  {
    key: "pull_score",
    header: "Pull Score",
    align: "right" as const,
    format: (val: unknown) => Number(val).toFixed(3),
  },
  {
    key: "n_contributors",
    header: "Contributors",
    align: "right" as const,
    format: (val: unknown) => Number(val).toLocaleString(),
  },
];

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
    header: "G-Weight",
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
  const selectedIdx = searchParams.get("selected")
    ? Number(searchParams.get("selected"))
    : null;
  const variableFilter = searchParams.get("variable") ?? undefined;

  const targets = useTargets({
    sortBy: "abs_rel_error",
    sortOrder: "desc",
    variable: variableFilter,
    limit: 50,
  });

  const errorDecomp = useErrorDecomposition(selectedIdx);
  const constraintDiff = useConstraintDiff(selectedIdx);
  const contributors = useContributors(selectedIdx, { limit: 10 });
  const convergence = useTargetConvergence(selectedIdx);
  const provenance = useProvenance(selectedIdx);

  const handleRowClick = (row: Record<string, unknown>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("selected", String(row.target_idx));
    router.replace(`?${params.toString()}`);
  };

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Target Explorer</Title>

        {/* Filter bar */}
        <Group gap="md">
          <Input
            placeholder="Filter by variable..."
            defaultValue={variableFilter}
            className="w-64"
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                const val = (e.target as HTMLInputElement).value;
                const params = new URLSearchParams(searchParams.toString());
                if (val) params.set("variable", val);
                else params.delete("variable");
                router.replace(`?${params.toString()}`);
              }
            }}
          />
        </Group>

        {/* Target table */}
        <Card>
          <CardContent>
            {targets.data ? (
              <DataTable
                columns={targetColumns}
                data={targets.data.items.map((t) => ({
                  ...t,
                  _selected: t.target_idx === selectedIdx,
                }))}
              />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </CardContent>
        </Card>

        {/* Detail panel */}
        {selectedIdx !== null && (
          <Card>
            <CardHeader>
              <CardTitle>Target Detail: #{selectedIdx}</CardTitle>
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
                        <Text weight="semibold">Error Decomposition</Text>
                        <Group gap="md" wrap="wrap">
                          <MetricCard
                            label="Target"
                            value={errorDecomp.data.target_value}
                            format="number"
                          />
                          <MetricCard
                            label="Raw Sum"
                            value={errorDecomp.data.raw_sum}
                            format="number"
                          />
                          <MetricCard
                            label="Initial Est"
                            value={errorDecomp.data.initial_estimate}
                            format="number"
                          />
                          <MetricCard
                            label="Final Est"
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
                            header: "Rel Error",
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

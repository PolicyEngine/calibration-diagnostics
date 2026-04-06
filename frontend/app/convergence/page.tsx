"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataTable,
  Badge,
  Input,
  SegmentedControl,
  PELineChart,
  ChartContainer,
  Skeleton,
  Stack,
  Group,
  Title,
  Text,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  useEpochSummary,
  useEpochTraces,
} from "@/lib/api/hooks/use-convergence";
import { useState, useMemo } from "react";

export default function ConvergencePage() {
  const [groupBy, setGroupBy] = useState("variable");
  const [targetIndices, setTargetIndices] = useState("");

  const summary = useEpochSummary(groupBy);
  const traces = useEpochTraces({
    targetIndices: targetIndices || undefined,
  });

  // Transform summary data for line chart: one row per epoch, one column per group
  const { chartData, groups } = useMemo(() => {
    if (!summary.data) return { chartData: [], groups: [] };
    const byEpoch: Record<number, Record<string, number>> = {};
    const groupSet = new Set<string>();
    for (const row of summary.data) {
      groupSet.add(row.group);
      if (!byEpoch[row.epoch]) byEpoch[row.epoch] = { epoch: row.epoch };
      byEpoch[row.epoch][row.group] = row.mean_abs_rel_error;
    }
    return {
      chartData: Object.values(byEpoch).sort(
        (a, b) => (a.epoch as number) - (b.epoch as number),
      ),
      groups: Array.from(groupSet),
    };
  }, [summary.data]);

  const summaryTableData = useMemo(() => {
    if (!summary.data) return [];
    const grouped: Record<
      string,
      { group: string; first: number; last: number; epochs: number }
    > = {};
    for (const row of summary.data) {
      if (!grouped[row.group]) {
        grouped[row.group] = {
          group: row.group,
          first: row.mean_abs_rel_error,
          last: row.mean_abs_rel_error,
          epochs: 0,
        };
      }
      grouped[row.group].last = row.mean_abs_rel_error;
      grouped[row.group].epochs++;
    }
    return Object.values(grouped);
  }, [summary.data]);

  const summaryColumns = [
    { key: "group", header: "Group" },
    { key: "epochs", header: "Checkpoints", align: "right" as const },
    {
      key: "last",
      header: "Final error",
      align: "right" as const,
      format: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%`,
    },
    {
      key: "trend",
      header: "Trend",
      align: "right" as const,
      format: (_: unknown, row: Record<string, unknown>) => {
        const improving = Number(row.last) < Number(row.first);
        return (
          <Badge variant={improving ? "success" : "error"}>
            {improving ? "Improving" : "Diverging"}
          </Badge>
        );
      },
    },
  ];

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Convergence dashboard</Title>

        {/* Summary section */}
        <Stack gap="md">
          <Group gap="md" align="end">
            <Text weight="semibold">Convergence by category</Text>
            <SegmentedControl
              value={groupBy}
              onValueChange={setGroupBy}
              options={[
                { label: "Variable", value: "variable" },
                { label: "Geo level", value: "geo_level" },
                { label: "Domain", value: "domain_variable" },
              ]}
            />
          </Group>

          {chartData.length > 0 ? (
            <ChartContainer title="Mean absolute relative error by epoch">
              <PELineChart
                data={chartData}
                xKey="epoch"
                series={groups.map((g, i) => ({
                  dataKey: g,
                  name: g,
                }))}
                height={300}
                showGrid
                showLegend
                yLabel="Mean |Rel Error|"
                xLabel="Epoch"
              />
            </ChartContainer>
          ) : (
            <Skeleton className="h-80 w-full" />
          )}

          {summaryTableData.length > 0 && (
            <Card>
              <CardContent>
                <DataTable columns={summaryColumns} data={summaryTableData} />
              </CardContent>
            </Card>
          )}
        </Stack>

        {/* Target comparison */}
        <Card>
          <CardHeader>
            <CardTitle>Target comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="md">
              <Stack gap="xs">
                <Text size="sm" c="dimmed">
                  Target indices (comma-separated)
                </Text>
                <Input
                  value={targetIndices}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setTargetIndices(e.target.value)
                  }
                  placeholder="e.g., 0,1,4"
                />
              </Stack>

              {traces.data && traces.data.length > 0 ? (
                <Stack gap="sm">
                  {traces.data.map((trace) => (
                    <Card key={trace.target_name}>
                      <CardContent>
                        <Text weight="medium" size="sm">
                          {trace.target_name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {trace.epochs.length} epochs. Final error:{" "}
                          {(
                            (trace.epochs[trace.epochs.length - 1]?.rel_error ??
                              0) * 100
                          ).toFixed(1)}
                          %
                        </Text>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              ) : !targetIndices ? (
                <Text size="sm" c="dimmed">
                  Enter target indices above to compare convergence traces.
                </Text>
              ) : null}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}

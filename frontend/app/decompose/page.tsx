"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataTable,
  Badge,
  Button,
  Input,
  PEBarChart,
  ChartContainer,
  Alert,
  AlertDescription,
  SelectInput,
  Stack,
  Group,
  Title,
  Text,
  formatNumber,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import { useDecompose } from "@/lib/api/hooks/use-decompose";
import Link from "next/link";
import { useState } from "react";

const componentColumns = [
  {
    key: "variable",
    header: "Component",
    format: (val: unknown) => (
      <Link
        href={`/targets?variable=${val}`}
        className="text-primary hover:underline"
      >
        {String(val)}
      </Link>
    ),
  },
  {
    key: "initial_total",
    header: "Initial total",
    align: "right" as const,
    format: (val: unknown) => `$${formatNumber(Number(val))}`,
  },
  {
    key: "final_total",
    header: "Final total",
    align: "right" as const,
    format: (val: unknown) => `$${formatNumber(Number(val))}`,
  },
  {
    key: "shift_pct",
    header: "Shift %",
    align: "right" as const,
    format: (val: unknown) => {
      const v = Number(val);
      const variant =
        Math.abs(v) > 50 ? "error" : Math.abs(v) > 20 ? "warning" : "success";
      return (
        <Badge variant={variant}>
          {v > 0 ? "+" : ""}
          {v.toFixed(1)}%
        </Badge>
      );
    },
  },
];

export default function DecomposePage() {
  const [variable, setVariable] = useState("");
  const [subgroup, setSubgroup] = useState<string | undefined>(undefined);
  const decompose = useDecompose();

  const handleSubmit = () => {
    if (variable.trim()) {
      decompose.mutate({ variable: variable.trim(), subgroup });
    }
  };

  const chartData =
    decompose.data?.components.map((c) => ({
      variable: c.variable,
      shift_pct: c.shift_pct,
    })) ?? [];

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Variable decomposition</Title>

        {/* Input */}
        <Card>
          <CardContent>
            <Group gap="md" align="end">
              <Stack gap="xs" className="flex-1">
                <Text size="sm" c="dimmed">Variable name</Text>
                <Input
                  value={variable}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setVariable(e.target.value)
                  }
                  placeholder="e.g., spm_unit_net_income"
                  onKeyDown={(e: React.KeyboardEvent) =>
                    e.key === "Enter" && handleSubmit()
                  }
                />
              </Stack>
              <Stack gap="xs">
                <Text size="sm" c="dimmed">Subgroup</Text>
                <SelectInput
                  value={subgroup ?? ""}
                  onChange={(val: string) => setSubgroup(val || undefined)}
                  options={[
                    { label: "All households", value: "" },
                    { label: "Near poverty line", value: "near_poverty" },
                  ]}
                />
              </Stack>
              <Button
                onClick={handleSubmit}
                disabled={decompose.isPending || !variable.trim()}
              >
                {decompose.isPending ? "Computing..." : "Decompose"}
              </Button>
            </Group>
          </CardContent>
        </Card>

        {decompose.isError && (
          <Alert variant="destructive">
            <AlertDescription>{decompose.error.message}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {decompose.data && (
          <Stack gap="md">
            {decompose.data.composite_initial !== null && (
              <Card>
                <CardContent>
                  <Text size="sm" c="dimmed">
                    Composite total: ${formatNumber(decompose.data.composite_initial!)}
                    {" "}(initial) → ${formatNumber(decompose.data.composite_final!)}
                    {" "}(final)
                  </Text>
                </CardContent>
              </Card>
            )}

            <ChartContainer
              title={`Components of ${variable}`}
              subtitle="Sorted by absolute shift %"
            >
              <PEBarChart
                data={chartData}
                xKey="variable"
                yKey="shift_pct"
                height={300}
                colorByValue
                positiveColor="var(--chart-2)"
                negativeColor="var(--chart-5)"
              />
            </ChartContainer>

            <Card>
              <CardContent>
                <DataTable columns={componentColumns} data={decompose.data.components} />
              </CardContent>
            </Card>
          </Stack>
        )}
      </Stack>
    </AppShell>
  );
}

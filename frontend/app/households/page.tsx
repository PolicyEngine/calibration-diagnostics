"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  DataTable,
  Badge,
  Input,
  MetricCard,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  SelectInput,
  Stack,
  Group,
  Title,
  Text,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import {
  useDistortedHouseholds,
  useHouseholdProfile,
  useHouseholdAttributions,
} from "@/lib/api/hooks/use-households";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";

function HouseholdInspectorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedIdx = searchParams.get("selected")
    ? Number(searchParams.get("selected"))
    : null;

  const [minGWeight, setMinGWeight] = useState(
    searchParams.get("min_g") ?? "5",
  );
  const [filterVar, setFilterVar] = useState(
    searchParams.get("var") ?? "",
  );
  const [filterOp, setFilterOp] = useState(
    searchParams.get("op") ?? "gt",
  );
  const [filterVal, setFilterVal] = useState(
    searchParams.get("val") ?? "0",
  );

  const households = useDistortedHouseholds({
    minGWeight: Number(minGWeight) || 5,
    filterVariable: filterVar || undefined,
    filterOperator: filterOp,
    filterValue: Number(filterVal) || 0,
    limit: 50,
  });

  const profile = useHouseholdProfile(selectedIdx);
  const attributions = useHouseholdAttributions(selectedIdx);

  const householdColumns = [
    { key: "household_idx", header: "Household" },
    {
      key: "g_weight",
      header: "G-Weight",
      align: "right" as const,
      format: (v: unknown) => Number(v).toFixed(1),
    },
    {
      key: "income",
      header: "Income",
      align: "right" as const,
      format: (v: unknown) => `$${Number(v).toLocaleString()}`,
    },
    {
      key: "in_poverty",
      header: "Poverty",
      align: "center" as const,
      format: (v: unknown) =>
        v ? <Badge variant="error">Yes</Badge> : <Text size="sm" c="dimmed">No</Text>,
    },
    { key: "state", header: "State", align: "right" as const },
    ...(filterVar
      ? [
          {
            key: "filter_variable_value",
            header: filterVar,
            align: "right" as const,
            format: (v: unknown) =>
              v !== null ? Number(v).toLocaleString() : "-",
          },
        ]
      : []),
  ];

  const attributionColumns = [
    {
      key: "target_name",
      header: "Target",
      format: (val: unknown, row: Record<string, unknown>) => (
        <Link
          href={`/targets?selected=${row.target_idx}`}
          className="text-primary hover:underline text-xs"
        >
          {String(val)}
        </Link>
      ),
    },
    { key: "variable", header: "Variable" },
    {
      key: "weighted_value",
      header: "Contribution",
      align: "right" as const,
      format: (v: unknown) => Number(v).toLocaleString(),
    },
    {
      key: "target_rel_error",
      header: "Target Error",
      align: "right" as const,
      format: (v: unknown) => `${(Number(v) * 100).toFixed(1)}%`,
    },
  ];

  const profileVariableColumns = [
    { key: "variable", header: "Variable" },
    {
      key: "value",
      header: "Value",
      align: "right" as const,
      format: (v: unknown) =>
        typeof v === "number"
          ? v === 0 || v === 1
            ? String(v)
            : v.toLocaleString()
          : String(v),
    },
  ];

  const profileData = profile.data
    ? Object.entries(profile.data.variables).map(([k, v]) => ({
        variable: k,
        value: v,
      }))
    : [];

  return (
    <AppShell>
      <Stack gap="lg">
        <Title order={2}>Household Inspector</Title>

        {/* Filters */}
        <Card>
          <CardContent>
            <Group gap="md" align="end" wrap="wrap">
              <Stack gap="xs">
                <Text size="sm" c="dimmed">Min G-Weight</Text>
                <Input
                  type="number"
                  value={minGWeight}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setMinGWeight(e.target.value)
                  }
                  className="w-24"
                />
              </Stack>
              <Stack gap="xs">
                <Text size="sm" c="dimmed">Filter Variable</Text>
                <Input
                  value={filterVar}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFilterVar(e.target.value)
                  }
                  placeholder="e.g., snap"
                  className="w-48"
                />
              </Stack>
              <Stack gap="xs">
                <Text size="sm" c="dimmed">Operator</Text>
                <SelectInput
                  value={filterOp}
                  onChange={setFilterOp}
                  options={[
                    { label: ">", value: "gt" },
                    { label: ">=", value: "gte" },
                    { label: "<", value: "lt" },
                    { label: "<=", value: "lte" },
                    { label: "=", value: "eq" },
                    { label: "!=", value: "ne" },
                  ]}
                />
              </Stack>
              <Stack gap="xs">
                <Text size="sm" c="dimmed">Value</Text>
                <Input
                  type="number"
                  value={filterVal}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFilterVal(e.target.value)
                  }
                  className="w-24"
                />
              </Stack>
            </Group>
          </CardContent>
        </Card>

        {/* Household table */}
        <Card>
          <CardContent>
            {households.data ? (
              <DataTable columns={householdColumns} data={households.data} />
            ) : (
              <Skeleton className="h-48 w-full" />
            )}
          </CardContent>
        </Card>

        {/* Detail panel */}
        {selectedIdx !== null && (
          <Card>
            <CardHeader>
              <CardTitle>Household #{selectedIdx}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="profile">
                <TabsList>
                  <TabsTrigger value="profile">Profile</TabsTrigger>
                  <TabsTrigger value="attributions">Attributions</TabsTrigger>
                </TabsList>

                <TabsContent value="profile">
                  {profile.data ? (
                    <Stack gap="md">
                      <Group gap="md" wrap="wrap">
                        <MetricCard
                          label="G-Weight"
                          value={profile.data.g_weight}
                          format="number"
                        />
                        <MetricCard
                          label="Final Weight"
                          value={profile.data.final_weight}
                          format="number"
                        />
                        <MetricCard
                          label="State"
                          value={profile.data.state}
                          format="number"
                        />
                        <MetricCard
                          label="In Poverty"
                          value={profile.data.in_poverty ? "Yes" : "No"}
                          format="string"
                        />
                      </Group>
                      <DataTable
                        columns={profileVariableColumns}
                        data={profileData}
                      />
                    </Stack>
                  ) : (
                    <Skeleton className="h-48 w-full" />
                  )}
                </TabsContent>

                <TabsContent value="attributions">
                  {attributions.data ? (
                    <DataTable
                      columns={attributionColumns}
                      data={attributions.data}
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

export default function HouseholdsPage() {
  return (
    <Suspense>
      <HouseholdInspectorContent />
    </Suspense>
  );
}

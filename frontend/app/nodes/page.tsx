"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Stack,
  Text,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { DataTable } from "@/components/shared/InteractiveDataTable";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { useNodes, type NodeVariable } from "@/lib/api/hooks/use-nodes";

type CalFilter = "all" | "calibrated" | "uncalibrated";
type EntityFilter = "all" | string;

const columns = [
  { key: "name", header: "Variable", sortable: true },
  {
    key: "entity",
    header: "Entity",
    sortable: true,
    format: (val: unknown) => (
      <span className="font-mono text-xs">{String(val)}</span>
    ),
  },
  {
    key: "value_type",
    header: "Type",
    sortable: true,
    format: (val: unknown) => (
      <span className="font-mono text-xs">{String(val)}</span>
    ),
  },
  {
    key: "is_calibrated",
    header: "Calibrated?",
    sortable: true,
    format: (val: unknown) =>
      val ? (
        <Badge variant="success">calibrated</Badge>
      ) : (
        <Badge variant="secondary">uncalibrated</Badge>
      ),
  },
  {
    key: "label",
    header: "Label",
    format: (val: unknown) => (
      <span className="text-sm">{String(val)}</span>
    ),
  },
];

function NodesTable() {
  const { data, isLoading, error } = useNodes();
  const [search, setSearch] = useState("");
  const [calFilter, setCalFilter] = useState<CalFilter>("all");
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");

  const entityOptions = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.items.map((r) => r.entity))).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.items.filter((row: NodeVariable) => {
      if (calFilter === "calibrated" && !row.is_calibrated) return false;
      if (calFilter === "uncalibrated" && row.is_calibrated) return false;
      if (entityFilter !== "all" && row.entity !== entityFilter) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.label.toLowerCase().includes(q)
      );
    });
  }, [data, search, calFilter, entityFilter]);

  if (isLoading) return <LoadingBlock label="Loading variable tree…" />;
  if (error)
    return (
      <Text size="sm" c="red">
        Failed to load node variables: {String(error)}
      </Text>
    );
  if (!data) return <LoadingBlock label="Waiting for run selection…" />;

  return (
    <Stack gap="md">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            placeholder="Search by variable name or label…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
            Status
          </span>
          <select
            value={calFilter}
            onChange={(e) => setCalFilter(e.target.value as CalFilter)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">All</option>
            <option value="calibrated">Calibrated</option>
            <option value="uncalibrated">Uncalibrated</option>
          </select>
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
            Entity
          </span>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="all">Any</option>
            {entityOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Text size="xs" c="dimmed">
        Showing {formatNumber(filtered.length)} of{" "}
        {formatNumber(data.total)} leaf variables ·{" "}
        {formatNumber(data.n_calibrated)} calibrated overall (
        {((data.n_calibrated / Math.max(data.total, 1)) * 100).toFixed(1)}%)
      </Text>

      <DataTable
        columns={columns}
        sortable
        data={filtered as never}
      />
    </Stack>
  );
}

export default function NodesPage() {
  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Node variables</Title>
          <Text c="dimmed" size="sm">
            Leaf inputs in the <code>policyengine_us</code> variable tree —
            variables with no formula and no <code>adds</code>/
            <code>subtracts</code>. (Uprating is allowed; it&apos;s just
            CPI/wage projection of a stored value, not derivation.) These
            can&apos;t be computed by the microsim and must come from the
            underlying dataset or from a calibration target. Use this view to
            see which leaves carry a target in the loaded run and which
            don&apos;t.
          </Text>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Leaves</CardTitle>
          </CardHeader>
          <CardContent>
            <NodesTable />
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}

"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Skeleton,
  Stack,
  Title,
  Text,
  Input,
  formatNumber,
} from "@policyengine/ui-kit";
import { AppShell } from "@/components/layout/app-shell";
import { DataTable } from "@/components/shared/InteractiveDataTable";
import {
  useTargetInventory,
  useTargetInventorySummary,
  type InventoryRow,
} from "@/lib/api/hooks/use-target-inventory";
import { useState } from "react";

const TIER_OPTIONS = ["all", "db", "csv", "python", "generator", "yaml"] as const;
type TierOption = (typeof TIER_OPTIONS)[number];

const IN_DB_OPTIONS = ["any", "in-db", "out-of-db"] as const;
type InDbOption = (typeof IN_DB_OPTIONS)[number];

const PAGE_SIZE = 50;

function TierBadge({ tier }: { tier: InventoryRow["storage_tier"] }) {
  const styles: Record<string, string> = {
    db: "bg-slate-200 text-slate-800 border-slate-300",
    csv: "bg-amber-100 text-amber-800 border-amber-300",
    python: "bg-blue-100 text-blue-800 border-blue-300",
    generator: "bg-purple-100 text-purple-800 border-purple-300",
    yaml: "bg-emerald-100 text-emerald-800 border-emerald-300",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono border ${styles[tier] ?? "bg-gray-100"}`}
    >
      {tier}
    </span>
  );
}

function InventoryTable() {
  const [tier, setTier] = useState<TierOption>("all");
  const [inDb, setInDb] = useState<InDbOption>("any");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const inventory = useTargetInventory({
    tier: tier === "all" ? undefined : tier,
    in_db:
      inDb === "in-db" ? true : inDb === "out-of-db" ? false : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const lastPage = inventory.data
    ? Math.max(0, Math.ceil(inventory.data.total / PAGE_SIZE) - 1)
    : 0;

  const columns = [
    {
      key: "storage_tier",
      header: "Tier",
      format: (val: unknown) => <TierBadge tier={val as InventoryRow["storage_tier"]} />,
    },
    {
      key: "in_db",
      header: "In DB?",
      format: (val: unknown) =>
        val ? (
          <Badge variant="success">in DB</Badge>
        ) : (
          <Badge variant="secondary">authored only</Badge>
        ),
    },
    { key: "variable", header: "Variable" },
    {
      key: "period",
      header: "Period",
      align: "right" as const,
      format: (val: unknown) => (val == null ? "—" : String(val)),
    },
    {
      key: "geo_level",
      header: "Geo",
      format: (val: unknown, row: Record<string, unknown>) => {
        const gid = row.geographic_id;
        const lvl = String(val ?? "—");
        return gid ? `${lvl} / ${gid}` : lvl;
      },
    },
    {
      key: "value",
      header: "Value",
      align: "right" as const,
      format: (val: unknown) =>
        val == null ? <span className="text-muted-foreground">—</span> : formatNumber(Number(val)),
    },
    {
      key: "source_path",
      header: "Source",
      format: (val: unknown) => (
        <span className="font-mono text-[10px] text-muted-foreground">
          {String(val).replace("storage/calibration_targets/", "…/")}
        </span>
      ),
    },
    {
      key: "constraints",
      header: "Constraints",
      format: (val: unknown) => {
        const cs = val as [string, string, string][];
        if (!cs || cs.length === 0)
          return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            {cs.map(([v, op, value], i) => (
              <span key={i} className="text-[10px] whitespace-nowrap font-mono">
                {v} {op} {value}
              </span>
            ))}
          </div>
        );
      },
    },
  ];

  const btn =
    "h-8 min-w-8 rounded border border-border bg-background px-2 text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <Stack gap="md">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <Input
            placeholder="Search variable / source / notes…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Tier</span>
          <select
            value={tier}
            onChange={(e) => {
              setTier(e.target.value as TierOption);
              setPage(0);
            }}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">DB</span>
          <select
            value={inDb}
            onChange={(e) => {
              setInDb(e.target.value as InDbOption);
              setPage(0);
            }}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="any">Any</option>
            <option value="in-db">In DB</option>
            <option value="out-of-db">Authored only</option>
          </select>
        </div>
      </div>

      {inventory.data ? (
        <>
          <Text size="xs" c="dimmed">
            {formatNumber(inventory.data.total)} matching records · page{" "}
            {page + 1} of {lastPage + 1}
          </Text>
          <DataTable columns={columns} data={inventory.data.items as never} />
          <div className="flex items-center justify-end gap-1">
            <button className={btn} disabled={page <= 0} onClick={() => setPage(0)}>«</button>
            <button className={btn} disabled={page <= 0} onClick={() => setPage(page - 1)}>‹</button>
            <span className="px-2 text-sm text-muted-foreground">
              {page + 1} / {lastPage + 1}
            </span>
            <button className={btn} disabled={page >= lastPage} onClick={() => setPage(page + 1)}>›</button>
            <button className={btn} disabled={page >= lastPage} onClick={() => setPage(lastPage)}>»</button>
          </div>
        </>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </Stack>
  );
}

function CoverageSummary() {
  const summary = useTargetInventorySummary();
  if (!summary.data) return <Skeleton className="h-32 w-full" />;
  const tot = summary.data.tiers.reduce((s, t) => s + t.total_records, 0);
  const matched = summary.data.tiers.reduce((s, t) => s + t.matched_to_db, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cross-tier audit</CardTitle>
      </CardHeader>
      <CardContent>
        <Stack gap="sm">
          <Text size="sm">
            <span className="font-semibold">{formatNumber(tot)}</span>{" "}
            authored records across {summary.data.tiers.length} non-DB tiers;{" "}
            <span className="font-semibold">{formatNumber(matched)}</span>{" "}
            ({((matched / tot) * 100).toFixed(1)}%) match a target in the
            loaded <code>policy_data.db</code> ({formatNumber(summary.data.db_total)} rows).
          </Text>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground border-b border-border">
                <th className="py-2">Source</th>
                <th className="py-2 text-right">Records</th>
                <th className="py-2 text-right">Matched</th>
                <th className="py-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.tiers.map((t) => {
                const rate = (t.match_rate ?? 0) * 100;
                return (
                  <tr key={t.tier} className="border-b border-border/40">
                    <td className="py-1.5 font-mono text-xs">{t.tier}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatNumber(t.total_records)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatNumber(t.matched_to_db)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {rate.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {summary.data.parsers_missing.length > 0 && (
            <Text size="xs" c="dimmed">
              No parser yet for: {summary.data.parsers_missing.join(", ")}
            </Text>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function TargetInventoryPage() {
  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Target inventory</Title>
          <Text c="dimmed" size="sm">
            Every target authored across all 5 storage tiers in{" "}
            <code>policyengine_us_data</code>: CSV source files, Python
            constants, generators, the YAML config, and the compiled{" "}
            <code>policy_data.db</code>. The <strong>in-DB</strong> badge
            tells you whether each authored row made it into the
            currently-loaded calibration.
          </Text>
        </div>

        <CoverageSummary />

        <Card>
          <CardHeader>
            <CardTitle>Browse records</CardTitle>
          </CardHeader>
          <CardContent>
            <InventoryTable />
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}

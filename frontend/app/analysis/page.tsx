"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  Stack,
  Text,
  Title,
  formatNumber,
} from "@policyengine/ui-kit";

import { AppShell } from "@/components/layout/app-shell";
import {
  useDomainBreakdown,
  useDependencyTrace,
  usePolicyEngineVariables,
  useTargetConfigAudit,
  type DomainBreakdownRow,
  type DependencyNode,
  type PolicyEngineVariable,
} from "@/lib/api/hooks/use-analysis";

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
    <div className="rounded-lg border border-border bg-white p-4">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {hint && (
        <Text size="xs" c="dimmed" className="mt-1">
          {hint}
        </Text>
      )}
    </div>
  );
}

function InlineLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
      <Spinner size="sm" />
      <span>{label}</span>
    </div>
  );
}

function RuleText({ rule }: { rule: Record<string, string> }) {
  return (
    <span className="font-mono text-xs">
      {Object.entries(rule)
        .map(([key, value]) => `${key}=${value}`)
        .join(", ")}
    </span>
  );
}

function TargetConfigAuditPanel({ variable }: { variable: string | null }) {
  const audit = useTargetConfigAudit(variable);
  const zeroRules = useMemo(
    () => audit.data?.rules.filter((r) => r.status === "zero_match") ?? [],
    [audit.data],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Target config audit</CardTitle>
          {variable && <Badge variant="secondary">{variable}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {!variable && (
          <Text size="sm" c="dimmed">
            Select a variable to audit matching target-config rules.
          </Text>
        )}
        {audit.isLoading && (
          <InlineLoading label="Auditing target-config rules for this variable..." />
        )}
        {audit.error && (
          <Text c="red">Failed to load audit: {String(audit.error)}</Text>
        )}
        {audit.data && (
          <Stack gap="md">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Targets" value={num(audit.data.target_count)} />
              <Kpi
                label="Included"
                value={num(audit.data.included_target_count)}
              />
              <Kpi label="Matched" value={num(audit.data.matched_rule_count)} />
              <Kpi label="Zero-match" value={num(audit.data.zero_match_count)} />
            </div>
            {audit.data.rules.length === 0 && (
              <Text size="sm" c="dimmed">
                No target-config rules matched this variable's target or domain
                rows.
              </Text>
            )}
            {zeroRules.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2">Section</th>
                      <th className="py-2">Index</th>
                      <th className="py-2">Rule</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zeroRules.slice(0, 20).map((rule) => (
                      <tr
                        key={`${rule.section}-${rule.index}`}
                        className="border-b border-border/40"
                      >
                        <td className="py-2">{rule.section}</td>
                        <td className="py-2">{rule.index}</td>
                        <td className="py-2">
                          <RuleText rule={rule.rule} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function DomainBreakdownPanel({ variable }: { variable: string | null }) {
  const [domainVariable, setDomainVariable] = useState(
    "adjusted_gross_income",
  );
  const breakdown = useDomainBreakdown(variable, domainVariable);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Domain breakdown</CardTitle>
          {variable && <Badge variant="secondary">{variable}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={domainVariable}
            onChange={(e) => setDomainVariable(e.target.value)}
            placeholder="Domain variable, e.g. adjusted_gross_income"
            className="h-10 min-w-[260px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        {!variable && (
          <Text size="sm" c="dimmed">
            Showing calibration targets grouped by the selected domain variable.
            Select a target variable to narrow the breakdown.
          </Text>
        )}
        {breakdown.isLoading && (
          <InlineLoading label="Loading domain breakdown..." />
        )}
        {breakdown.error && (
          <Text c="red">
            Failed to load domain breakdown: {String(breakdown.error)}
          </Text>
        )}
        {breakdown.data && (
          <Stack gap="md">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi
                label="Domain targets"
                value={num(breakdown.data.summary.target_count)}
              />
              <Kpi
                label="Included"
                value={num(breakdown.data.summary.included_target_count)}
              />
              <Kpi
                label="Evaluated"
                value={num(breakdown.data.summary.evaluated_target_count)}
              />
              <Kpi
                label="Median error"
                value={pct(breakdown.data.summary.median_abs_rel_error)}
              />
            </div>
            {breakdown.data.rows.length === 0 ? (
              <Text size="sm" c="dimmed">
                No targets found for this domain variable and selected output.
              </Text>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2">Domain bucket</th>
                      <th className="py-2 text-right">Targets</th>
                      <th className="py-2 text-right">Included</th>
                      <th className="py-2 text-right">Evaluated</th>
                      <th className="py-2 text-right">Median error</th>
                      <th className="py-2 text-right">Max error</th>
                      <th className="py-2">Geo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.data.rows.map((row: DomainBreakdownRow) => (
                      <tr key={row.bucket} className="border-b border-border/40">
                        <td className="py-2">{row.bucket}</td>
                        <td className="py-2 text-right">
                          {num(row.target_count)}
                        </td>
                        <td className="py-2 text-right">
                          {num(row.included_target_count)}
                        </td>
                        <td className="py-2 text-right">
                          {num(row.evaluated_target_count)}
                        </td>
                        <td className="py-2 text-right">
                          {pct(row.median_abs_rel_error)}
                        </td>
                        <td className="py-2 text-right">
                          {pct(row.max_abs_rel_error)}
                        </td>
                        <td className="py-2">{row.geo_levels.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function nodeStatus(node: DependencyNode): string {
  if (node.is_target_variable) return "target";
  if (node.is_domain_variable) return "domain";
  if (node.is_stored_input) return "stored";
  if (node.is_formula) return "formula";
  if (node.is_aggregate) return "aggregate";
  return "other";
}

function targetRole(node: DependencyNode): string {
  if (node.direct_target_count > 0 && node.domain_target_count > 0) {
    return "direct + domain";
  }
  if (node.direct_target_count > 0) return "direct";
  if (node.domain_target_count > 0) return "domain";
  return "none";
}

function DependencyPanel({
  variable,
  onVariableChange,
}: {
  variable: string | null;
  onVariableChange: (variable: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [nodeScope, setNodeScope] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const variableCatalog = usePolicyEngineVariables(search);
  const trace = useDependencyTrace(variable);
  useEffect(() => {
    setNodeSearch("");
    setNodeScope("all");
    setKindFilter("all");
    setTargetFilter("all");
  }, [variable]);
  const variableOptions = useMemo(() => {
    const items = variableCatalog.data?.items ?? [];
    const scored = [...items].sort((a, b) => {
        const aTarget = a.is_target_variable || a.is_domain_variable ? 0 : 1;
        const bTarget = b.is_target_variable || b.is_domain_variable ? 0 : 1;
        if (aTarget !== bTarget) return aTarget - bTarget;
        return a.name.localeCompare(b.name);
      });
    return scored.slice(0, 80);
  }, [variableCatalog.data]);
  const filteredNodes = useMemo(() => {
    const nodes = trace.data?.nodes ?? [];
    const q = nodeSearch.trim().toLowerCase();
    return nodes.filter((node) => {
      const status = nodeStatus(node);
      if (nodeScope === "inputs" && !node.is_leaf && !node.is_stored_input) {
        return false;
      }
      if (nodeScope === "non_inputs" && (node.is_leaf || node.is_stored_input)) {
        return false;
      }
      if (kindFilter !== "all" && status !== kindFilter) {
        return false;
      }
      if (
        targetFilter === "targeted" &&
        !node.is_target_variable &&
        !node.is_domain_variable
      ) {
        return false;
      }
      if (
        targetFilter === "untargeted" &&
        (node.is_target_variable || node.is_domain_variable)
      ) {
        return false;
      }
      if (q) {
        const haystack = `${node.variable} ${node.label} ${node.entity ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [kindFilter, nodeScope, nodeSearch, targetFilter, trace.data]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Variable explorer</CardTitle>
          {variable && <Badge variant="secondary">{variable}</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any PolicyEngine-US variable, e.g. ca_income_tax"
            className="h-10 min-w-[280px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          {variableCatalog.isLoading && (
            <InlineLoading label="Loading PolicyEngine variables..." />
          )}
          {variableCatalog.error && (
            <Text c="red">
              Failed to load variable catalog: {String(variableCatalog.error)}
            </Text>
          )}
          {variableCatalog.data && (
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              {variableOptions.map((item: PolicyEngineVariable) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onVariableChange(item.name)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-border/40 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40 ${
                    variable === item.name ? "bg-primary/10" : "bg-white"
                  }`}
                >
                  <span>
                    <span className="font-mono text-xs">{item.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {item.label}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {item.is_target_variable && (
                      <Badge variant="secondary">target</Badge>
                    )}
                    {item.is_domain_variable && (
                      <Badge variant="secondary">domain</Badge>
                    )}
                    <Badge variant="outline">{item.entity ?? "?"}</Badge>
                  </span>
                </button>
              ))}
              {variableOptions.length === 0 && (
                <Text size="sm" c="dimmed" className="p-3">
                  No variables match that search.
                </Text>
              )}
            </div>
          )}
        </div>
        {trace.isLoading && (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/20">
            <Spinner size="md" />
            <Text size="sm" c="dimmed">
              Tracing formula dependencies for {variable}...
            </Text>
          </div>
        )}
        {trace.error && (
          <Text c="red">Failed to trace {variable}: {String(trace.error)}</Text>
        )}
        {!variable && !trace.isLoading && (
          <Text size="sm" c="dimmed">
            Search for a variable and select it to inspect calibration targets,
            dependencies, stored inputs, and propagation.
          </Text>
        )}
        {trace.data && (
          <Stack gap="md">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi
                label="Trace nodes"
                value={num(trace.data.summary.total_trace_nodes)}
                hint={`${num(trace.data.summary.returned_nodes)} shown`}
              />
              <Kpi label="Leaf nodes" value={num(trace.data.summary.leaf_nodes)} />
              <Kpi
                label="Stored leaves"
                value={num(trace.data.summary.stored_leaf_nodes)}
              />
              <Kpi
                label="Targeted leaves"
                value={num(trace.data.summary.targeted_leaf_nodes)}
              />
              <Kpi
                label="Untargeted stored leaves"
                value={num(trace.data.summary.untargeted_stored_leaf_nodes)}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <input
                value={nodeSearch}
                onChange={(e) => setNodeSearch(e.target.value)}
                placeholder="Filter traced variables"
                className="h-10 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-sm"
              />
              <select
                value={nodeScope}
                onChange={(e) => setNodeScope(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="all">All dependency nodes</option>
                <option value="inputs">Leaf inputs only</option>
                <option value="non_inputs">Formula chain only</option>
              </select>
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="all">All kinds</option>
                <option value="formula">Formula</option>
                <option value="stored">Stored</option>
                <option value="target">Target</option>
                <option value="domain">Domain</option>
                <option value="aggregate">Aggregate</option>
                <option value="other">Other</option>
              </select>
              <select
                value={targetFilter}
                onChange={(e) => setTargetFilter(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="all">All target status</option>
                <option value="targeted">Targeted/domain</option>
                <option value="untargeted">Untargeted</option>
              </select>
              <Text size="sm" c="dimmed" className="self-center">
                {num(filteredNodes.length)} / {num(trace.data.nodes.length)} nodes
              </Text>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 text-right">Depth</th>
                    <th className="py-2">Variable</th>
                    <th className="py-2">Entity</th>
                    <th className="py-2">Kind</th>
                    <th className="py-2 text-right">Deps</th>
                    <th className="py-2">Target role</th>
                    <th className="py-2 text-right">Targets</th>
                    <th className="py-2 text-right">Evaluated</th>
                    <th className="py-2 text-right">Median error</th>
                    <th className="py-2 text-right">Max error</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNodes.slice(0, 80).map((node) => (
                    <tr key={node.id} className="border-b border-border/40">
                      <td className="py-2 text-right">{num(node.depth)}</td>
                      <td className="py-2 font-mono text-xs">{node.variable}</td>
                      <td className="py-2">{node.entity ?? "—"}</td>
                      <td className="py-2">
                        <Badge variant="secondary">{nodeStatus(node)}</Badge>
                      </td>
                      <td className="py-2 text-right">
                        {num(node.dependency_count)}
                      </td>
                      <td className="py-2">{targetRole(node)}</td>
                      <td className="py-2 text-right">
                        {num(node.included_target_count)} / {num(node.target_count)}
                      </td>
                      <td className="py-2 text-right">
                        {num(node.evaluated_target_count)}
                      </td>
                      <td className="py-2 text-right">
                        {pct(node.median_abs_rel_error)}
                      </td>
                      <td className="py-2 text-right">
                        {pct(node.max_abs_rel_error)}
                      </td>
                    </tr>
                  ))}
                  {filteredNodes.length === 0 && (
                    <tr>
                      <td className="py-4 text-sm text-muted-foreground" colSpan={10}>
                        No traced nodes match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

export default function AnalysisPage() {
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);

  return (
    <AppShell>
      <Stack gap="lg">
        <div>
          <Title order={2}>Analyst readiness</Title>
          <Text c="dimmed" size="sm">
            Reform-specific calibration coverage, propagation, and pipeline
            checks for the selected run.
          </Text>
        </div>

        <DependencyPanel
          variable={selectedVariable}
          onVariableChange={setSelectedVariable}
        />

        <TargetConfigAuditPanel variable={selectedVariable} />

        <DomainBreakdownPanel variable={selectedVariable} />
      </Stack>
    </AppShell>
  );
}

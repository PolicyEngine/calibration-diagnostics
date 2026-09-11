"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, fmtMoney } from "@/components/shared/format";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import {
  useMicrocosmVariableValue,
  useVariableCatalog,
  type CatalogVariable,
  type MicrocosmVariableValue,
} from "@/lib/api/hooks/use-microcosm";
import { HOSTED_US_RELEASE } from "@/lib/microcosm/production-release";

const MAX_SELECTED = 12;

function formatValue(value: number | null | undefined, unit: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "currency-USD") return fmtMoney(value);
  return fmtCompact(value);
}

function variableLookupErrorMessage(error: unknown): string {
  const fallback = "Variable calculation failed on the hosted API. Please retry.";
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  if (
    message.startsWith("<!DOCTYPE html") ||
    message.startsWith("<html") ||
    message.includes("__next_error__")
  ) {
    return "Variable calculation failed on the hosted API before it could return JSON. Please retry.";
  }
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function ResultCard({
  row,
  unit,
}: {
  row: MicrocosmVariableValue;
  unit: string | null | undefined;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-[var(--elev-2)]">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground" title={row.label ?? row.variable}>
          {row.label || row.variable}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {row.variable}
          {row.entity ? ` · ${row.entity}` : ""}
        </div>
      </div>

      <div className="mt-4 text-3xl font-semibold tabular-nums leading-none text-foreground">
        {formatValue(row.weighted_sum, unit)}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        Weighted total on the calibrated dataset
        {row.state_filter !== undefined && (
          <span> · {row.state_filter ? `${row.state_filter} records` : "national records"}</span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border/60 pt-3 text-xs">
        <Stat label="Records" value={fmtCompact(row.record_count)} />
        <Stat label="Nonzero weights" value={fmtCompact(row.nonzero_weight_count)} />
        <Stat label="Weight sum" value={fmtCompact(row.weight_sum)} />
        <Stat
          label="Elapsed"
          value={row.elapsed_seconds == null ? "—" : `${fmt(row.elapsed_seconds, { digits: 1 })}s`}
        />
      </dl>

      {row.documentation ? (
        <details className="group mt-3 text-xs">
          <summary className="cursor-pointer list-none font-medium text-primary [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show documentation</span>
            <span className="hidden group-open:inline">Hide documentation</span>
          </summary>
          <p className="mt-2 leading-relaxed text-muted-foreground">{row.documentation}</p>
        </details>
      ) : null}
    </div>
  );
}

export function MicrocosmVariableLookupView() {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const period = String(HOSTED_US_RELEASE.data_year);
  const release = HOSTED_US_RELEASE.release_id;
  const [search, setSearch] = useState("");

  const { data: catalog = [], isLoading: catalogLoading } = useVariableCatalog();

  const query = useMicrocosmVariableValue({
    variables: submitted,
    period,
    release,
  });

  const byName = useMemo(
    () => new Map(catalog.map((variable) => [variable.name, variable])),
    [catalog],
  );

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as CatalogVariable[];
    const scored: { variable: CatalogVariable; score: number }[] = [];
    for (const variable of catalog) {
      const name = variable.name.toLowerCase();
      const label = (variable.label ?? "").toLowerCase();
      const nameHit = name.includes(q);
      const labelHit = label.includes(q);
      if (!nameHit && !labelHit) continue;
      let score = 10;
      if (name === q || label === q) score = 100;
      else if (name.startsWith(q) || label.startsWith(q)) score = 50;
      scored.push({ variable, score });
    }
    scored.sort((a, b) => b.score - a.score || a.variable.name.localeCompare(b.variable.name));
    return scored.slice(0, 40).map((entry) => entry.variable);
  }, [catalog, search]);

  function toggle(name: string) {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : current.length >= MAX_SELECTED
          ? current
          : [...current, name],
    );
  }

  function run() {
    if (selected.length) setSubmitted(selected);
  }

  const result = query.data;
  const resultRows = result?.variables ?? [];
  const atLimit = selected.length >= MAX_SELECTED;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Microcosm · variable lookup"
        title="Variable lookup"
        description="Check the calibrated dataset's baseline total for any PolicyEngine variable — including measures that aren't calibration targets."
      />

      <SectionCard
        title="Find variables"
        description={
          catalogLoading
            ? "Loading the PolicyEngine variable catalog…"
            : `Search ${fmt(catalog.length, { digits: 0 })} PolicyEngine variables and add up to ${MAX_SELECTED}.`
        }
      >
        <div className="flex flex-col gap-3">
          <input
            type="search"
            value={search}
            placeholder="Search by name or description — e.g. EITC, SNAP, income tax"
            onChange={(event) => setSearch(event.target.value)}
            spellCheck={false}
            className="h-10 w-full rounded-lg border border-border bg-card px-3.5 text-sm focus:border-primary/60 focus:outline-none"
          />

          {search.trim() === "" ? (
            <p className="px-1 text-xs text-muted-foreground">
              Start typing to search across every PolicyEngine-US variable.
            </p>
          ) : matches.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">
              No variables match “{search.trim()}”.
            </p>
          ) : (
            <div className="max-h-80 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
              {matches.map((variable) => {
                const isSelected = selected.includes(variable.name);
                const disabled = !isSelected && atLimit;
                return (
                  <button
                    key={variable.name}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(variable.name)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSelected ? "bg-primary/10" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {variable.label || variable.name}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {variable.name}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {variable.entity ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {variable.entity}
                        </span>
                      ) : null}
                      <span
                        className={`text-base leading-none ${
                          isSelected ? "text-primary" : "text-muted-foreground"
                        }`}
                        aria-hidden
                      >
                        {isSelected ? "✓" : "+"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={`Selected variables (${selected.length}/${MAX_SELECTED})`}
        description="Run the weighted calculation using the pinned production release and its supported period."
      >
        <div className="flex flex-col gap-4">
          {selected.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Search above and add variables to look up their values.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((name) => {
                const meta = byName.get(name);
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1.5 text-sm"
                    title={name}
                  >
                    <span className="max-w-[16rem] truncate text-foreground">
                      {meta?.label || name}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggle(name)}
                      aria-label={`Remove ${name}`}
                      className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Period
              <span className="py-2 text-foreground">{period}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
              Production release (pinned)
              <span className="break-all font-mono text-foreground">{release}</span>
            </div>
            <button
              type="button"
              onClick={run}
              disabled={selected.length === 0 || query.isFetching}
              className="ml-auto h-9 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {query.isFetching ? "Running…" : `Run ${selected.length || ""}`.trim()}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Calculations use the reviewed production input. Historical releases remain
            available in calibration browsing and comparisons.
          </p>
        </div>
      </SectionCard>

      {query.isFetching ? (
        <LoadingBlock label="Running PolicyEngine calculation…" />
      ) : query.error ? (
        <EmptyState
          title="Variable calculation unavailable"
          description={variableLookupErrorMessage(query.error)}
        />
      ) : result && resultRows.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {result.release_id} · {result.period}
            </span>
            <span>
              {result.elapsed_seconds == null
                ? ""
                : `${fmt(result.elapsed_seconds, { digits: 1 })}s total`}
            </span>
          </div>
          {result.runtime && (
            <div className="break-all rounded-md border border-border p-3 text-xs text-muted-foreground">
              <p>Runtime: {Object.entries(result.runtime.packages)
                .filter(([, version]) => version != null)
                .map(([name, version]) => `${name} ${version}`).join(" · ")}</p>
              {result.data_identity && (
                <>
                  <p>Data {result.data_identity.verified ? "verified" : "not verified"}: {result.data_identity.release_id}</p>
                  <p>HF revision: {result.data_identity.hf_revision}</p>
                  <p>H5 SHA-256: {result.data_identity.sha256}</p>
                </>
              )}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {resultRows.map((row) => (
              <ResultCard key={row.variable} row={row} unit={byName.get(row.variable)?.unit} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

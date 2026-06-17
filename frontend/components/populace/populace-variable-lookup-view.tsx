"use client";

import { FormEvent, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, releaseLabel } from "@/components/shared/format";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import {
  usePopulaceReleases,
  usePopulaceVariableValue,
  type PopulaceVariableValue,
} from "@/lib/api/hooks/use-populace";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}

function variableTokens(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
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

function ResultsTable({ rows }: { rows: PopulaceVariableValue[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Variable</th>
            <th className="px-3 py-2 font-semibold">Label</th>
            <th className="px-3 py-2 font-semibold">Entity</th>
            <th className="px-3 py-2 text-right font-semibold">Weighted aggregate</th>
            <th className="px-3 py-2 text-right font-semibold">Records</th>
            <th className="px-3 py-2 text-right font-semibold">Elapsed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.variable} className="border-b border-border/60 last:border-b-0">
              <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">
                {row.variable}
              </td>
              <td className="max-w-sm truncate px-3 py-2" title={row.label ?? undefined}>
                {row.label || "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                {row.entity}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmt(row.weighted_sum, { digits: 2 })}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtCompact(row.record_count)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {row.elapsed_seconds == null ? "—" : `${fmt(row.elapsed_seconds, { digits: 1 })}s`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CURRENT_YEAR = new Date().getFullYear();
const PERIOD_OPTIONS = Array.from(
  { length: CURRENT_YEAR + 5 - 2020 + 1 },
  (_, index) => String(2020 + index),
);

export function PopulaceVariableLookupView() {
  const [draftVariable, setDraftVariable] = useState("");
  const [variables, setVariables] = useState(["nh_income_tax"]);
  const [period, setPeriod] = useState("2024");
  const [release, setRelease] = useState("");
  const [submittedVariables, setSubmittedVariables] = useState<string[]>([]);

  const { data: releaseData } = usePopulaceReleases();
  const releaseOptions = useMemo(
    () => [
      { value: "", label: "Latest" },
      ...(releaseData?.releases ?? []).map((r) => ({
        value: r.release_id,
        label: releaseLabel(r.release_id, r.date),
      })),
    ],
    [releaseData],
  );

  const query = usePopulaceVariableValue({
    variables: submittedVariables,
    period,
    release: release || undefined,
  });

  function addDraftVariables() {
    const additions = variableTokens(draftVariable);
    if (!additions.length) return variables;
    const next = [...new Set([...variables, ...additions])];
    setVariables(next);
    setDraftVariable("");
    return next;
  }

  function removeVariable(variable: string) {
    setVariables((current) => current.filter((item) => item !== variable));
  }

  function handleVariableKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    addDraftVariables();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = [...new Set([...variables, ...variableTokens(draftVariable)])];
    setVariables(next);
    setDraftVariable("");
    setSubmittedVariables(next);
  }

  const result = query.data;
  const resultRows = result?.variables ?? [];
  const canRun = variables.length > 0 || variableTokens(draftVariable).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="Variable lookup"
        description="Select PolicyEngine-US variables and calculate their weighted aggregates on the selected Populace release."
        status={
          result ? (
            <StatusPill tone="info">
              {result.release_id} · {resultRows.length} variables
            </StatusPill>
          ) : undefined
        }
      />

      <SectionCard title="Lookup" description="The value is computed through PolicyEngine using Populace's calibrated weights.">
        <form
          onSubmit={submit}
          className="grid items-end gap-3 md:grid-cols-[minmax(280px,1fr)_120px_minmax(220px,280px)_96px]"
        >
          <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Variables
            <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 focus-within:border-primary/60">
              {variables.map((variable) => (
                <span
                  key={variable}
                  className="inline-flex h-6 items-center gap-1 rounded bg-muted px-2 font-mono text-[11px] text-foreground"
                >
                  {variable}
                  <button
                    type="button"
                    onClick={() => removeVariable(variable)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${variable}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={draftVariable}
                onChange={(event) => setDraftVariable(event.target.value)}
                onKeyDown={handleVariableKeyDown}
                placeholder={variables.length ? "Add variable..." : "nh_income_tax, az_income_tax"}
                spellCheck={false}
                className="h-6 min-w-[150px] flex-1 border-0 bg-transparent px-1 font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Period
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              className="h-9 rounded-md border border-border bg-white px-3 text-sm text-foreground focus:border-primary/60 focus:outline-none"
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Release
            <select
              value={release}
              onChange={(event) => setRelease(event.target.value)}
              className="h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground focus:border-primary/60 focus:outline-none"
            >
              {releaseOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!canRun || query.isFetching}
            className="h-9 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {query.isFetching ? "Running..." : "Run"}
          </button>
        </form>
      </SectionCard>

      {query.isFetching ? (
        <LoadingBlock label="Running PolicyEngine calculation..." />
      ) : query.error ? (
        <EmptyState
          title="Variable calculation unavailable"
          description={variableLookupErrorMessage(query.error)}
        />
      ) : result ? (
        <SectionCard
          title="Results"
          description={`${resultRows.length} variables · ${result.elapsed_seconds == null ? "elapsed time unavailable" : `${fmt(result.elapsed_seconds, { digits: 1 })}s total`}`}
          padded={false}
        >
          <ResultsTable rows={resultRows} />
          {resultRows.length === 1 ? (
            <div className="border-t border-border p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-3 rounded-md border border-border bg-muted/30 p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Weighted aggregate
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
                {fmt(result.weighted_sum, { digits: 2 })}
              </div>
            </div>
            <Field label="Entity" value={result.entity} />
            <Field label="Definition period" value={result.definition_period} />
            <Field label="Records" value={fmtCompact(result.record_count)} />
            <Field label="Weight sum" value={fmt(result.weight_sum, { digits: 2 })} />
            <Field label="Nonzero weights" value={fmtCompact(result.nonzero_weight_count)} />
            <Field
              label="Elapsed"
              value={result.elapsed_seconds == null ? "—" : `${fmt(result.elapsed_seconds, { digits: 1 })}s`}
            />
          </div>
          {result.documentation ? (
            <p className="mt-5 max-w-3xl text-sm leading-6 text-muted-foreground">
              {result.documentation}
            </p>
          ) : null}
            </div>
          ) : null}
        </SectionCard>
      ) : (
        <EmptyState
          title="Run variables to see weighted values."
          description="Examples: nh_income_tax, az_income_tax."
          variant="compact"
        />
      )}
    </div>
  );
}

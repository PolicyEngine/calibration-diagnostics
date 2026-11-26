"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import type { BuildFacts, StepFacts } from "@/lib/microcosm/release-history-builds";
import {
  dateLong,
  dateTimeUtc,
  formatChange,
  formatPercent,
  formatPoints,
  formatValue,
  shortHash,
  versusOfficial,
} from "@/lib/microcosm/release-history-format";
import type { StepMove, StepSummary } from "@/lib/microcosm/release-history-moved";
import type { OutputEntry } from "@/lib/microcosm/release-history-outputs";

// The step card of the release history page (calibration-diagnostics#224): what the two builds
// of a step declare, side by side, and what the selected output did across it. Every fact comes
// from the timeline: listing facts, and what each build's point was fetched with.

const NONE = "—";

function Changed({ changed }: { changed: boolean | null }) {
  if (changed === null) return null;
  return (
    <span className={`ml-2 rounded-full border px-1.5 py-px text-[10.5px] font-medium ${changed ? "pill-info" : "pill-neutral"}`}>
      {changed ? "Changed" : "Unchanged"}
    </span>
  );
}

function Commit({ facts }: { facts: BuildFacts }) {
  if (!facts.codeCommit) return <>{NONE}</>;
  const short = shortHash(facts.codeCommit);
  return facts.commitUrl ? (
    <a href={facts.commitUrl} target="_blank" rel="noopener noreferrer" className="font-mono underline underline-offset-2 hover:text-primary">
      {short}
    </a>
  ) : (
    <span className="font-mono">{short}</span>
  );
}

function compatibility(facts: BuildFacts): string {
  const range = facts.compatibleModels ? ` (${facts.compatibleModels})` : "";
  switch (facts.build.referenceModelCompatibility) {
    case "inside":
      return `Inside the range it declares${range}`;
    case "outside":
      return `Outside the range it declares${range}`;
    case "undeclared":
      return "It declares no range for this model";
    case "unreadable":
      return "Its declared range could not be read";
    default:
      return NONE;
  }
}

function columns(facts: BuildFacts): string {
  const names = facts.build.unknownColumns;
  if (names === null || names === undefined) return NONE;
  return names.length === 0 ? "None" : `${names.length}: ${names.join(", ")}`;
}

/** Each fact of the step: a label, and one cell per build. */
function factRows(step: StepFacts): { label: string; cell: (facts: BuildFacts) => ReactNode; changed?: boolean | null }[] {
  return [
    { label: "Published", cell: (facts) => dateTimeUtc(facts.build.publishedAt) },
    { label: "Built", cell: (facts) => dateTimeUtc(facts.builtAt) },
    { label: "Microcosm commit", cell: (facts) => <Commit facts={facts} /> },
    { label: "Built with model", cell: (facts) => facts.builtWithModel ?? NONE, changed: step.buildEngineChanged },
    { label: "Built with core", cell: (facts) => facts.builtWithCore ?? NONE },
    {
      label: "Targets",
      cell: (facts) => (facts.nTargets === null ? NONE : facts.nTargets.toLocaleString("en-GB")),
      changed: step.targetSetChanged,
    },
    { label: "Target registry", cell: (facts) => facts.targetRegistryVersion ?? NONE, changed: step.targetRegistryChanged },
    { label: "Household weight year", cell: (facts) => facts.householdWeightYear ?? NONE },
    {
      label: "Data file",
      cell: (facts) => (
        <>
          <span className="font-mono">{shortHash(facts.build.digest)}</span>
          {facts.build.sameFileAs && <span className="text-muted-foreground"> · the file of an earlier build</span>}
        </>
      ),
    },
    { label: "Reference model", cell: compatibility },
    { label: "Columns the model does not define", cell: columns },
  ];
}

function FactsTable({ step, names }: { step: StepFacts; names: ReadonlyMap<string, string> }) {
  const builds = step.from ? [step.from, step.to] : [step.to];
  const heading = (facts: BuildFacts) => (
    <th key={facts.build.buildId} scope="col" className="px-3 py-2 text-left align-bottom font-normal">
      <span className="block text-xs font-medium text-foreground">{dateLong(facts.build.publishedAt)}</span>
      <span className="block break-all font-mono text-[11px] text-muted-foreground" title={facts.build.buildId}>
        {names.get(facts.build.buildId) ?? facts.build.build}
      </span>
    </th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border-dark">
            <th scope="col" className="w-44 px-3 py-2 text-left font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {step.from ? "The two builds" : "The build"}
            </th>
            {builds.map(heading)}
          </tr>
        </thead>
        <tbody>
          {factRows(step).map((row) => (
            <tr key={row.label} className="border-b border-border">
              <th scope="row" className="px-3 py-1.5 text-left align-top font-normal text-muted-foreground">
                {row.label}
                {step.from && <Changed changed={row.changed ?? null} />}
              </th>
              {builds.map((facts) => (
                <td key={facts.build.buildId} className="px-3 py-1.5 align-top">
                  {facts.declared || ["Published", "Data file"].includes(row.label) ? row.cell(facts) : NONE}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One line on how a move sits beside the output's own history and its official figure. */
export function moveLine(move: StepMove): string {
  const size = !Number.isFinite(move.signed)
    ? "moved away from zero"
    : move.measure === "points" ? formatPoints(move.signed) : formatPercent(move.signed);
  const typical = move.typical === null
    ? "fewer than three earlier steps"
    : move.ratio === Number.POSITIVE_INFINITY
      ? "it had not moved before"
      : `${(move.ratio ?? 0).toFixed(1)}× its typical step`;
  const official = move.official === null || move.official.direction === "same"
    ? ""
    : `, ${move.official.direction === "nearer" ? "nearer to" : "further from"} the official figure`;
  return `${size} · ${typical}${official}`;
}

function OutputAcrossStep({
  entry,
  index,
  currency,
}: {
  entry: OutputEntry;
  index: number;
  currency: string | null;
}) {
  const value = entry.values[index];
  const text = (shown: OutputEntry["values"][number]) =>
    shown.status === "withheld" ? "Withheld" : shown.value === null ? "No value" : formatValue(shown.value, entry.unit, currency, 2);
  const versus = (shown: OutputEntry["values"][number]) =>
    entry.official !== null && shown.value !== null
      ? ` (${formatPercent(versusOfficial(shown.value, entry.official))} against the official figure)`
      : "";
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
      <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{entry.fullLabel}</div>
      <div className="mt-0.5">
        <span className="font-semibold tabular-nums">{text(value)}</span>
        <span className="text-muted-foreground">{versus(value)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        Step from the build before: {formatChange(value, entry.unit, currency)}
      </div>
    </div>
  );
}

export function ReleaseHistoryStepCard({
  step,
  summary,
  entry,
  index,
  currency,
  country,
  names,
  onSelectOutput,
  onClose,
}: {
  step: StepFacts;
  /** What every output of the selected period did at this build. */
  summary: StepSummary;
  entry: OutputEntry | null;
  index: number;
  currency: string | null;
  country: string;
  names: ReadonlyMap<string, string>;
  onSelectOutput: (id: string) => void;
  onClose: () => void;
}) {
  const name = (facts: BuildFacts) => names.get(facts.build.buildId) ?? facts.build.build;
  const fit = (facts: BuildFacts) => ({
    pathname: "/microcosm",
    query: { country, release: facts.build.buildId },
  });
  const title = step.from && !step.noStepReason
    ? `Step from ${dateLong(step.from.build.publishedAt)} to ${dateLong(step.to.build.publishedAt)}`
    : `Build of ${dateLong(step.to.build.publishedAt)}`;
  const undeclared = !step.to.declared && step.to.build.state === "measured";
  return (
    <section aria-label={title} className="grid gap-3 rounded-lg border border-border-dark bg-card p-4 shadow-[var(--elev-1)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="break-all font-mono text-[11px] text-muted-foreground">{name(step.to)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          Close
        </button>
      </div>
      {step.noStepReason && <p className="text-sm text-muted-foreground">{step.noStepReason}</p>}
      {entry && <OutputAcrossStep entry={entry} index={index} currency={currency} />}
      {undeclared && (
        <p className="text-xs text-muted-foreground">
          This timeline was written before it carried what each build declares. The facts appear after the next run.
        </p>
      )}
      <FactsTable step={step} names={names} />
      {step.from && (step.columnsAdded.length > 0 || step.columnsRemoved.length > 0) && (
        <p className="text-xs text-muted-foreground">
          Columns the reference model does not define:
          {step.columnsAdded.length > 0 && ` added ${step.columnsAdded.join(", ")}`}
          {step.columnsAdded.length > 0 && step.columnsRemoved.length > 0 && ";"}
          {step.columnsRemoved.length > 0 && ` removed ${step.columnsRemoved.join(", ")}`}.
        </p>
      )}
      {!step.noStepReason && (
        <div className="grid gap-1.5">
          <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Every output at this step</div>
          <p className="text-xs text-muted-foreground">
            {summary.moved.length} moved, {summary.unchanged} did not move, {summary.withheld} withheld
            {summary.noStep > 0 ? `, ${summary.noStep} with no step` : ""}.
            {summary.sameFile && " This build publishes the file of an earlier build, so no output can have moved."}
          </p>
          {summary.moved.length > 0 && (
            <ol className="grid gap-0.5">
              {summary.moved.slice(0, 5).map((move) => (
                <li key={move.entry.key}>
                  <button
                    type="button"
                    onClick={() => onSelectOutput(move.entry.id)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-x-3 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    <span className="font-medium text-foreground">{move.entry.fullLabel}</span>
                    <span className="tabular-nums text-muted-foreground">{moveLine(move)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2 text-xs">
        {step.compareUrl && (
          <a href={step.compareUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-primary">
            Compare the two Microcosm commits on GitHub
          </a>
        )}
        {(step.from ? [step.from, step.to] : [step.to]).map((facts) => (
          <Link key={facts.build.buildId} href={fit(facts)} className="underline underline-offset-2 hover:text-primary">
            Calibration fit of {name(facts)}
          </Link>
        ))}
      </div>
    </section>
  );
}

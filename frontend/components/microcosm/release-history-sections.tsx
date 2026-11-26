"use client";

import type { ReactNode } from "react";

import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import {
  BUILD_MARK_LABELS,
  buildStateLabel,
  withoutRunCount,
  type BuildMark,
  type BuildsWithoutRun,
} from "@/lib/microcosm/release-history-builds";
import {
  dateLong,
  dateShort,
  engineLabel,
  periodLabel,
  shortHash,
} from "@/lib/microcosm/release-history-format";
import type { StepSummary } from "@/lib/microcosm/release-history-moved";
import { disclosureLine, namedBuilds, type EngineNotice } from "@/lib/microcosm/release-history-page";
import type { TimelineBuild } from "@/lib/microcosm/release-history-store";
import type { ReleaseHistoryPanelView } from "@/lib/microcosm/release-history-summary";
import type { MovedScope } from "@/lib/microcosm/release-history-url";

import { moveLine } from "./release-history-step-card";

// The blocks of the release history page above its outputs (calibration-diagnostics#224): the
// notices about the engine on screen, the series facts, what moved at the latest build, and the
// builds of the series. Each takes what lib/microcosm computed and writes it in neutral words.

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="note" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-snug text-muted-foreground">
      {children}
    </div>
  );
}

function PanelLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-primary underline underline-offset-2 hover:text-[var(--accent-strong)]">
      {children}
    </button>
  );
}

/** What the page says about the engine on screen, with a link to the other panel it names. */
export function EngineNotices({
  notices,
  onSelectPanel,
}: {
  notices: readonly EngineNotice[];
  onSelectPanel: (panelId: string) => void;
}) {
  return (
    <>
      {notices.map((notice) => {
        if (notice.kind === "newer_engine_filling") {
          return (
            <Notice key={notice.kind}>
              <strong className="text-foreground">A newer engine is being measured.</strong>{" "}
              {notice.engine}
              {notice.pinnedAt ? ` was pinned on ${dateLong(notice.pinnedAt)} and` : ""} holds {notice.coverage} so far.
              This page opens it once it is complete.{" "}
              <PanelLink onClick={() => onSelectPanel(notice.panelId)}>View {notice.engine}</PanelLink>
            </Notice>
          );
        }
        if (notice.kind === "viewing_filling_engine") {
          return (
            <Notice key={notice.kind}>
              <strong className="text-foreground">This engine's panel is filling.</strong>{" "}
              {notice.engine} holds {notice.coverage}. Until it is complete this page opens {notice.defaultEngine}.{" "}
              <PanelLink onClick={() => onSelectPanel(notice.defaultPanelId)}>View {notice.defaultEngine}</PanelLink>
            </Notice>
          );
        }
        if (notice.kind === "viewing_other_engine") {
          return (
            <Notice key={notice.kind}>
              <strong className="text-foreground">{notice.engine} was measured on request.</strong>{" "}
              New builds are measured automatically on the pinned engine only.{" "}
              <PanelLink onClick={() => onSelectPanel(notice.defaultPanelId)}>View {notice.defaultEngine}</PanelLink>
            </Notice>
          );
        }
        return (
          <Notice key={notice.kind}>
            <strong className="text-foreground">Another definition.</strong>{" "}
            This panel was measured under another spec or producer version than the default one, so its outputs
            and their values are not like for like with it.
          </Notice>
        );
      })}
    </>
  );
}

/** The builds this engine has no value for, named by why (María, 26 November 2026). */
export function BuildsWithoutRunNotice({
  without,
  names,
}: {
  without: BuildsWithoutRun;
  names: ReadonlyMap<string, string>;
}) {
  const count = withoutRunCount(without);
  if (count === 0) return null;
  const groups: [string, TimelineBuild[]][] = [
    ["Never run on this engine", without.neverRun],
    ["A run failed and will be tried again", without.retrying],
    ["Out of attempts", without.failed],
    ["The file was refused", without.refused],
  ];
  return (
    <Notice>
      <strong className="text-foreground">
        {count} of {without.onAxis} builds {count === 1 ? "has" : "have"} no value on this engine.
      </strong>{" "}
      {count === 1 ? "It keeps its" : "They keep their"} column on the chart, shaded.
      <ul className="mt-1.5 grid gap-0.5">
        {groups.filter(([, builds]) => builds.length > 0).map(([label, builds]) => (
          <li key={label}>
            {label}: <span className="font-mono text-[12px]">{namedBuilds(builds, names)}</span>
          </li>
        ))}
      </ul>
      {without.neverRun.length > 0 && (
        <p className="mt-1.5">
          New builds are measured automatically on the pinned engine only. A run on another engine is started by hand.
        </p>
      )}
    </Notice>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 flex-[1_1_190px] content-start gap-0.5">
      <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">{term}</dt>
      <dd className="m-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/** The series facts: the engine, the panel, the series rule, coverage and the disclosure policy. */
export function SeriesFacts({ view }: { view: ReleaseHistoryPanelView }) {
  const { panel, presentation, timeline } = view;
  const { rule } = timeline.listing;
  const measured = timeline.builds.filter((build) => build.state === "measured");
  const outside = measured.filter((build) => build.referenceModelCompatibility === "outside").length;
  const periods = presentation.periods.map((period) => periodLabel(period, presentation.periodLabel)).join(", ");
  return (
    <dl className="m-0 flex flex-wrap gap-x-7 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--elev-1)]">
      <Fact term="Reference engine">
        {engineLabel(panel.engine.model)}
        <span className="text-muted-foreground">
          {panel.engine.policyengine ? ` · policyengine ${panel.engine.policyengine}` : ""}
          {panel.engine.core ? ` · ${engineLabel(panel.engine.core)}` : ""}
        </span>
      </Fact>
      <Fact term="Panel">
        <span className="font-mono">{shortHash(panel.panelId, 12)}</span>
        <span className="text-muted-foreground">
          {panel.pinnedAt ? ` · pinned ${dateLong(panel.pinnedAt)}` : " · never pinned: measured on request"}
        </span>
      </Fact>
      <Fact term="Series">
        {rule.releases.join(", ")}
        <span className="text-muted-foreground">
          {rule.since ? ` · published from ${dateLong(`${rule.since}T00:00:00Z`)}` : " · every build"}
          {` · listed ${dateLong(timeline.listing.listedAt)}`}
        </span>
      </Fact>
      <Fact term="Coverage">
        {timeline.builds.length} builds listed · {panel.coverage.measured} of {panel.coverage.files} files measured
        <span className="text-muted-foreground">
          {periods ? ` · ${periods}` : ""}
          {outside > 0 ? ` · this engine is outside the model range that ${outside} of ${measured.length} measured builds declare` : ""}
        </span>
      </Fact>
      <Fact term="Disclosure">{disclosureLine(presentation.disclosure)}</Fact>
    </dl>
  );
}

const SCOPES: { id: MovedScope; label: string }[] = [
  { id: "headline", label: "Headline outputs" },
  { id: "all", label: "All outputs" },
];

/** What moved at the latest build: the outputs ranked by their own typical step. */
export function WhatMoved({
  summary,
  builds,
  names,
  scope,
  onScope,
  onSelect,
}: {
  /** Null when no build of the panel is measured. */
  summary: StepSummary | null;
  builds: readonly TimelineBuild[];
  names: ReadonlyMap<string, string>;
  scope: MovedScope;
  onScope: (scope: MovedScope) => void;
  /** Opens an output with this step's card. */
  onSelect: (outputId: string, buildId: string) => void;
}) {
  const build = summary ? builds[summary.buildIndex] : null;
  const from = summary?.fromBuildId ? builds.find((candidate) => candidate.buildId === summary.fromBuildId) : null;
  const named = (target: TimelineBuild) => `${dateShort(target.publishedAt)} (${names.get(target.buildId) ?? target.build})`;
  const counts = summary
    ? `${summary.moved.length} moved, ${summary.unchanged} did not move, ${summary.withheld} withheld${summary.noStep > 0 ? `, ${summary.noStep} with no step` : ""}.`
    : "";
  return (
    <SectionCard
      title="What moved at the latest build"
      description={
        build
          ? from
            ? `From ${named(from)} to ${named(build)}, on this engine.`
            : `The latest measured build is ${named(build)}.`
          : "No build is measured on this engine yet."
      }
      actions={
        <div role="radiogroup" aria-label="Outputs ranked" className="inline-flex rounded-md border border-border p-0.5">
          {SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={scope === option.id}
              onClick={() => onScope(option.id)}
              className={`h-7 rounded px-2.5 text-xs font-medium transition-colors ${
                scope === option.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      }
      footer={
        summary && build
          ? `${counts} ${
              summary.rankedByTypical
                ? "Ranked by each output's step beside its own typical step: the median of its earlier steps on this engine. An output with fewer than three earlier steps comes after, by the size of its step."
                : "Ranked by the size of each step: no output that moved has the three earlier steps a typical step is taken from."
            } Headline outputs: each baseline item's total, and each reform's budgetary impact and target.`
          : undefined
      }
    >
      {!summary || !build ? (
        <p className="text-sm text-muted-foreground">Nothing to rank yet.</p>
      ) : summary.sameFile ? (
        <p className="text-sm text-muted-foreground">
          The latest build publishes the file of an earlier build, so no output moved.
        </p>
      ) : summary.moved.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {summary.fromBuildId
            ? "No output moved at the latest build."
            : "No output has a step to the latest build: this engine holds no value for the build before it."}
        </p>
      ) : (
        <ol className="grid gap-0.5">
          {summary.moved.slice(0, 6).map((move, index) => (
            <li key={move.entry.key}>
              <button
                type="button"
                onClick={() => onSelect(move.entry.id, build.buildId)}
                className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left hover:bg-muted sm:grid-cols-[1.5rem_minmax(0,1fr)_auto]"
              >
                <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span className="truncate text-sm font-medium text-foreground" title={move.entry.fullLabel}>
                  {move.entry.fullLabel}
                </span>
                <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-3">{moveLine(move)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

const STATE_TONES: Record<TimelineBuild["state"], StatusTone> = {
  measured: "success",
  gap: "warning",
  retrying: "warning",
  failed: "danger",
  missing: "neutral",
};

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="pill-neutral inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none">
      {children}
    </span>
  );
}

/** A build's state on this engine and its marks, as chips. */
export function BuildChips({
  build,
  builds,
  marks,
  withState = true,
}: {
  build: TimelineBuild;
  builds: readonly TimelineBuild[];
  marks: readonly BuildMark[];
  withState?: boolean;
}) {
  const first = build.sameFileAs ? builds.find((candidate) => candidate.buildId === build.sameFileAs) : null;
  return (
    <span className="flex flex-wrap gap-1">
      {withState && (
        <span title={build.reason ?? undefined}>
          <StatusPill tone={STATE_TONES[build.state]}>{buildStateLabel(build)}</StatusPill>
        </span>
      )}
      {build.current && <StatusPill tone="info">Current</StatusPill>}
      {build.sameFileAs && <Chip>Same file as {first ? dateShort(first.publishedAt) : "an earlier build"}</Chip>}
      {build.withdrawn && <Chip>Withdrawn</Chip>}
      {marks.includes("new_build_engine") && <Chip>{BUILD_MARK_LABELS.new_build_engine}</Chip>}
    </span>
  );
}

/** The builds of the series, in publish order. A card opens that build's step card. */
export function BuildsStrip({
  builds,
  marks,
  names,
  selectedIndex,
  onSelect,
}: {
  builds: readonly TimelineBuild[];
  marks: readonly BuildMark[][];
  names: ReadonlyMap<string, string>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}) {
  return (
    <section aria-labelledby="release-history-builds">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="release-history-builds" className="text-sm font-semibold text-foreground">
          Builds in the series
        </h2>
        <p className="text-xs text-muted-foreground">
          In publish order. A step joins two neighbours that both hold the value; a withdrawn build is never a neighbour.
        </p>
      </div>
      <div className="overflow-x-auto pb-1">
        <ol className="m-0 flex min-w-min list-none gap-2 p-0">
          {builds.map((build, index) => (
            <li key={build.buildId} className="w-[196px] shrink-0">
              <button
                type="button"
                aria-pressed={selectedIndex === index}
                onClick={() => onSelect(index)}
                className={`grid h-full w-full content-start gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary ${
                  selectedIndex === index ? "border-primary bg-[var(--accent-subtle)]" : build.withdrawn ? "border-border bg-background" : "border-border bg-card"
                }`}
              >
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{dateLong(build.publishedAt)}</span>
                <span
                  title={build.buildId}
                  className={`truncate font-mono text-xs ${build.withdrawn ? "text-muted-foreground line-through" : "text-foreground"}`}
                >
                  {names.get(build.buildId) ?? build.build}
                </span>
                <BuildChips build={build} builds={builds} marks={marks[index] ?? []} />
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

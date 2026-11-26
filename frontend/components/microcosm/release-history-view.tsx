"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@policyengine/ui-kit";

import { useCountry } from "@/components/layout/country-context";
import { CountryNotConfiguredState } from "@/components/microcosm/country-not-configured";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import { countryNotConfiguredError } from "@/lib/api/client";
import {
  releaseHistoryExportUrl,
  useReleaseHistoryPanel,
  useReleaseHistorySummary,
} from "@/lib/api/hooks/use-release-history";
import {
  buildMarks,
  buildsWithoutRun,
  stepFacts,
} from "@/lib/microcosm/release-history-builds";
import { shortBuildNames } from "@/lib/microcosm/release-history-format";
import { latestMeasuredBuild, stepSummary } from "@/lib/microcosm/release-history-moved";
import {
  engineNotices,
  engineOptions,
  pageSelection,
  selectedPanelId,
  staleState,
} from "@/lib/microcosm/release-history-page";
import type {
  ReleaseHistoryPanelView,
  ReleaseHistorySummary,
} from "@/lib/microcosm/release-history-summary";
import {
  releaseHistoryUrlState,
  withReleaseHistoryState,
  type ReleaseHistoryUrlState,
} from "@/lib/microcosm/release-history-url";
import { countryRegistration } from "@policyengine/calibration-tree/countries";

import { OutputDetail, OutputNavigator } from "./release-history-output-detail";
import {
  BuildsStrip,
  BuildsWithoutRunNotice,
  EngineNotices,
  SeriesFacts,
  WhatMoved,
} from "./release-history-sections";
import { ReleaseHistoryStepCard } from "./release-history-step-card";

// The release history page (calibration-diagnostics#224): every national data file a country
// publishes, measured on one fixed engine, so a move between two releases comes from the data
// and not the model. It reads the stored `timeline.json` of one panel, and keeps its state (the
// engine's panel, the output, the scale, the open step) in the URL.

const DESCRIPTION =
  "Every national data file this country publishes, measured on one fixed engine, so a move between two releases comes from the data and not the model.";

function Header({ actions }: { actions?: React.ReactNode }) {
  return <PageHeader eyebrow="Microcosm · releases" title="Release history" description={DESCRIPTION} actions={actions} />;
}

/** One loaded panel: the notices, the facts, what moved, the builds and the outputs. */
export function ReleaseHistoryPanel({
  summary,
  view,
  state,
  onState,
  settled = false,
}: {
  summary: ReleaseHistorySummary;
  view: ReleaseHistoryPanelView;
  state: ReleaseHistoryUrlState;
  /** Writes part of the page's state to the URL. */
  onState: (patch: Partial<ReleaseHistoryUrlState>) => void;
  /**
   * Whether `view` is the panel the URL names, and not the one kept on screen while it loads. Only
   * then is a value of the URL this panel cannot use taken out of the URL.
   */
  settled?: boolean;
}) {
  const { timeline, presentation } = view;
  const builds = timeline.builds;
  const { output, period, step: openStep, moved: scope } = state;
  const selection = useMemo(
    () => pageSelection(view, { output, period, step: openStep }),
    [view, output, period, openStep],
  );
  useEffect(() => {
    if (!settled) return;
    const stale = staleState(selection, { output, period, step: openStep });
    if (Object.keys(stale).length > 0) onState(stale);
  }, [settled, selection, output, period, openStep, onState]);
  const marks = useMemo(() => buildMarks(builds), [builds]);
  const names = useMemo(() => shortBuildNames(builds), [builds]);
  const without = useMemo(() => buildsWithoutRun(builds), [builds]);
  const notices = engineNotices(summary, view.panelId);
  const latest = latestMeasuredBuild(builds);
  const moved = useMemo(() => {
    if (latest === null) return null;
    const ranked = scope === "all" ? selection.periodEntries : selection.periodEntries.filter((candidate) => candidate.headline);
    return stepSummary(ranked, builds, latest);
  }, [latest, builds, selection.periodEntries, scope]);
  const { stepIndex, entry } = selection;
  const step = stepIndex === null ? null : stepFacts(builds, stepIndex);
  const atStep = useMemo(
    () => (stepIndex === null ? null : stepSummary(selection.periodEntries, builds, stepIndex)),
    [stepIndex, selection.periodEntries, builds],
  );
  const selectStep = (index: number) =>
    onState({ step: stepIndex === index ? null : builds[index]?.buildId ?? null });
  // A row of "what moved" opens an output and its step further down the page: bring them into view.
  const outputs = useRef<HTMLElement>(null);
  const openMove = (movedOutput: string, buildId: string) => {
    onState({ output: movedOutput, step: buildId });
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    outputs.current?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  };
  return (
    <>
      <EngineNotices notices={notices} onSelectPanel={(panelId) => onState({ panel: panelId })} />
      <BuildsWithoutRunNotice without={without} names={names} />
      <SeriesFacts view={view} />
      <WhatMoved
        summary={moved}
        builds={builds}
        names={names}
        scope={scope}
        onScope={(scope) => onState({ moved: scope })}
        onSelect={openMove}
      />
      <BuildsStrip builds={builds} marks={marks} names={names} selectedIndex={stepIndex} onSelect={selectStep} />
      {entry ? (
        <section
          ref={outputs}
          aria-label="Outputs"
          className="grid scroll-mt-28 items-start gap-[18px] lg:grid-cols-[320px_minmax(0,1fr)]"
        >
          <OutputNavigator
            entries={selection.periodEntries}
            builds={builds}
            currency={presentation.currency}
            selectedId={entry.id}
            onSelect={(output) => onState({ output })}
          />
          <OutputDetail
            entry={entry}
            entries={selection.periodEntries}
            periods={selection.periods}
            period={selection.period}
            builds={builds}
            marks={marks}
            names={names}
            presentation={presentation}
            scale={state.scale}
            stepIndex={stepIndex}
            onScale={(scale) => onState({ scale })}
            onPeriod={(period) => onState({ period })}
            onSelectOutput={(output) => onState({ output })}
            onSelectStep={selectStep}
          >
            {step && atStep && stepIndex !== null && (
              <ReleaseHistoryStepCard
                step={step}
                summary={atStep}
                entry={entry}
                index={stepIndex}
                currency={presentation.currency}
                country={view.country}
                names={names}
                onSelectOutput={(output) => onState({ output })}
                onClose={() => onState({ step: null })}
              />
            )}
          </OutputDetail>
        </section>
      ) : (
        <EmptyState title="This panel holds no output yet" description="Its builds are listed above; none has a stored value." />
      )}
    </>
  );
}

/** The engine toggle and the CSV download, for the page header. */
export function ReleaseHistoryActions({
  summary,
  panelId,
  onSelectPanel,
}: {
  summary: ReleaseHistorySummary;
  panelId: string;
  onSelectPanel: (panelId: string) => void;
}) {
  return (
    <>
      <ToolbarSelect
        label="Engine"
        value={panelId}
        options={engineOptions(summary)}
        onChange={onSelectPanel}
        className="max-w-[min(100%,26rem)]"
      />
      <Button asChild variant="outline" className="border-primary bg-background text-primary hover:bg-primary/5">
        <a href={releaseHistoryExportUrl(summary.country, panelId)} download>
          Download CSV
        </a>
      </Button>
    </>
  );
}

export function ReleaseHistoryView() {
  const { country } = useCountry();
  const searchParams = useSearchParams();
  // Read from the URL on every render, so Back, Forward and a pasted link all open the same view.
  const search = searchParams.toString();
  const state = useMemo(() => releaseHistoryUrlState(new URLSearchParams(search)), [search]);
  const onState = useCallback((patch: Partial<ReleaseHistoryUrlState>) => {
    window.history.replaceState(null, "", withReleaseHistoryState(window.location.href, patch));
  }, []);
  const summaryQuery = useReleaseHistorySummary();
  const summary = summaryQuery.data;
  const panelId = summary?.available ? selectedPanelId(summary, state.panel) : null;
  const panelQuery = useReleaseHistoryPanel(panelId, panelId !== null);
  const label = countryRegistration(country).label;
  // A panel the country does not have, as a link kept across a change of country names, leaves
  // the URL once the country's panels are known.
  const stalePanel = Boolean(summary?.available) && state.panel !== null && state.panel !== panelId;
  useEffect(() => {
    if (stalePanel) onState({ panel: null });
  }, [stalePanel, onState]);

  const notConfigured = countryNotConfiguredError(summaryQuery.error) ?? countryNotConfiguredError(panelQuery.error);
  if (notConfigured) {
    return <CountryNotConfiguredState requested={notConfigured.requested_country} reason={notConfigured.reason} />;
  }
  let body: React.ReactNode;
  if (summaryQuery.error) {
    body = <EmptyState title="The release history could not be loaded" description={summaryQuery.error.message} />;
  } else if (!summary) {
    body = <LoadingBlock label="Loading the release history…" />;
  } else if (!summary.available || panelId === null) {
    body = (
      <EmptyState
        title={`No release history for ${label} yet`}
        description={`Nothing has been measured for ${label}. Once a run has stored its first measured file, its timeline appears here.`}
      />
    );
  } else if (panelQuery.error && !panelQuery.data) {
    body = <EmptyState title="This engine's timeline could not be loaded" description={panelQuery.error.message} />;
  } else if (!panelQuery.data) {
    body = <LoadingBlock label="Loading the timeline…" />;
  } else {
    // While another engine's panel loads, the one on screen stays, dimmed.
    body = (
      <div className={`flex flex-col gap-5 transition-opacity ${panelQuery.isPlaceholderData ? "opacity-60" : ""}`}>
        <ReleaseHistoryPanel
          summary={summary}
          view={panelQuery.data}
          state={state}
          onState={onState}
          settled={!panelQuery.isPlaceholderData && panelQuery.data.panelId === panelId}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Header
        actions={
          summary?.available && panelId !== null ? (
            <ReleaseHistoryActions summary={summary} panelId={panelId} onSelectPanel={(next) => onState({ panel: next })} />
          ) : undefined
        }
      />
      {body}
    </div>
  );
}

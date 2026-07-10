"use client";

import { PageHeader } from "@/components/shared/page-header";
import { PipelineDiagram } from "@/components/populace/pipeline-diagram";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import {
  PIPELINE_PHASES,
  PIPELINE_SOURCE,
  SOURCE_STAGES,
  UNDECLARED_VALIDATION_INPUTS,
} from "@/lib/populace/pipeline";

export function PopulacePipelineView() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace"
        title="How the dataset is built"
        description={
          <>
            The full US pipeline as implemented in{" "}
            <a
              className="underline decoration-dotted underline-offset-2"
              href={PIPELINE_SOURCE.url}
              target="_blank"
              rel="noreferrer"
            >
              {PIPELINE_SOURCE.repo}
            </a>{" "}
            (derived from main @ {PIPELINE_SOURCE.commit}). Build-step ids match the
            staging telemetry, so a running build on the Staging runs page walks these
            exact steps.
          </>
        }
      />

      <SectionCard
        title="Flow"
        description="Left to right: survey sources feed the base H5; Ledger facts and references compile the target surface; materialization and calibration produce the dataset and its diagnostics; staging streams live; publish ships to Hugging Face."
      >
        <PipelineDiagram />
      </SectionCard>

      <SectionCard
        title="Source enrichment (upstream of a refresh build)"
        description="Imputation stages declared in source_stages.json — each grafts variables from another survey onto the CPS base. They are baked into the base H5 and are NOT re-run by a fiscal-refresh build."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {SOURCE_STAGES.map((s) => (
            <div
              key={s.stage}
              className="rounded-lg border border-border bg-card p-3 shadow-[var(--elev-1)]"
            >
              <div className="font-mono text-xs font-semibold text-foreground">{s.stage}</div>
              <div className="mt-0.5 text-xs text-primary">{s.survey}</div>
              <div className="mt-1.5 break-all text-xs leading-snug text-muted-foreground">
                {s.outputs.join(", ")}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <div className="flex flex-col gap-0">
        {PIPELINE_PHASES.map((phase, index) => (
          <div key={phase.key} className="relative flex gap-5 pb-2">
            {/* spine */}
            <div className="flex w-8 shrink-0 flex-col items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xs font-bold text-primary">
                {index + 1}
              </div>
              {index < PIPELINE_PHASES.length - 1 && (
                <div className="w-px grow bg-border" aria-hidden />
              )}
            </div>
            <div className="min-w-0 grow pb-6">
              <div className="text-sm font-semibold text-foreground">{phase.title}</div>
              <div className="mb-3 mt-0.5 max-w-3xl text-xs leading-snug text-muted-foreground">
                {phase.summary}
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {phase.steps.map((step) => (
                  <div
                    key={step.id}
                    className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4 shadow-[var(--elev-1)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium leading-tight text-foreground">
                        {step.title}
                      </div>
                      <StatusPill tone="neutral">{step.id}</StatusPill>
                    </div>
                    <div className="font-mono text-[11px] leading-snug text-primary/80">
                      {step.code}
                    </div>
                    <div className="text-xs leading-snug text-muted-foreground">
                      {step.description}
                    </div>
                    {step.artifacts?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {step.artifacts.map((a) => (
                          <span
                            key={a}
                            className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <SectionCard
        title="Inputs external validation found missing"
        description="Cross-referenced against source_stages.json at the commit above: variables flagged by the reform/SOI validation are exactly the ones no enrichment stage declares as an output."
      >
        <ul className="flex flex-col divide-y divide-border/60">
          {UNDECLARED_VALIDATION_INPUTS.map((g) => (
            <li key={g.variable} className="flex items-start gap-3 px-1 py-2.5">
              <code className="w-56 shrink-0 break-all pt-0.5 font-mono text-xs text-foreground md:w-96">
                {g.variable}
              </code>
              <span className="text-xs text-muted-foreground">
                {g.effect}
                {g.issue ? (
                  <>
                    {" · "}
                    <a
                      href={g.issue}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      issue ↗
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, releaseLabel } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill, type StatusTone } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  releaseSelectOptions,
  usePopulaceCertification,
  usePopulaceReleases,
  type CertificationGate,
  type CoverageExclusion,
  type CoverageIssueRef,
  type GateOutcome,
} from "@/lib/api/hooks/use-populace";

const OUTCOME_TONE: Record<GateOutcome, StatusTone> = {
  passed: "success",
  failed: "danger",
  waived: "warning",
  skipped: "neutral",
  unknown: "neutral",
};

const SOURCE_LABEL: Record<CertificationGate["source"], string> = {
  build_manifest: "build manifest",
  us_source_coverage: "side file",
  input_coverage: "side file",
  reform_coverage_smoke: "side file",
};

function IssueLinks({ issues }: { issues: CoverageIssueRef[] }) {
  if (!issues.length) {
    return <StatusPill tone="warning"><span className="font-mono">no issue</span></StatusPill>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {issues.map((ref) => (
        <a
          key={ref.url}
          href={ref.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-primary hover:underline"
        >
          {ref.repo === "populace" ? `#${ref.number}` : `${ref.repo}#${ref.number}`}
        </a>
      ))}
    </span>
  );
}

function ExclusionRegister({
  gateLabel,
  entries,
}: {
  gateLabel: string;
  entries: CoverageExclusion[];
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {gateLabel} · {entries.length}
      </div>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.subject} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-foreground">{entry.subject}</span>
              <IssueLinks issues={entry.issues} />
            </div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{entry.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GateRow({ gate }: { gate: CertificationGate }) {
  return (
    <tr className="border-b border-border/60 last:border-b-0 align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">{gate.label}</div>
        {gate.summary && (
          <div className="text-xs text-muted-foreground">{gate.summary}</div>
        )}
        {gate.failures.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-xs tone-neg">
            {gate.failures.slice(0, 4).map((failure, i) => (
              <li key={i}>{failure}</li>
            ))}
          </ul>
        )}
      </td>
      <td className="px-3 py-2">
        <StatusPill tone={OUTCOME_TONE[gate.outcome]}>{gate.outcome}</StatusPill>
      </td>
      <td className="px-3 py-2">
        {gate.enforced == null ? (
          <span className="text-xs text-muted-foreground">not declared</span>
        ) : (
          <StatusPill tone={gate.enforced ? "info" : "neutral"}>
            {gate.enforced ? "enforced" : "advisory"}
          </StatusPill>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {gate.evidence_sha ? gate.evidence_sha.slice(0, 12) : "—"}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{SOURCE_LABEL[gate.source]}</td>
    </tr>
  );
}

export function PopulaceCertificationView() {
  const { data: releaseData } = usePopulaceReleases();
  const [release, setRelease] = useState("");
  const { data, isLoading, error } = usePopulaceCertification(release || undefined);
  const releaseOptions = useMemo(() => releaseSelectOptions(releaseData), [releaseData]);

  const cert = data?.certification;
  const totals = cert?.totals;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace · certification"
        title="Certification"
        description="Per-release gate outcomes — what the published evidence proves, not just what ran. Each gate shows its verdict, whether it was enforced (blocking) or advisory, and the evidence sha where present. The panel already reads populace#381's richer schema (passed / failed / skipped / waived with evidence) when it ships; today it derives the verdict from the build manifest."
        actions={
          <ToolbarSelect label="Release" value={release} onChange={setRelease} options={releaseOptions} />
        }
      />

      {isLoading ? (
        <LoadingBlock label="Loading certification…" />
      ) : error || !cert || !totals ? (
        <EmptyState
          title="Certification unavailable"
          description={error instanceof Error ? error.message : "Could not load release certification."}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Gates passed"
              value={`${fmt(totals.passed, { digits: 0 })} / ${fmt(totals.total, { digits: 0 })}`}
              tone={totals.failed === 0 ? "positive" : "negative"}
              hint={`${fmt(totals.enforced, { digits: 0 })} enforced`}
            />
            <KpiCard
              label="Failed"
              value={fmt(totals.failed, { digits: 0 })}
              tone={totals.failed === 0 ? "positive" : "negative"}
            />
            <KpiCard
              label="Skipped / waived"
              value={`${fmt(totals.skipped, { digits: 0 })} / ${fmt(totals.waived, { digits: 0 })}`}
              tone={totals.waived === 0 ? "neutral" : "negative"}
              hint="waived gates leave no proof"
            />
            <KpiCard
              label="Stale exclusions"
              value={fmt(cert.stale_exclusion_count, { digits: 0 })}
              tone={cert.stale_exclusion_count === 0 ? "positive" : "negative"}
              hint="#286 cannot-rot: caught-up exclusions"
            />
          </div>

          <SectionCard
            title="Release gates"
            description="Every gate the release carries — the build_manifest.gates map plus the coverage and smoke side files folded in (populace#381)."
            padded={false}
            footer={
              data?.source_artifacts?.length ? (
                <>
                  Evidence read live from{" "}
                  {data.source_artifacts.map((artifact, i) => (
                    <span key={artifact.name}>
                      {i > 0 ? " · " : ""}
                      <a
                        href={artifact.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {artifact.name}
                      </a>
                    </span>
                  ))}
                  .
                </>
              ) : null
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Gate</th>
                    <th className="px-3 py-2 font-semibold">Outcome</th>
                    <th className="px-3 py-2 font-semibold">Enforcement</th>
                    <th className="px-3 py-2 font-semibold">Evidence sha</th>
                    <th className="px-3 py-2 font-semibold">From</th>
                  </tr>
                </thead>
                <tbody>
                  {cert.gates.map((gate) => (
                    <GateRow key={`${gate.source}:${gate.key}`} gate={gate} />
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Reviewed-exclusion registers"
            description="Every input a gate carries as a reviewed exclusion, grouped by gate, each linking the tracking issue that keeps it honest (#286 cannot-rot)."
          >
            {cert.reviewed_exclusion_registers.length ? (
              <div className="flex flex-col gap-5">
                {cert.reviewed_exclusion_registers.map((register) => (
                  <ExclusionRegister
                    key={register.gate_key}
                    gateLabel={register.gate_label}
                    entries={register.entries}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                variant="compact"
                title="No reviewed exclusions on this release"
                description="No gate is carrying an input as a reviewed exclusion — the whole required surface is covered directly."
              />
            )}
          </SectionCard>

          <div className="text-xs text-muted-foreground">
            Certifying release <span className="font-mono">{releaseLabel(cert.release_id)}</span>
            {data?.updated_at ? ` · published ${data.updated_at}` : ""}.
          </div>
        </>
      )}
    </div>
  );
}

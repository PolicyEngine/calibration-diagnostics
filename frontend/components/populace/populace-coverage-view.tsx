"use client";

import { Fragment, useMemo, useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { fmt, fmtCompact, releaseLabel } from "@/components/shared/format";
import { KpiCard } from "@/components/shared/kpi-card";
import { LoadingBlock } from "@/components/shared/LoadingBlock";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatusPill } from "@/components/shared/status-pill";
import { ToolbarSelect } from "@/components/shared/toolbar-select";
import {
  releaseSelectOptions,
  usePopulaceCoverage,
  usePopulaceReleases,
  type CoverageExclusion,
  type CoverageIssueRef,
  type HardTargetFamily,
} from "@/lib/api/hooks/use-populace";

const POPULACE_369 = "https://github.com/PolicyEngine/populace/issues/369";
const POPULACE_368 = "https://github.com/PolicyEngine/populace/issues/368";

// A reviewed exclusion must name a live issue (#286 "cannot rot"). We link
// every issue the reason references so a reviewer can check it in one click.
function IssueLinks({ issues }: { issues: CoverageIssueRef[] }) {
  if (!issues.length) {
    return (
      <StatusPill tone="warning">
        <span className="font-mono">no issue</span>
      </StatusPill>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {issues.map((ref) => (
        <a
          key={ref.url}
          href={ref.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-primary hover:underline"
        >
          {ref.repo === "populace" ? `#${ref.number}` : `${ref.repo}#${ref.number}`}
        </a>
      ))}
    </span>
  );
}

function ExclusionList({ exclusions }: { exclusions: CoverageExclusion[] }) {
  if (!exclusions.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {exclusions.map((exclusion) => (
        <li
          key={exclusion.subject}
          className="rounded-md border border-border/60 bg-muted/20 px-3 py-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs text-foreground">{exclusion.subject}</span>
            <IssueLinks issues={exclusion.issues} />
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{exclusion.reason}</p>
        </li>
      ))}
    </ul>
  );
}

const STATE_TONE: Record<HardTargetFamily["state"], "success" | "warning" | "danger" | "neutral"> = {
  covered: "success",
  partial: "warning",
  excluded: "warning",
  missing: "danger",
};

const STATE_LABEL: Record<HardTargetFamily["state"], string> = {
  covered: "covered",
  partial: "partial",
  excluded: "reviewed-excluded",
  missing: "missing",
};

function FamilyTable({ families }: { families: HardTargetFamily[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Source family</th>
            <th className="px-3 py-2 text-right font-semibold">Required</th>
            <th className="px-3 py-2 text-right font-semibold">Covered</th>
            <th className="px-3 py-2 text-right font-semibold">Excluded</th>
            <th className="px-3 py-2 text-right font-semibold">Missing</th>
            <th className="px-3 py-2 font-semibold">State</th>
          </tr>
        </thead>
        <tbody>
          {families.map((family) => {
            const isOpen = open.has(family.key);
            return (
              <Fragment key={family.key}>
                <tr
                  onClick={() => toggle(family.key)}
                  className="cursor-pointer border-b border-border/60 last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                      >
                        ▸
                      </span>
                      <span className="font-medium text-foreground">{family.label}</span>
                    </div>
                    <span className="ml-4 font-mono text-[11px] text-muted-foreground">{family.key}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{family.required.length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums tone-pos">{family.covered.length}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{family.reviewed_exclusions.length}</td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${family.missing.length ? "tone-neg font-semibold" : "text-muted-foreground"}`}
                  >
                    {family.missing.length}
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusPill tone={STATE_TONE[family.state]}>{STATE_LABEL[family.state]}</StatusPill>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/60 bg-muted/10">
                    <td colSpan={6} className="px-3 py-3 pl-9">
                      <div className="flex flex-col gap-3">
                        {family.covered.length > 0 && (
                          <div>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Covered ({family.covered.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {family.covered.map((alias) => (
                                <span
                                  key={alias}
                                  className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground"
                                >
                                  {alias}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {family.missing.length > 0 && (
                          <div>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider tone-neg">
                              Missing — required but absent ({family.missing.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {family.missing.map((alias) => (
                                <span
                                  key={alias}
                                  className="inline-flex items-center rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 font-mono text-[11px] tone-neg"
                                >
                                  {alias}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {family.reviewed_exclusions.length > 0 && (
                          <div>
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Reviewed exclusions ({family.reviewed_exclusions.length})
                            </div>
                            <ExclusionList exclusions={family.reviewed_exclusions} />
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PopulaceCoverageView() {
  const { data: releaseData } = usePopulaceReleases();
  const [release, setRelease] = useState("");
  const { data, isLoading, error } = usePopulaceCoverage(release || undefined);
  const releaseOptions = useMemo(() => releaseSelectOptions(releaseData), [releaseData]);

  const source = data?.source;
  const inputColumns = data?.input_columns;
  const reformSmoke = data?.reform_smoke;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Populace · reform coverage"
        title="Coverage"
        description="What inputs this release actually carries, and which reforms score versus silently default to zero. Source coverage is published today; the per-column input gate (populace#369) and the reform-coverage smoke (populace#368, the SSI-scores-$0 failure class) light up here once a build publishes them."
        actions={
          <ToolbarSelect label="Release" value={release} onChange={setRelease} options={releaseOptions} />
        }
      />

      {isLoading ? (
        <LoadingBlock label="Loading coverage manifest…" />
      ) : error ? (
        <EmptyState
          title="Coverage manifest unavailable"
          description={error instanceof Error ? error.message : "Could not load coverage."}
        />
      ) : (
        <>
          {source?.available && source.summary ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  label="Required aliases covered"
                  value={`${fmt(source.summary.covered_aliases, { digits: 0 })} / ${fmt(source.summary.required_aliases, { digits: 0 })}`}
                  tone={source.summary.missing_aliases === 0 ? "positive" : "negative"}
                  hint={`${fmt(source.summary.hard_target_families, { digits: 0 })} hard-target families`}
                />
                <KpiCard
                  label="Reviewed exclusions"
                  value={fmt(source.summary.reviewed_excluded_aliases, { digits: 0 })}
                  hint="carried with a tracking issue"
                />
                <KpiCard
                  label="Missing required"
                  value={fmt(source.summary.missing_aliases, { digits: 0 })}
                  tone={source.summary.missing_aliases === 0 ? "positive" : "negative"}
                  hint="required aliases absent from this release"
                />
                <KpiCard
                  label="Source-gap families"
                  value={fmt(source.summary.source_gap_families, { digits: 0 })}
                  hint={`${fmt(source.summary.missing_source_packages, { digits: 0 })} missing source packages`}
                />
              </div>

              <SectionCard
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Hard-target source coverage
                    {source.gate?.passed != null && (
                      <StatusPill tone={source.gate.passed ? "success" : "danger"}>
                        gate {source.gate.passed ? "passed" : "failed"}
                      </StatusPill>
                    )}
                  </span>
                }
                description="Each source family the release is required to cover. Click a family to see the exact package aliases it covers, any that are missing, and reviewed fiscal-refresh exclusions with their tracking issues."
                padded={false}
                footer={
                  source.artifact ? (
                    <>
                      Read live from{" "}
                      <a
                        href={source.artifact.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline decoration-dotted underline-offset-2"
                      >
                        {source.artifact.path}
                      </a>
                      {source.ledger_commit ? ` · ledger ${source.ledger_commit.slice(0, 10)}` : ""}
                    </>
                  ) : null
                }
              >
                <FamilyTable families={source.hard_target_families ?? []} />
              </SectionCard>

              {(source.validation_only_families?.length ?? 0) > 0 && (
                <SectionCard
                  title="Validation-only families"
                  description="Source families available for validation but not activated as hard calibration targets in this release."
                  padded={false}
                >
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Family</th>
                        <th className="px-3 py-2 font-semibold">Packages</th>
                        <th className="px-3 py-2 font-semibold">Activated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {source.validation_only_families?.map((family) => (
                        <tr key={family.key} className="border-b border-border/60 last:border-b-0">
                          <td className="px-3 py-2">
                            <span className="font-medium text-foreground">{family.label}</span>
                            <span className="ml-2 font-mono text-[11px] text-muted-foreground">{family.key}</span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                            {family.required.join(", ") || "—"}
                          </td>
                          <td className="px-3 py-2">
                            <StatusPill tone={family.activated ? "success" : "neutral"}>
                              {family.activated ? "activated" : "validation only"}
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}

              {(source.source_gap_families?.length ?? 0) > 0 && (
                <SectionCard
                  title="Source gaps"
                  description="Target families with no upstream source package available yet — known blind spots, not calibration error."
                  padded={false}
                >
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Family</th>
                        <th className="px-3 py-2 font-semibold">Missing source packages</th>
                      </tr>
                    </thead>
                    <tbody>
                      {source.source_gap_families?.map((family) => (
                        <tr key={family.key} className="border-b border-border/60 last:border-b-0 align-top">
                          <td className="px-3 py-2">
                            <span className="font-medium text-foreground">{family.label}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            <ul className="list-inside list-disc">
                              {family.missing_source_packages.map((pkg) => (
                                <li key={pkg}>{pkg}</li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}
            </>
          ) : (
            <EmptyState
              title="No source-coverage manifest published for this release yet"
              description={
                source && !source.available
                  ? `The build pipeline publishes us_source_coverage.json per release (${source.expected_path}). This release predates it.`
                  : "This release has no source-coverage manifest."
              }
            />
          )}

          {/* populace#369 — the per-column eCPS input coverage gate. */}
          <SectionCard
            title={
              <span className="flex flex-wrap items-center gap-2">
                Input-column coverage
                {inputColumns?.available && inputColumns.enforced != null && (
                  <StatusPill tone={inputColumns.enforced ? "info" : "neutral"}>
                    {inputColumns.enforced ? "enforced gate" : "advisory"}
                  </StatusPill>
                )}
              </span>
            }
            description="Every input column the reference eCPS exports, required present and non-degenerate (populace#369)."
            padded={inputColumns?.available ? false : true}
          >
            {inputColumns?.available && inputColumns.summary ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Column</th>
                      <th className="px-3 py-2 font-semibold">Present</th>
                      <th className="px-3 py-2 font-semibold">Signal</th>
                      <th className="px-3 py-2 font-semibold">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(inputColumns.required ?? []), ...(inputColumns.reviewed_exclusions ?? [])].map(
                      (column) => (
                        <tr key={column.column} className="border-b border-border/60 last:border-b-0">
                          <td className="px-3 py-1.5 font-mono text-xs text-foreground">{column.column}</td>
                          <td className="px-3 py-1.5">
                            <StatusPill tone={column.present === false ? "danger" : "success"}>
                              {column.present === false ? "absent" : "present"}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-1.5">
                            <StatusPill tone={column.degenerate ? "warning" : "neutral"}>
                              {column.degenerate ? "degenerate" : "varies"}
                            </StatusPill>
                          </td>
                          <td className="px-3 py-1.5">
                            <IssueLinks issues={column.issues} />
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                variant="compact"
                title="Not published for this release"
                description="The per-column eCPS coverage gate is RED-by-design on today's defaults (the SSI asset columns are still absent). It renders here once a build publishes input_coverage.json."
                actions={
                  <a href={POPULACE_369} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                    Track populace#369 →
                  </a>
                }
              />
            )}
          </SectionCard>

          {/* populace#368 — reform-coverage smoke: does a bound reform score? */}
          <SectionCard
            title={
              <span className="flex flex-wrap items-center gap-2">
                Reform-coverage smoke
                {reformSmoke?.available && reformSmoke.enforced != null && (
                  <StatusPill tone={reformSmoke.enforced ? "info" : "neutral"}>
                    {reformSmoke.enforced ? "enforced gate" : "advisory"}
                  </StatusPill>
                )}
              </span>
            }
            description="Pinned reform probes that must score nonzero where the policy mechanically binds. A $0 on a bound reform is the SSI-scores-$0 failure class (populace#368) — surfaced here before an analyst burns a day on it."
            padded={reformSmoke?.available ? false : true}
          >
            {reformSmoke?.available && reformSmoke.summary ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">Probe</th>
                      <th className="px-3 py-2 text-right font-semibold">Scored value</th>
                      <th className="px-3 py-2 font-semibold">Verdict</th>
                      <th className="px-3 py-2 font-semibold">Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reformSmoke.probes?.map((probe) => (
                      <tr key={probe.name} className="border-b border-border/60 last:border-b-0">
                        <td className="px-3 py-1.5">
                          <span className="font-medium text-foreground">{probe.name}</span>
                          {probe.description && (
                            <p className="text-xs leading-snug text-muted-foreground">{probe.description}</p>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {probe.scored_value == null ? "—" : fmtCompact(probe.scored_value)}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusPill tone={probe.verdict === "scored" ? "success" : probe.verdict === "zero" ? "danger" : "neutral"}>
                            {probe.verdict === "scored" ? "scores" : probe.verdict === "zero" ? "scores $0" : "unknown"}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-1.5">
                          <IssueLinks issues={probe.issues} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                variant="compact"
                title="Not published for this release"
                description="The reform-coverage smoke fails a release where a mechanically-bound reform scores $0 (first probe: SSI asset limits $10k/$20k). It renders here once a build publishes reform_coverage_smoke.json."
                actions={
                  <a href={POPULACE_368} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                    Track populace#368 →
                  </a>
                }
              />
            )}
          </SectionCard>

          <div className="text-xs text-muted-foreground">
            Current release:{" "}
            <span className="font-mono">
              {data ? releaseLabel(data.release_id) : "—"}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

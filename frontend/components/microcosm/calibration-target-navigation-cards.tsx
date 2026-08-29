"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useCountry } from "@/components/layout/country-context";
import { fmt } from "@/components/shared/format";
import { useMicrocosmTargetDiagnostics } from "@/lib/api/hooks/use-microcosm";
import { microcosmTargetsIntro } from "@/lib/microcosm/presentation";

type TargetDestination = "explore" | "healthcare" | "everything";
type CardAccent = "teal" | "slate";

const ACCENTS: Record<
  CardAccent,
  { ink: string; border: string; glow: string }
> = {
  teal: {
    ink: "text-primary",
    border: "hover:border-primary/50",
    glow: "wiz-glow-teal",
  },
  slate: {
    ink: "text-muted-foreground",
    border: "hover:border-border-dark",
    glow: "wiz-glow-neutral",
  },
};

function targetHref(
  country: string,
  release: string,
  destination: TargetDestination,
): string {
  const params = new URLSearchParams({ country });
  if (release) params.set("release", release);
  if (destination === "explore") params.set("start", "explore");
  if (destination === "healthcare") params.set("scope", "healthcare");
  return `/microcosm/targets?${params.toString()}`;
}

function TargetNavigationCard({
  eyebrow,
  title,
  body,
  stat,
  accent,
  href,
}: {
  eyebrow: string;
  title: string;
  body: string;
  stat: string;
  accent: CardAccent;
  href: string;
}) {
  const styles = ACCENTS[accent];
  return (
    <Link
      href={href}
      className={`group relative flex h-full flex-col gap-5 rounded-2xl border border-border bg-card p-6 text-left shadow-[var(--elev-2)] transition-all duration-200 hover:-translate-y-1 ${styles.border} ${styles.glow} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span
        className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${styles.ink}`}
      >
        {eyebrow}
      </span>
      <div className="flex-1">
        <h3 className="text-xl font-semibold leading-snug tracking-tight text-foreground">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <span className={`text-sm font-semibold tabular-nums ${styles.ink}`}>{stat}</span>
        <span
          className={`grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:border-current ${styles.ink}`}
          aria-hidden
        >
          →
        </span>
      </div>
    </Link>
  );
}

export function CalibrationTargetNavigationCards({ release }: { release?: string }) {
  const { country } = useCountry();
  const { data, isPlaceholderData } = useMicrocosmTargetDiagnostics({
    release,
    limit: 1,
  });
  const variableGroupCount = useMemo(
    () =>
      new Set(
        (data?.variables ?? []).map((variable) =>
          [variable.source, variable.level, variable.variable].join("::"),
        ),
      ).size,
    [data?.variables],
  );
  const hasHealthcareTargets =
    !isPlaceholderData && (data?.scope_counts?.healthcare ?? 0) > 0;
  const allTargets = data?.total_targets ?? null;

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      <TargetNavigationCard
        eyebrow="Browse"
        title="Explore a statistic"
        body={microcosmTargetsIntro(country, data?.presentation)}
        stat={
          variableGroupCount
            ? `${fmt(variableGroupCount, { digits: 0 })} statistics`
            : "Browse measures"
        }
        accent="teal"
        href={targetHref(country, release ?? "", "explore")}
      />
      {hasHealthcareTargets ? (
        <TargetNavigationCard
          eyebrow="Focus"
          title="Healthcare programs"
          body="ACA marketplace, Medicaid, CHIP, and Medicare enrollment and premium targets."
          stat="ACA · Medicaid · Medicare"
          accent="teal"
          href={targetHref(country, release ?? "", "healthcare")}
        />
      ) : null}
      <TargetNavigationCard
        eyebrow="Everything"
        title="See everything"
        body="Browse the full target surface with all filters and column sorting."
        stat={
          allTargets != null
            ? `${fmt(allTargets, { digits: 0 })} targets`
            : "All targets"
        }
        accent="slate"
        href={targetHref(country, release ?? "", "everything")}
      />
    </div>
  );
}

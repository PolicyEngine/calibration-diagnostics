"use client";

import { useEffect, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import { fmtCompact, releaseLabel } from "@/components/shared/format";
import { StatusPill } from "@/components/shared/status-pill";
import { usePopulaceDeltasLatest, type MetricDelta } from "@/lib/api/hooks/use-populace";

const LAST_SEEN_KEY = "populace:last-seen-release";

function moverText(m: MetricDelta): string {
  if (m.abs_delta == null) return "—";
  const sign = m.abs_delta > 0 ? "+" : "";
  if (m.unit === "share") return `${sign}${(m.abs_delta * 100).toFixed(1)}pp`;
  if (m.unit === "count") {
    const rel = m.rel_delta != null ? ` (${sign}${(m.rel_delta * 100).toFixed(1)}%)` : "";
    return `${sign}${fmtCompact(m.abs_delta)}${rel}`;
  }
  return `${sign}${Math.abs(m.abs_delta) < 1 ? m.abs_delta.toFixed(4) : m.abs_delta.toExponential(2)}`;
}

// "Since you last looked" — remembers the release id the reader last acknowledged
// (localStorage) and, on a newer latest release, surfaces the top movers and any
// beyond-band flags. Silent on first visit and once acknowledged.
export function DeltaBanner() {
  const { data } = usePopulaceDeltasLatest();
  // undefined = not yet read from storage; null = never set.
  const [lastSeen, setLastSeen] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    try {
      setLastSeen(window.localStorage.getItem(LAST_SEEN_KEY));
    } catch {
      setLastSeen(null);
    }
  }, []);

  const latestRelease = data?.available ? data.b_release : null;

  // First visit: record the current release silently so the banner only fires
  // on genuinely newer releases from here on.
  useEffect(() => {
    if (latestRelease && lastSeen === null) {
      try {
        window.localStorage.setItem(LAST_SEEN_KEY, latestRelease);
      } catch {
        // ignore storage failures — the banner just won't persist.
      }
      setLastSeen(latestRelease);
    }
  }, [latestRelease, lastSeen]);

  if (!data?.available || lastSeen === undefined || lastSeen === null) return null;
  if (lastSeen === data.b_release) return null;

  function markSeen() {
    if (!latestRelease) return;
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, latestRelease);
    } catch {
      // ignore
    }
    setLastSeen(latestRelease);
  }

  const loud = data.flags.length > 0;
  const movers = data.top_movers.slice(0, 3);

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border px-4 py-3 shadow-[var(--elev-1)] ${
        loud ? "pill-warn" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Since you last looked</span>
            {loud ? (
              <StatusPill tone="warning">
                {data.flags.length} beyond-band flag{data.flags.length === 1 ? "" : "s"}
              </StatusPill>
            ) : (
              <StatusPill tone="success">all within band</StatusPill>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            New release <span className="font-mono">{releaseLabel(data.b_release, data.b_date)}</span>{" "}
            (you last saw <span className="font-mono">{releaseLabel(lastSeen)}</span>).
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href={`${withBasePath("/populace/compare")}?a=${encodeURIComponent(data.a_release)}&b=${encodeURIComponent(data.b_release)}`}
            className="whitespace-nowrap text-sm font-medium text-primary hover:underline"
          >
            View diff →
          </a>
          <button
            type="button"
            onClick={markSeen}
            className="whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            Mark as seen
          </button>
        </div>
      </div>

      {movers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {movers.map((m) => (
            <span
              key={m.key}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-1 text-xs"
            >
              <span className="text-muted-foreground">{m.label}</span>
              <span
                className={`font-semibold tabular-nums ${
                  m.band === "beyond" ? "tone-neg" : "text-foreground"
                }`}
              >
                {moverText(m)}
              </span>
            </span>
          ))}
        </div>
      )}

      {loud && (
        <ul className="list-inside list-disc text-xs leading-snug text-foreground/80">
          {data.flags.slice(0, 4).map((flag) => (
            <li key={flag}>{flag}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

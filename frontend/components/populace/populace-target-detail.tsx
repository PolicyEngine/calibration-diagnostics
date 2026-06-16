"use client";

import { fmt, fmtCompact, fmtSigned } from "@/components/shared/format";
import { StatusPill } from "@/components/shared/status-pill";
import {
  type PopulaceTargetDimension,
  type PopulaceTargetRow,
} from "@/lib/api/hooks/use-populace";

function facetValue(row: PopulaceTargetRow, key: string): string {
  const dim = /^dim(\d+)$/.exec(key);
  if (dim) return row.dims?.[Number(dim[1])] ?? "";
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value || "—"}</span>
    </div>
  );
}

// A horizontal bar for one estimate against the target, scaled to the largest
// magnitude among target/initial/final so the three rows are comparable.
function EstimateBar({
  label,
  value,
  scale,
  tone,
  caption,
}: {
  label: string;
  value: number | null | undefined;
  scale: number;
  tone: "target" | "initial" | "final";
  caption?: string;
}) {
  const width =
    value == null || scale === 0 ? 0 : Math.min(Math.abs(value) / scale, 1) * 100;
  const barColor =
    tone === "target"
      ? "bg-slate-400"
      : tone === "final"
        ? "bg-primary"
        : "bg-amber-400";
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="relative h-4 flex-1 rounded bg-muted/40">
        <div
          className={`absolute left-0 top-0 h-4 rounded ${barColor}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-40 shrink-0 text-right text-xs tabular-nums">
        {fmtCompact(value)}
        {caption ? <span className="ml-1 text-muted-foreground">{caption}</span> : null}
      </span>
    </div>
  );
}

export function PopulaceTargetDetail({
  row,
  dimensions,
  onClose,
}: {
  row: PopulaceTargetRow;
  dimensions: PopulaceTargetDimension[];
  onClose: () => void;
}) {
  const target = typeof row.target === "number" ? row.target : null;
  const initial = typeof row.initial_estimate === "number" ? row.initial_estimate : null;
  const final = typeof row.final_estimate === "number" ? row.final_estimate : null;
  const scale = Math.max(
    Math.abs(target ?? 0),
    Math.abs(initial ?? 0),
    Math.abs(final ?? 0),
  );
  const initialRel =
    typeof row.initial_relative_error === "number" ? row.initial_relative_error : null;
  const finalRel = typeof row.relative_error === "number" ? row.relative_error : null;
  const improvement = typeof row.improvement === "number" ? row.improvement : null;
  const within10 =
    typeof row.abs_relative_error === "number" ? row.abs_relative_error <= 0.1 : null;

  // The axes of variation shown as facets (geography, breakdown dims, …), each
  // resolved on this row. Geography/level are also in the canonical fields above,
  // so skip them here to avoid duplication; show the breakdown dims.
  const shownDims = dimensions.length
    ? dimensions
        .filter((dim) => dim.key !== "geography" && dim.key !== "level")
        .map((dim) => ({ label: dim.label, value: facetValue(row, dim.key) }))
    : (row.dims ?? []).map((value, index) => ({ label: `Breakdown ${index + 1}`, value }));

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-5 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Canonical target
          </div>
          <div className="text-base font-semibold leading-tight text-foreground">
            {row.variable || row.name}
          </div>
          <code className="mt-1 block break-all text-xs text-muted-foreground">
            {row.name}
          </code>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/60"
        >
          close ✕
        </button>
      </div>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Geography" value={row.geography} />
            <Field label="Level" value={row.level} />
            <Field label="Source" value={row.source} />
            <Field label="Variable" value={row.variable} />
          </div>
          {shownDims.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {shownDims.map((dim) => (
                <Field
                  key={dim.label}
                  label={dim.label}
                  value={dim.value.replace(/^AGI in /, "")}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <StatusPill tone={within10 ? "success" : "warning"}>
              {within10 == null ? "—" : within10 ? "within 10%" : "outside 10%"}
            </StatusPill>
            <StatusPill
              tone={
                row.within_tolerance == null
                  ? "neutral"
                  : row.within_tolerance
                    ? "success"
                    : "danger"
              }
            >
              {row.within_tolerance == null
                ? "no tolerance"
                : row.within_tolerance
                  ? "within tolerance"
                  : "outside tolerance"}
            </StatusPill>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Target vs estimates
          </div>
          <div className="flex flex-col gap-2">
            <EstimateBar label="Target" value={target} scale={scale} tone="target" />
            <EstimateBar
              label="Initial"
              value={initial}
              scale={scale}
              tone="initial"
              caption={initialRel == null ? undefined : fmtSigned(initialRel, { pct: true, digits: 1 })}
            />
            <EstimateBar
              label="Final"
              value={final}
              scale={scale}
              tone="final"
              caption={finalRel == null ? undefined : fmtSigned(finalRel, { pct: true, digits: 1 })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-border/60 pt-3 text-sm">
            <Field
              label="Final rel. error"
              value={fmt(finalRel, { pct: true, digits: 1 })}
            />
            <Field
              label="Initial rel. error"
              value={fmt(initialRel, { pct: true, digits: 1 })}
            />
            <Field
              label="Improvement"
              value={
                improvement == null ? (
                  "—"
                ) : (
                  <span className={improvement > 0 ? "text-emerald-700" : "text-rose-700"}>
                    {fmtSigned(improvement, { pct: true, digits: 1 })}
                  </span>
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
